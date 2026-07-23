(function () {
  const defaults = window.NV5_SIS;
  if (!defaults) {
    console.error("Mangler config.js");
    return;
  }

  const els = {
    boardTitle: document.getElementById("boardTitle"),
    clock: document.getElementById("clock"),
    boards: document.getElementById("boards"),
    status: document.getElementById("status"),
    menuToggle: document.getElementById("menuToggle"),
    menuPanel: document.getElementById("menuPanel"),
    settingsOpen: document.getElementById("settingsOpen"),
    syncServer: document.getElementById("syncServer"),
    syncBoard: document.getElementById("syncBoard"),
    settingsDialog: document.getElementById("settingsDialog"),
    settingsSave: document.getElementById("settingsSave"),
    elementsPerQuay: document.getElementById("elementsPerQuay"),
    showJourneyProgress: document.getElementById("showJourneyProgress"),
    showOccupancy: document.getElementById("showOccupancy"),
    showServiceRuns: document.getElementById("showServiceRuns"),
    githubCheckInterval: document.getElementById("githubCheckInterval"),
    selectedQuays: document.getElementById("selectedQuays"),
    stopSearch: document.getElementById("stopSearch"),
    searchResults: document.getElementById("searchResults"),
    quayPick: document.getElementById("quayPick"),
    quayPickTitle: document.getElementById("quayPickTitle"),
    quayResults: document.getElementById("quayResults"),
  };

  let settings = loadSettings();
  let wakeLock = null;
  let refreshTimer = null;
  let searchTimer = null;
  let tickerStops = [];
  let draftQuays = settings.quays.slice();
  let boardCache = {};
  let refreshInFlight = false;
  let tickersPaused = document.hidden;
  let lastBoardSignature = "";

  function modeLabel(mode) {
    return window.NV5Entur && typeof window.NV5Entur.modeLabel === "function"
      ? window.NV5Entur.modeLabel(mode)
      : mode || "";
  }

  function quayKey(quay) {
    return (quay.kind === "stopPlace" ? "stopPlace" : "quay") + ":" + quay.id;
  }

  function normalizeGithubInterval(value) {
    var seconds = Number(value);
    if (!isFinite(seconds) || seconds < 0) {
      return defaults.githubCheckIntervalSeconds || 300;
    }
    return Math.min(86400, Math.round(seconds));
  }

  function readGithubIntervalCookie() {
    var name = defaults.githubIntervalCookie || "nv5_github_interval";
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.indexOf(name + "=") === 0) {
        return normalizeGithubInterval(part.slice(name.length + 1));
      }
    }
    return null;
  }

  function writeGithubIntervalCookie(seconds) {
    var name = defaults.githubIntervalCookie || "nv5_github_interval";
    var maxAge = 60 * 60 * 24 * 365;
    var path = location.pathname.indexOf("/sis") === 0 ? "/sis/" : "/";
    var cookie =
      name +
      "=" +
      encodeURIComponent(String(seconds)) +
      "; path=" +
      path +
      "; max-age=" +
      maxAge +
      "; SameSite=Lax";
    if (location.protocol === "https:") {
      cookie += "; Secure";
    }
    document.cookie = cookie;
  }

  function boolSetting(value, fallback) {
    if (typeof value === "boolean") {
      return value;
    }
    return Boolean(fallback);
  }

  function loadSettings() {
    var base = {
      quays: (defaults.quays || []).map(cloneQuay),
      elementsPerQuay: defaults.elementsPerQuay || 3,
      compactDepartures: defaults.compactDepartures || 4,
      showJourneyProgress: boolSetting(defaults.showJourneyProgress, true),
      showOccupancy: boolSetting(defaults.showOccupancy, true),
      showServiceRuns: boolSetting(defaults.showServiceRuns, true),
      githubCheckIntervalSeconds: normalizeGithubInterval(
        defaults.githubCheckIntervalSeconds || 300
      ),
    };
    var cookieInterval = readGithubIntervalCookie();
    if (cookieInterval !== null) {
      base.githubCheckIntervalSeconds = cookieInterval;
    }
    try {
      var raw = localStorage.getItem(defaults.storageKey);
      if (!raw) {
        return base;
      }
      var parsed = JSON.parse(raw);
      if (parsed.quays && parsed.quays.length) {
        base.quays = parsed.quays.map(cloneQuay);
      }
      if (parsed.elementsPerQuay) {
        base.elementsPerQuay = Math.max(2, Math.min(8, Number(parsed.elementsPerQuay) || 3));
      }
      if (parsed.showJourneyProgress !== undefined) {
        base.showJourneyProgress = Boolean(parsed.showJourneyProgress);
      }
      if (parsed.showOccupancy !== undefined) {
        base.showOccupancy = Boolean(parsed.showOccupancy);
      }
      if (parsed.showServiceRuns !== undefined) {
        base.showServiceRuns = Boolean(parsed.showServiceRuns);
      }
      if (parsed.githubCheckIntervalSeconds !== undefined) {
        base.githubCheckIntervalSeconds = normalizeGithubInterval(
          parsed.githubCheckIntervalSeconds
        );
      }
    } catch (error) {
      console.warn("Kunne ikke lese innstillinger", error);
    }
    return base;
  }

  function saveSettings() {
    localStorage.setItem(
      defaults.storageKey,
      JSON.stringify({
        quays: settings.quays,
        elementsPerQuay: settings.elementsPerQuay,
        showJourneyProgress: settings.showJourneyProgress,
        showOccupancy: settings.showOccupancy,
        showServiceRuns: settings.showServiceRuns,
        githubCheckIntervalSeconds: settings.githubCheckIntervalSeconds,
      })
    );
    writeGithubIntervalCookie(settings.githubCheckIntervalSeconds);
  }

  function cloneQuay(quay) {
    return {
      kind: quay.kind === "stopPlace" ? "stopPlace" : "quay",
      id: quay.id,
      name: quay.name || quay.id,
      direction:
        quay.direction ||
        quay.description ||
        (quay.kind === "stopPlace" ? "Alle retninger" : ""),
      lineIds: Array.isArray(quay.lineIds) ? quay.lineIds.slice() : [],
      availableLines: Array.isArray(quay.availableLines)
        ? quay.availableLines.map(function (line) {
            return {
              id: line.id,
              publicCode: line.publicCode,
              name: line.name || "",
              transportMode: line.transportMode || "",
            };
          })
        : [],
    };
  }

  function quayUsesLineFilter(quay) {
    return (
      Array.isArray(quay.lineIds) &&
      quay.lineIds.length > 0 &&
      (!quay.availableLines.length ||
        quay.lineIds.length < quay.availableLines.length)
    );
  }

  function filterDeparturesForQuay(departures, quay) {
    if (!quayUsesLineFilter(quay)) {
      return departures;
    }
    return departures.filter(function (dep) {
      if (dep.lineId && quay.lineIds.indexOf(dep.lineId) !== -1) {
        return true;
      }
      return quay.availableLines.some(function (line) {
        return (
          quay.lineIds.indexOf(line.id) !== -1 &&
          line.publicCode === dep.line
        );
      });
    });
  }

  async function ensureQuayLines(quay) {
    if (quay.availableLines && quay.availableLines.length) {
      return quay;
    }
    try {
      var lines = await window.NV5Entur.fetchPlaceLines(defaults, quay);
      quay.availableLines = lines;
      if (!quay.lineIds || !quay.lineIds.length) {
        quay.lineIds = lines.map(function (line) {
          return line.id;
        });
      }
    } catch (error) {
      console.warn("Kunne ikke hente linjer for", quay.id, error);
      quay.availableLines = quay.availableLines || [];
    }
    return quay;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatClock(date, withSeconds) {
    var time = pad(date.getHours()) + ":" + pad(date.getMinutes());
    if (withSeconds) {
      time += ":" + pad(date.getSeconds());
    }
    return time;
  }

  function formatDepartureLabel(departure, now) {
    if (!departure.expected) {
      return "–";
    }
    var minutes = Math.round(
      (departure.expected.getTime() - now.getTime()) / 60000
    );
    if (minutes <= 0) {
      return "Nå";
    }
    if (minutes < 10) {
      return minutes + " min";
    }
    return formatClock(departure.expected, false);
  }

  function journeyProgressLabel(departure, now) {
    if (
      !settings.showJourneyProgress ||
      !window.NV5Entur ||
      typeof window.NV5Entur.journeyProgressLabel !== "function"
    ) {
      return "";
    }
    return window.NV5Entur.journeyProgressLabel(departure, now) || "";
  }

  function delaySecondsOf(departure) {
    if (
      typeof departure.delaySeconds === "number" &&
      isFinite(departure.delaySeconds)
    ) {
      return departure.delaySeconds;
    }
    if (departure.expected && departure.aimed) {
      return Math.round(
        (departure.expected.getTime() - departure.aimed.getTime()) / 1000
      );
    }
    return 0;
  }

  /** Gul >29s, rød >3 min. Tom streng = ingen forsinkelsesfarge. */
  function delayTimeClass(departure) {
    if (!departure || departure.cancelled) {
      return departure && departure.cancelled ? "is-delay-late" : "";
    }
    var delay = delaySecondsOf(departure);
    if (delay > 180) {
      return "is-delay-late";
    }
    if (delay > 29) {
      return "is-delay-warn";
    }
    return "";
  }

  function departureMeta(departure, includeDirection) {
    var parts = [];
    if (departure.serviceRun) {
      parts.push("Tjenestekjøring");
    } else if (departure.cancelled) {
      parts.push("Innstilt");
    } else if (departure.realtime) {
      parts.push("Sanntid");
    } else {
      parts.push("Rutetid");
    }
    if (includeDirection && departure.quayDescription) {
      parts.push(departure.quayDescription);
    }
    if (
      settings.showOccupancy &&
      departure.occupancyLabel &&
      !departure.serviceRun
    ) {
      parts.push(departure.occupancyLabel);
    }
    return parts.join(" · ");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateClock() {
    var now = new Date();
    els.clock.textContent = formatClock(now, true);
    els.clock.setAttribute("datetime", now.toISOString());
  }

  function updateBoardTitle() {
    if (els.boardTitle) {
      els.boardTitle.textContent = "NV5-SIS";
    }
  }

  function showStatus(message, isError) {
    els.status.hidden = false;
    els.status.textContent = message;
    els.status.classList.toggle("is-error", Boolean(isError));
  }

  function hideStatus() {
    els.status.hidden = true;
    els.status.textContent = "";
    els.status.classList.remove("is-error");
  }

  function departuresNeeded() {
    var featured = Math.max(0, settings.elementsPerQuay - 1);
    return featured + (defaults.compactDepartures || 4);
  }

  function lineStyleAttr(departure) {
    if (!departure.colour) {
      return "";
    }
    return (
      ' style="background:' +
      escapeHtml(departure.colour) +
      ";color:" +
      escapeHtml(departure.textColour || "#fff") +
      '"'
    );
  }

  function renderDepartureRow(departure, now, includeDirection, animate) {
    var timeLabel = formatDepartureLabel(departure, now);
    var isNow = timeLabel === "Nå";
    var meta = departureMeta(departure, includeDirection);
    if (departure.situations[0] && !departure.serviceRun) {
      meta += " · " + departure.situations[0];
    }
    var progress = journeyProgressLabel(departure, now);
    var delayClass = delayTimeClass(departure);
    var timeClasses = "departure__time";
    if (delayClass) {
      timeClasses += " " + delayClass;
    } else if (isNow) {
      timeClasses += " is-now";
    }

    return (
      '<li class="departure' +
      (departure.cancelled ? " departure--cancelled" : "") +
      (departure.serviceRun ? " departure--service-run" : "") +
      (animate ? " departure--enter" : "") +
      '">' +
      '<span class="departure__line"' +
      lineStyleAttr(departure) +
      ">" +
      escapeHtml(departure.line) +
      "</span>" +
      '<div class="departure__dest-wrap">' +
      '<div class="departure__destination">' +
      escapeHtml(departure.destination) +
      "</div>" +
      '<div class="departure__meta' +
      (departure.cancelled ? " is-late" : "") +
      '">' +
      escapeHtml(meta) +
      "</div>" +
      (progress
        ? '<div class="departure__progress">' +
          escapeHtml(progress) +
          "</div>"
        : "") +
      "</div>" +
      '<span class="' +
      timeClasses +
      '">' +
      escapeHtml(timeLabel) +
      "</span>" +
      "</li>"
    );
  }

  function renderTickerElement(departures, now, animate) {
    if (!departures.length) {
      return "";
    }
    var first = departures[0];
    var uniqueLines = departures
      .map(function (dep) {
        return dep.line || "";
      })
      .filter(function (line, index, all) {
        return line && all.indexOf(line) === index;
      });
    var multiLine = uniqueLines.length > 1;
    var uniqueDestinations = departures
      .map(function (dep) {
        return dep.destination;
      })
      .filter(function (dest, index, all) {
        return all.indexOf(dest) === index;
      });
    var multiDestination = uniqueDestinations.length > 1;
    var items = departures.map(function (dep) {
      var kind = dep.cancelled
        ? "Innstilt"
        : dep.realtime
          ? "Sanntid"
          : "Rutetid";
      var time = formatDepartureLabel(dep, now);
      var delayClass = delayTimeClass(dep);
      return {
        time: time,
        line: dep.line || "–",
        colour: dep.colour || "",
        textColour: dep.textColour || "",
        destination: dep.destination || "",
        kind: kind,
        cancelled: Boolean(dep.cancelled),
        delayClass: delayClass,
        now: time === "Nå",
      };
    });
    var destinationLabel = multiDestination
      ? first.destination || "Neste avganger"
      : uniqueDestinations[0] || "Neste avganger";

    return (
      '<li class="departure departure--ticker' +
      (animate ? " departure--enter" : "") +
      '" data-ticker-items="' +
      escapeHtml(JSON.stringify(items)) +
      '" data-ticker-sync-dest="' +
      (multiLine || multiDestination ? "1" : "0") +
      '">' +
      '<span class="departure__line" data-ticker-line' +
      lineStyleAttr(first) +
      ">" +
      escapeHtml(first.line) +
      "</span>" +
      '<div class="departure__dest-wrap">' +
      '<div class="departure__destination" data-ticker-destination>' +
      escapeHtml(destinationLabel) +
      "</div>" +
      '<div class="departure__meta' +
      (items[0].cancelled ? " is-late" : "") +
      '" data-ticker-meta>' +
      escapeHtml(items[0].kind) +
      "</div>" +
      "</div>" +
      '<span class="departure__time departure__ticker' +
      (items[0].delayClass
        ? " " + items[0].delayClass
        : items[0].now
          ? " is-now"
          : "") +
      '" aria-live="off"></span>' +
      "</li>"
    );
  }

  function stopTickers() {
    tickerStops.forEach(function (stop) {
      if (typeof stop === "function") {
        stop();
      }
    });
    tickerStops = [];
  }

  function startTickerOnNode(node) {
    var raw = node.getAttribute("data-ticker-items") || "[]";
    var items;
    try {
      items = JSON.parse(raw);
    } catch (error) {
      items = [];
    }
    if (!items.length) {
      return;
    }
    var slot = node.querySelector(".departure__ticker");
    var meta = node.querySelector("[data-ticker-meta]");
    var lineEl = node.querySelector("[data-ticker-line]");
    var destEl = node.querySelector("[data-ticker-destination]");
    var syncDestination = node.getAttribute("data-ticker-sync-dest") === "1";
    if (!slot) {
      return;
    }

    var track = document.createElement("span");
    track.className = "departure__ticker-track";
    var sequence = items.concat(items);
    sequence.forEach(function (item, index) {
      var el = document.createElement("span");
      el.className = "departure__ticker-item";
      if (item.delayClass) {
        el.className += " " + item.delayClass;
      } else if (item.now) {
        el.className += " is-now";
      }
      el.textContent = item.time;
      el.setAttribute("data-item-index", String(index % items.length));
      track.appendChild(el);
    });
    slot.innerHTML = "";
    slot.appendChild(track);

    var offset = 0;
    var lastTs = 0;
    var activeIndex = -1;
    var rafId = 0;
    var speedPxPerSec = 14;
    var started = false;
    var step = 0;
    var viewHeight = 0;
    // Bytt linje/dest når neste tid er i ferd med å dukke opp nederst,
    // ikke når forrige tid er på vei ut øverst.
    var ACTIVE_LEAD = 0.82;

    function setActive(index) {
      if (index === activeIndex || !items[index]) {
        return;
      }
      activeIndex = index;
      var item = items[index];
      if (meta) {
        meta.textContent = item.kind;
        meta.classList.toggle("is-late", Boolean(item.cancelled));
      }
      if (lineEl && item.line) {
        lineEl.textContent = item.line;
        if (item.colour) {
          lineEl.style.background = item.colour;
          lineEl.style.color = item.textColour || "#fff";
        } else {
          lineEl.style.background = "";
          lineEl.style.color = "";
        }
      }
      if (destEl && syncDestination && item.destination) {
        destEl.textContent = item.destination;
      }
      slot.classList.remove("is-now", "is-delay-warn", "is-delay-late");
      if (item.delayClass) {
        slot.classList.add(item.delayClass);
      } else if (item.now) {
        slot.classList.add("is-now");
      }
    }

    // Steg = viewport-høyde, så neste tid kommer inn i bunnen
    // i det forrige treffer toppgrensen.
    function layoutTicker() {
      var first = track.children[0];
      viewHeight = slot.clientHeight;
      if (!first || viewHeight <= 0) {
        return false;
      }
      var itemHeight = first.getBoundingClientRect().height;
      var gap = Math.max(4, viewHeight - itemHeight);
      track.style.gap = gap + "px";
      step = itemHeight + gap;
      return step > 0;
    }

    function frame(ts) {
      if (document.hidden || tickersPaused) {
        lastTs = 0;
        rafId = window.requestAnimationFrame(frame);
        return;
      }

      if (!lastTs) {
        lastTs = ts;
      }
      var dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      if (!started) {
        if (!layoutTicker()) {
          rafId = window.requestAnimationFrame(frame);
          return;
        }
        // Start med første tid rett under synlig flate
        offset = -(viewHeight - 2);
        started = true;
      }

      var loopHeight = step * items.length;
      if (loopHeight > 0) {
        offset += speedPxPerSec * dt;
        while (offset >= loopHeight) {
          offset -= loopHeight;
        }
        track.style.transform = "translate3d(0, " + -offset + "px, 0)";
        var visual = offset < 0 ? 0 : offset;
        setActive(Math.floor(visual / step) % items.length);
      }

      rafId = window.requestAnimationFrame(frame);
    }

    setActive(0);
    rafId = window.requestAnimationFrame(frame);
    tickerStops.push(function () {
      window.cancelAnimationFrame(rafId);
    });
  }

  function startTickers() {
    stopTickers();
    var nodes = els.boards.querySelectorAll(".departure--ticker");
    nodes.forEach(startTickerOnNode);
  }

  function syncAgeState(updatedAt) {
    if (!updatedAt) {
      return "is-pending";
    }
    var ageSec = (Date.now() - updatedAt.getTime()) / 1000;
    if (ageSec >= 179) {
      return "is-error";
    }
    if (ageSec >= 29) {
      return "is-stale";
    }
    return "is-ok";
  }

  function syncStatusText(entry) {
    if (!entry || entry.pending) {
      return { text: "…", state: "is-pending" };
    }
    if (entry.updatedAt) {
      var time = formatClock(entry.updatedAt, true);
      var ageState = syncAgeState(entry.updatedAt);
      if (entry.stale || entry.error) {
        return {
          text: time,
          state: ageState === "is-ok" ? "is-stale" : ageState,
        };
      }
      return {
        text: time,
        state: ageState,
      };
    }
    if (entry.error) {
      var errMsg =
        (entry.error && entry.error.message) || "Kunne ikke oppdatere";
      return { text: errMsg, state: "is-error" };
    }
    return { text: "Venter…", state: "is-pending" };
  }

  function entriesFromCache() {
    return settings.quays.map(function (quay) {
      return (
        boardCache[quayKey(quay)] || {
          quay: quay,
          pending: true,
          updatedAt: null,
          error: null,
          stale: false,
        }
      );
    });
  }

  function refreshSyncStatuses() {
    if (!settings.quays.length || !els.boards.children.length) {
      return;
    }
    patchSyncStatus(entriesFromCache());
  }

  function boardSignature(entries, now) {
    return entries
      .map(function (entry) {
        var deps =
          (entry.result && entry.result.departures) || [];
        var depSig = deps
          .map(function (dep) {
            return [
              dep.lineId || "",
              dep.line || "",
              dep.destination || "",
              formatDepartureLabel(dep, now),
              dep.expected ? dep.expected.toISOString() : "",
              dep.cancelled ? "1" : "0",
              dep.realtime ? "1" : "0",
              String(delaySecondsOf(dep)),
              delayTimeClass(dep),
              dep.serviceRun ? "t" : "",
              journeyProgressLabel(dep, now),
              dep.occupancyStatus || "",
              entry.stale ? "s" : "f",
            ].join(",");
          })
          .join(";");
        return quayKey(entry.quay) + "#" + depSig;
      })
      .join("|");
  }

  function patchSyncStatus(entries) {
    var boards = els.boards.querySelectorAll(".quay-board");
    entries.forEach(function (entry, index) {
      var board = boards[index];
      if (!board) {
        return;
      }
      var syncEl = board.querySelector(".quay-board__sync");
      if (!syncEl) {
        return;
      }
      var status = syncStatusText(entry);
      syncEl.textContent = status.text;
      syncEl.className = "quay-board__sync " + status.state;
    });
  }

  function renderQuayBoard(entry, now, animate) {
    var quayConfig = entry.quay;
    var result = entry.result || { name: quayConfig.name, departures: [] };
    var featuredCount = Math.max(0, settings.elementsPerQuay - 1);
    var compactCount = defaults.compactDepartures || 4;
    var deps = result.departures || [];
    var featured = deps.slice(0, featuredCount);
    var upcoming = deps.slice(featuredCount, featuredCount + compactCount);
    var direction = quayConfig.direction || result.description || "";
    var showDirectionOnRows = quayConfig.kind === "stopPlace";
    var status = syncStatusText(entry);

    var html =
      '<section class="quay-board" data-quay-key="' +
      escapeHtml(quayKey(quayConfig)) +
      '">' +
      '<header class="quay-board__header">' +
      '<h2 class="quay-board__name">' +
      escapeHtml(quayConfig.name || result.name) +
      "</h2>" +
      '<div class="quay-board__subheader">' +
      '<p class="quay-board__direction">' +
      escapeHtml(direction || "") +
      "</p>" +
      '<p class="quay-board__sync ' +
      status.state +
      '">' +
      escapeHtml(status.text) +
      "</p>" +
      "</div>" +
      "</header>";

    if (entry.error && !deps.length) {
      html +=
        '<p class="quay-board__empty">' +
        escapeHtml(
          (entry.error && entry.error.message) ||
            "Kunne ikke hente avganger."
        ) +
        "</p>";
      html += "</section>";
      return html;
    }

    if (!deps.length) {
      html += '<p class="quay-board__empty">Ingen avganger akkurat nå.</p>';
      html += "</section>";
      return html;
    }

    html += '<ul class="departures">';
    featured.forEach(function (dep) {
      html += renderDepartureRow(dep, now, showDirectionOnRows, animate);
    });
    if (upcoming.length && settings.elementsPerQuay >= 2) {
      html += renderTickerElement(upcoming, now, animate);
    }
    html += "</ul>";

    html += "</section>";
    return html;
  }

  function renderBoards(entries, now) {
    var signature = boardSignature(entries, now);
    if (
      signature === lastBoardSignature &&
      els.boards.children.length === entries.length
    ) {
      patchSyncStatus(entries);
      return;
    }

    var animate = !lastBoardSignature;
    lastBoardSignature = signature;
    stopTickers();
    els.boards.innerHTML = entries
      .map(function (entry) {
        return renderQuayBoard(entry, now, animate);
      })
      .join("");
    startTickers();
  }

  async function refresh() {
    if (refreshInFlight) {
      return;
    }
    if (!settings.quays.length) {
      stopTickers();
      els.boards.innerHTML = "";
      boardCache = {};
      lastBoardSignature = "";
      showStatus("Ingen holdeplasser valgt. Åpne innstillinger.", false);
      return;
    }

    refreshInFlight = true;
    try {
      var needed = departuresNeeded();
      var settled = await Promise.allSettled(
        settings.quays.map(async function (quay) {
          await ensureQuayLines(quay);
          var fetchCount = quayUsesLineFilter(quay)
            ? Math.max(needed * 3, 20)
            : settings.showServiceRuns
              ? needed
              : Math.max(needed * 2, needed + 6);
          var result = await window.NV5Entur.fetchDepartures(
            defaults,
            quay,
            fetchCount
          );
          var filtered = filterDeparturesForQuay(result.departures, quay);
          if (!settings.showServiceRuns) {
            filtered = filtered.filter(function (dep) {
              return !dep.serviceRun;
            });
          }
          result.departures = filtered.slice(0, needed);
          return { quay: quay, result: result };
        })
      );

      var now = new Date();
      var activeKeys = {};
      var entries = settings.quays.map(function (quay, index) {
        var key = quayKey(quay);
        activeKeys[key] = true;
        var outcome = settled[index];
        var prev = boardCache[key];
        if (outcome.status === "fulfilled") {
          boardCache[key] = {
            quay: quay,
            result: outcome.value.result,
            updatedAt: now,
            error: null,
            stale: false,
            pending: false,
          };
        } else {
          console.error(outcome.reason);
          if (prev && prev.result) {
            boardCache[key] = {
              quay: quay,
              result: prev.result,
              updatedAt: prev.updatedAt,
              error: outcome.reason,
              stale: true,
              pending: false,
            };
          } else {
            boardCache[key] = {
              quay: quay,
              result: { name: quay.name, departures: [] },
              updatedAt: null,
              error: outcome.reason || new Error("Ukjent feil"),
              stale: false,
              pending: false,
            };
          }
        }
        return boardCache[key];
      });

      Object.keys(boardCache).forEach(function (key) {
        if (!activeKeys[key]) {
          delete boardCache[key];
        }
      });

      var allFailed = entries.every(function (entry) {
        return entry.error && (!entry.result || !entry.result.departures.length);
      });
      var anySuccess = entries.some(function (entry) {
        return !entry.error;
      });
      var anyStale = entries.some(function (entry) {
        return entry.stale;
      });

      if (allFailed && !anyStale) {
        showStatus("Kunne ikke hente sanntidsdata. Prøver igjen…", true);
      } else if (anyStale && !anySuccess) {
        showStatus("Kunne ikke oppdatere. Viser forrige data…", true);
      } else {
        hideStatus();
      }

      updateBoardTitle();
      renderBoards(entries, now);
    } finally {
      refreshInFlight = false;
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", function () {
        wakeLock = null;
      });
    } catch (error) {
      console.warn("Wake Lock ikke tilgjengelig", error);
    }
  }

  function renderSelectedQuays() {
    if (!draftQuays.length) {
      els.selectedQuays.innerHTML =
        '<li class="settings__empty">Ingen valgt ennå</li>';
      return;
    }
    els.selectedQuays.innerHTML = draftQuays
      .map(function (quay, index) {
        var linesHtml = "";
        if (quay.availableLines && quay.availableLines.length) {
          linesHtml =
            '<div class="settings__lines">' +
            '<span class="settings__lines-label">Linjer (velg en eller flere)</span>' +
            '<div class="settings__line-options">' +
            quay.availableLines
              .map(function (line) {
                var checked =
                  !quay.lineIds.length ||
                  quay.lineIds.indexOf(line.id) !== -1;
                var mode = modeLabel(line.transportMode);
                return (
                  '<label class="settings__line-option">' +
                  '<input type="checkbox" data-quay-index="' +
                  index +
                  '" data-line-id="' +
                  escapeHtml(line.id) +
                  '"' +
                  (checked ? " checked" : "") +
                  "> " +
                  "<span><strong>" +
                  escapeHtml(line.publicCode) +
                  "</strong>" +
                  (mode ? " · " + escapeHtml(mode) : "") +
                  (line.name
                    ? '<em>' + escapeHtml(line.name) + "</em>"
                    : "") +
                  "</span></label>"
                );
              })
              .join("") +
            "</div></div>";
        } else {
          linesHtml =
            '<p class="settings__hint">Henter linjer…</p>';
        }
        return (
          '<li class="settings__quay-item">' +
          '<div class="settings__quay-top">' +
          "<div><strong>" +
          escapeHtml(quay.name) +
          "</strong>" +
          (quay.direction
            ? "<span>" + escapeHtml(quay.direction) + "</span>"
            : "") +
          "</div>" +
          '<button type="button" data-remove="' +
          index +
          '">Fjern</button>' +
          "</div>" +
          linesHtml +
          "</li>"
        );
      })
      .join("");
  }

  async function openSettings() {
    draftQuays = settings.quays.map(cloneQuay);
    els.elementsPerQuay.value = String(settings.elementsPerQuay);
    if (els.showJourneyProgress) {
      els.showJourneyProgress.checked = settings.showJourneyProgress;
    }
    if (els.showOccupancy) {
      els.showOccupancy.checked = settings.showOccupancy;
    }
    if (els.showServiceRuns) {
      els.showServiceRuns.checked = settings.showServiceRuns;
    }
    els.githubCheckInterval.value = String(settings.githubCheckIntervalSeconds);
    els.stopSearch.value = "";
    els.searchResults.innerHTML = "";
    els.quayPick.hidden = true;
    els.quayResults.innerHTML = "";
    renderSelectedQuays();
    if (typeof els.settingsDialog.showModal === "function") {
      els.settingsDialog.showModal();
    } else {
      els.settingsDialog.setAttribute("open", "");
    }
    await Promise.all(draftQuays.map(ensureQuayLines));
    renderSelectedQuays();
  }

  function closeSettings() {
    if (typeof els.settingsDialog.close === "function") {
      els.settingsDialog.close();
    } else {
      els.settingsDialog.removeAttribute("open");
    }
  }

  function applySettings() {
    var prevGithub = settings.githubCheckIntervalSeconds;
    settings.elementsPerQuay = Math.max(
      2,
      Math.min(8, Number(els.elementsPerQuay.value) || 3)
    );
    settings.showJourneyProgress = els.showJourneyProgress
      ? els.showJourneyProgress.checked
      : true;
    settings.showOccupancy = els.showOccupancy
      ? els.showOccupancy.checked
      : true;
    settings.showServiceRuns = els.showServiceRuns
      ? els.showServiceRuns.checked
      : true;
    settings.githubCheckIntervalSeconds = normalizeGithubInterval(
      els.githubCheckInterval.value
    );
    settings.quays = draftQuays.map(cloneQuay);
    saveSettings();
    closeSettings();
    // Kun full sync/reload når GitHub-intervallet endres (PHP leser cookie)
    if (settings.githubCheckIntervalSeconds !== prevGithub) {
      var url = new URL(window.location.href);
      url.searchParams.set("sync", "main");
      window.location.replace(url.toString());
      return;
    }
    boardCache = {};
    lastBoardSignature = "";
    refresh();
  }

  async function runSearch(text) {
    els.quayPick.hidden = true;
    els.quayResults.innerHTML = "";
    if (!text || text.trim().length < 2) {
      els.searchResults.innerHTML = "";
      return;
    }
    try {
      var stops = await window.NV5Entur.searchStops(defaults, text.trim());
      if (!stops.length) {
        els.searchResults.innerHTML =
          '<li class="settings__empty">Ingen treff</li>';
        return;
      }
      els.searchResults.innerHTML = stops
        .map(function (stop) {
          return (
            "<li>" +
            '<button type="button" data-stop="' +
            escapeHtml(stop.id) +
            '" data-name="' +
            escapeHtml(stop.name) +
            '">' +
            escapeHtml(stop.label) +
            "</button>" +
            "</li>"
          );
        })
        .join("");
    } catch (error) {
      console.error(error);
      els.searchResults.innerHTML =
        '<li class="settings__empty">Søk feilet</li>';
    }
  }

  function modeRank(modes) {
    if ((modes || []).indexOf("metro") !== -1) {
      return 0;
    }
    if ((modes || []).indexOf("tram") !== -1) {
      return 1;
    }
    if ((modes || []).indexOf("rail") !== -1) {
      return 2;
    }
    if ((modes || []).indexOf("bus") !== -1) {
      return 3;
    }
    return 9;
  }

  function formatQuayChoice(quay) {
    var modes = quay.modes || [];
    var modeText = modes
      .map(function (mode) {
        return modeLabel(mode);
      })
      .join(", ");
    if (!modeText && quay.lines && quay.lines.length) {
      modeText = modeLabel(quay.lines[0].transportMode) || "Kollektiv";
    }

    var titleParts = [];
    if (modeText) {
      titleParts.push(modeText);
    }
    if (quay.description) {
      titleParts.push(quay.description);
    } else if (quay.publicCode) {
      titleParts.push("Stoppested " + quay.publicCode);
    } else {
      titleParts.push("Kai uten navn");
    }

    var detailParts = [];
    if (quay.publicCode) {
      detailParts.push("Plattform/stopp " + quay.publicCode);
    }
    var lineCodes = (quay.lineCodes || []).slice();
    if (!lineCodes.length && quay.lines) {
      lineCodes = quay.lines
        .map(function (line) {
          return line.publicCode;
        })
        .filter(Boolean);
    }
    if (lineCodes.length) {
      var shown = lineCodes.slice(0, 8);
      detailParts.push(
        "Linje " +
          shown.join(", ") +
          (lineCodes.length > shown.length ? " …" : "")
      );
    } else {
      detailParts.push("Ingen linjer registrert");
    }

    var direction =
      quay.description ||
      (quay.publicCode ? "Stoppested " + quay.publicCode : "") ||
      modeText ||
      "Kai";

    return {
      title: titleParts.join(" · "),
      detail: detailParts.join(" · "),
      direction: direction,
      sortKey: String(100 + modeRank(modes)) + "-" + (quay.publicCode || "zzz"),
    };
  }

  async function pickStop(stopId, stopName) {
    els.searchResults.innerHTML = "";
    els.stopSearch.value = stopName;
    try {
      var stop = await window.NV5Entur.fetchStopQuays(defaults, stopId);
      els.quayPick.hidden = false;
      els.quayPickTitle.textContent =
        "Velg retning/plattform for " + stop.name + " (eller alle)";

      // Kun kaier med linjer — de andre er ofte uten avganger
      var usefulQuays = (stop.quays || []).filter(function (quay) {
        return quay.lines && quay.lines.length;
      });
      if (!usefulQuays.length) {
        usefulQuays = (stop.quays || []).filter(function (quay) {
          return quay.description || quay.publicCode;
        });
      }

      usefulQuays.sort(function (a, b) {
        return formatQuayChoice(a).sortKey.localeCompare(
          formatQuayChoice(b).sortKey,
          "nb"
        );
      });

      var allLines = [];
      var lineMap = {};
      usefulQuays.forEach(function (quay) {
        (quay.lines || []).forEach(function (line) {
          if (line.id && !lineMap[line.id]) {
            lineMap[line.id] = line;
            allLines.push(line);
          }
        });
      });
      allLines.sort(function (a, b) {
        return String(a.publicCode).localeCompare(String(b.publicCode), "nb");
      });

      var options =
        '<li><button type="button" class="settings__choice" data-kind="stopPlace" data-quay="' +
        escapeHtml(stop.id) +
        '" data-name="' +
        escapeHtml(stop.name) +
        '" data-direction="Alle retninger" data-lines="' +
        escapeHtml(JSON.stringify(allLines)) +
        '"><strong>Alle retninger</strong><span>Viser avganger for hele holdeplassen</span></button></li>';

      options += usefulQuays
        .map(function (quay) {
          var choice = formatQuayChoice(quay);
          return (
            "<li>" +
            '<button type="button" class="settings__choice" data-kind="quay" data-quay="' +
            escapeHtml(quay.id) +
            '" data-name="' +
            escapeHtml(stop.name) +
            '" data-direction="' +
            escapeHtml(choice.direction) +
            '" data-lines="' +
            escapeHtml(JSON.stringify(quay.lines || [])) +
            '"><strong>' +
            escapeHtml(choice.title) +
            "</strong><span>" +
            escapeHtml(choice.detail) +
            "</span></button>" +
            "</li>"
          );
        })
        .join("");

      els.quayResults.innerHTML = options;
    } catch (error) {
      console.error(error);
      els.quayResults.innerHTML =
        '<li class="settings__empty">Kunne ikke hente kaier</li>';
      els.quayPick.hidden = false;
    }
  }

  async function addQuay(quay) {
    var exists = draftQuays.some(function (item) {
      return item.id === quay.id && item.kind === (quay.kind || "quay");
    });
    if (exists) {
      return;
    }
    var next = cloneQuay(quay);
    if (quay.lines && quay.lines.length) {
      next.availableLines = quay.lines.map(function (line) {
        return {
          id: line.id,
          publicCode: line.publicCode,
          name: line.name || "",
          transportMode: line.transportMode || "",
        };
      });
      next.lineIds = next.availableLines.map(function (line) {
        return line.id;
      });
    } else {
      await ensureQuayLines(next);
    }
    draftQuays.push(next);
    renderSelectedQuays();
    els.quayPick.hidden = true;
    els.stopSearch.value = "";
  }

  function isMenuOpen() {
    return Boolean(els.menuPanel && !els.menuPanel.hidden);
  }

  function setMenuOpen(open) {
    if (!els.menuToggle || !els.menuPanel) {
      return;
    }
    if (open) {
      els.menuPanel.hidden = false;
      els.menuPanel.removeAttribute("hidden");
    } else {
      els.menuPanel.hidden = true;
      els.menuPanel.setAttribute("hidden", "");
    }
    els.menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function forceGithubSync(target) {
    closeMenu();
    var syncTarget = target === "server" || target === "main" ? target : "both";
    var url = new URL(window.location.href);
    url.searchParams.set("sync", syncTarget);
    window.location.replace(url.toString());
  }

  function bindSettings() {
    if (els.menuToggle) {
      els.menuToggle.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(!isMenuOpen());
      });
    }
    if (els.syncServer) {
      els.syncServer.addEventListener("click", function () {
        closeSettings();
        forceGithubSync("server");
      });
    }
    if (els.syncBoard) {
      els.syncBoard.addEventListener("click", function () {
        forceGithubSync("main");
      });
    }
    // Lukk meny ved klikk utenfor (etter denne event-runden, så toggle ikke lukker med en gang)
    document.addEventListener("click", function (event) {
      if (!isMenuOpen()) {
        return;
      }
      if (event.target.closest("#appMenu")) {
        return;
      }
      closeMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    });

    els.settingsOpen.addEventListener("click", function () {
      closeMenu();
      openSettings();
    });
    els.settingsSave.addEventListener("click", function (event) {
      event.preventDefault();
      applySettings();
    });

    els.selectedQuays.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-remove]");
      if (!btn) {
        return;
      }
      draftQuays.splice(Number(btn.getAttribute("data-remove")), 1);
      renderSelectedQuays();
    });

    els.selectedQuays.addEventListener("change", function (event) {
      var input = event.target.closest("input[data-line-id]");
      if (!input) {
        return;
      }
      var index = Number(input.getAttribute("data-quay-index"));
      var quay = draftQuays[index];
      if (!quay) {
        return;
      }
      var selected = Array.prototype.slice
        .call(
          els.selectedQuays.querySelectorAll(
            'input[data-quay-index="' + index + '"]:checked'
          )
        )
        .map(function (el) {
          return el.getAttribute("data-line-id");
        });
      // Tomt valg er upraktisk — behold minst den siste hukede om alt fjernes
      if (!selected.length) {
        input.checked = true;
        selected = [input.getAttribute("data-line-id")];
      }
      quay.lineIds = selected;
    });

    els.stopSearch.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        runSearch(els.stopSearch.value);
      }, 300);
    });

    els.searchResults.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-stop]");
      if (!btn) {
        return;
      }
      pickStop(btn.getAttribute("data-stop"), btn.getAttribute("data-name"));
    });

    els.quayResults.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-quay]");
      if (!btn) {
        return;
      }
      var linesRaw = btn.getAttribute("data-lines") || "[]";
      var lines = [];
      try {
        lines = JSON.parse(linesRaw);
      } catch (error) {
        lines = [];
      }
      addQuay({
        kind: btn.getAttribute("data-kind") || "quay",
        id: btn.getAttribute("data-quay"),
        name: btn.getAttribute("data-name"),
        direction: btn.getAttribute("data-direction") || "",
        lines: lines,
      });
    });
  }

  function start() {
    // Hold cookie synket så PHP kjenner intervallet
    writeGithubIntervalCookie(settings.githubCheckIntervalSeconds);
    // Rydd bort sync fra adresselinjen etter sync
    var bootUrl = new URL(window.location.href);
    if (bootUrl.searchParams.has("sync")) {
      bootUrl.searchParams.delete("sync");
      window.history.replaceState({}, "", bootUrl.toString());
    }

    updateBoardTitle();
    updateClock();
    setInterval(function () {
      updateClock();
      if (settings.quays.length) {
        renderBoards(entriesFromCache(), new Date());
      } else {
        refreshSyncStatuses();
      }
    }, 1000);
    bindSettings();
    refresh();
    refreshTimer = setInterval(refresh, defaults.pollIntervalMs);
    requestWakeLock();

    if (defaults.pageReloadIntervalMs > 0) {
      setTimeout(function () {
        location.reload();
      }, defaults.pageReloadIntervalMs);
    }

    document.addEventListener("visibilitychange", function () {
      tickersPaused = document.hidden;
      if (document.visibilityState === "visible") {
        refresh();
        requestWakeLock();
      }
    });
  }

  start();
})();
