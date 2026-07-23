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
    clearLocal: document.getElementById("clearLocal"),
    settingsDialog: document.getElementById("settingsDialog"),
    settingsSave: document.getElementById("settingsSave"),
    elementsPerQuay: document.getElementById("elementsPerQuay"),
    showJourneyProgress: document.getElementById("showJourneyProgress"),
    showOccupancy: document.getElementById("showOccupancy"),
    showServiceRuns: document.getElementById("showServiceRuns"),
    showBuildInfo: document.getElementById("showBuildInfo"),
    buildFooter: document.getElementById("buildFooter"),
    buildServerSha: document.getElementById("buildServerSha"),
    buildBoardSha: document.getElementById("buildBoardSha"),
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
    // Minimum 60s — bruk ?sync= for umiddelbar sjekk
    return Math.min(86400, Math.max(60, Math.round(seconds)));
  }

  /** Tillat kun #rgb / #rrggbb fra Entur før style-bruk. */
  function safeCssColor(value) {
    var raw = String(value || "").trim();
    if (/^#[0-9a-fA-F]{3}$/.test(raw) || /^#[0-9a-fA-F]{6}$/.test(raw)) {
      return raw;
    }
    return "";
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

  function githubCookiePath() {
    return location.pathname.indexOf("/sis") === 0 ? "/sis/" : "/";
  }

  function writeGithubIntervalCookie(seconds) {
    var name = defaults.githubIntervalCookie || "nv5_github_interval";
    var maxAge = 60 * 60 * 24 * 365;
    var cookie =
      name +
      "=" +
      encodeURIComponent(String(seconds)) +
      "; path=" +
      githubCookiePath() +
      "; max-age=" +
      maxAge +
      "; SameSite=Lax";
    if (location.protocol === "https:") {
      cookie += "; Secure";
    }
    document.cookie = cookie;
  }

  function clearGithubIntervalCookie() {
    var name = defaults.githubIntervalCookie || "nv5_github_interval";
    var paths = [githubCookiePath(), "/", "/sis/"];
    paths.forEach(function (path) {
      var cookie = name + "=; path=" + path + "; max-age=0; SameSite=Lax";
      if (location.protocol === "https:") {
        cookie += "; Secure";
      }
      document.cookie = cookie;
    });
  }

  function clearLocalData() {
    try {
      localStorage.removeItem(defaults.storageKey);
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf("nv5") === 0) {
          keys.push(key);
        }
      }
      keys.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (error) {
      console.warn("Kunne ikke tømme localStorage", error);
    }
    clearGithubIntervalCookie();
    closeMenu();
    var url = new URL(window.location.href);
    url.searchParams.delete("sync");
    window.location.replace(url.pathname + url.search + url.hash);
  }

  function boolSetting(value, fallback) {
    if (typeof value === "boolean") {
      return value;
    }
    return Boolean(fallback);
  }

  function shaTail(value) {
    var raw = String(value || "").trim();
    if (raw.length < 4) {
      return "";
    }
    return raw.slice(-4).toLowerCase();
  }

  function readMetaContent(name) {
    var node = document.querySelector('meta[name="' + name + '"]');
    return node ? node.getAttribute("content") || "" : "";
  }

  function readBuildShas() {
    return {
      server: shaTail(readMetaContent("nv5-server-sha")),
      board: shaTail(readMetaContent("nv5-board-sha")),
    };
  }

  function updateBuildFooter() {
    if (!els.buildFooter) {
      return;
    }
    var shas = readBuildShas();
    if (els.buildServerSha) {
      els.buildServerSha.textContent = shas.server || "----";
    }
    if (els.buildBoardSha) {
      els.buildBoardSha.textContent = shas.board || "----";
    }
    els.buildFooter.hidden = !(
      settings.showBuildInfo &&
      (shas.server || shas.board)
    );
  }

  function loadSettings() {
    var base = {
      quays: (defaults.quays || []).map(cloneQuay),
      elementsPerQuay: defaults.elementsPerQuay || 3,
      compactDepartures: defaults.compactDepartures || 4,
      showJourneyProgress: boolSetting(defaults.showJourneyProgress, true),
      showOccupancy: boolSetting(defaults.showOccupancy, true),
      showServiceRuns: boolSetting(defaults.showServiceRuns, true),
      showBuildInfo: boolSetting(defaults.showBuildInfo, true),
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
      if (parsed.showBuildInfo !== undefined) {
        base.showBuildInfo = Boolean(parsed.showBuildInfo);
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
        showBuildInfo: settings.showBuildInfo,
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

  function journeyProgress(departure, now) {
    if (
      !settings.showJourneyProgress ||
      !window.NV5Entur ||
      typeof window.NV5Entur.deriveJourneyProgress !== "function"
    ) {
      return null;
    }
    return window.NV5Entur.deriveJourneyProgress(departure, now);
  }

  function journeyProgressLabel(departure, now) {
    var progress = journeyProgress(departure, now);
    return (progress && progress.label) || "";
  }

  function journeyProgressKey(departure) {
    if (
      !settings.showJourneyProgress ||
      !window.NV5Entur ||
      typeof window.NV5Entur.journeyProgressKey !== "function"
    ) {
      return "";
    }
    return window.NV5Entur.journeyProgressKey(departure) || "";
  }

  function renderProgressHtml(progress) {
    if (!progress || !progress.label) {
      return "";
    }
    return (
      '<div class="departure__progress' +
      (progress.mode === "expected" ? " departure__progress--expected" : "") +
      '"' +
      (progress.mode
        ? ' data-progress-mode="' + escapeHtml(progress.mode) + '"'
        : "") +
      (progress.place
        ? ' data-progress-place="' + escapeHtml(progress.place) + '"'
        : "") +
      (progress.at
        ? ' data-progress-at="' + escapeHtml(progress.at.toISOString()) + '"'
        : "") +
      ">" +
      escapeHtml(progress.label) +
      "</div>"
    );
  }

  function patchProgressLabels(now) {
    var nodes = els.boards.querySelectorAll(
      '.departure__progress[data-progress-mode="seen"]'
    );
    if (!nodes.length) {
      return;
    }
    var formatRel =
      window.NV5Entur && typeof window.NV5Entur.formatRelativeSeen === "function"
        ? window.NV5Entur.formatRelativeSeen
        : null;
    nodes.forEach(function (node) {
      var place = node.getAttribute("data-progress-place") || "";
      var atRaw = node.getAttribute("data-progress-at");
      var at = atRaw ? new Date(atRaw) : null;
      if (!place || !at || isNaN(at.getTime()) || !formatRel) {
        return;
      }
      var seenRel = formatRel(at, now);
      var labeled =
        "Sist sett " + place + (seenRel ? " (" + seenRel + ")" : "");
      if (node.textContent !== labeled) {
        node.textContent = labeled;
      }
    });
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

  function formatDelayLabel(departure) {
    if (!departure || departure.cancelled) {
      return "";
    }
    var delay = delaySecondsOf(departure);
    if (delay <= 29) {
      return "";
    }
    if (delay < 60) {
      return "+" + delay + " sek";
    }
    var min = Math.round(delay / 60);
    return "+" + min + " min";
  }

  function renderTimeBlock(timeLabel, delayClass, isNow, delayLabel) {
    var timeClasses = "departure__time";
    if (delayClass) {
      timeClasses += " " + delayClass;
    } else if (isNow) {
      timeClasses += " is-now";
    }
    var delayClasses = "departure__delay";
    if (delayClass) {
      delayClasses += " " + delayClass;
    }
    return (
      '<div class="departure__time-wrap">' +
      '<div class="departure__time-stack">' +
      '<span class="' +
      timeClasses +
      '">' +
      escapeHtml(timeLabel) +
      "</span>" +
      (delayLabel
        ? '<span class="' +
          delayClasses +
          '">' +
          escapeHtml(delayLabel) +
          "</span>"
        : "") +
      "</div></div>"
    );
  }

  function lineStatusKind(departure) {
    if (departure.cancelled) {
      return "cancelled";
    }
    if (departure.realtime) {
      return "realtime";
    }
    return "scheduled";
  }

  function lineStatusLabel(kind) {
    if (kind === "cancelled") {
      return "Innstilt";
    }
    if (kind === "realtime") {
      return "Sanntid";
    }
    return "Rutetid";
  }

  function setDepartureStatusClass(el, kind) {
    if (!el) {
      return;
    }
    el.classList.remove(
      "departure--status-realtime",
      "departure--status-scheduled",
      "departure--status-cancelled"
    );
    el.classList.add("departure--status-" + (kind || "scheduled"));
  }

  function renderLineBadge(departure, attrs) {
    var kind = lineStatusKind(departure);
    var extra = attrs ? " " + attrs : "";
    return (
      '<span class="departure__line-wrap"' +
      extra +
      ">" +
      '<span class="departure__line"' +
      lineStyleAttr(departure) +
      ">" +
      escapeHtml(departure.line) +
      "</span>" +
      '<span class="visually-hidden">' +
      escapeHtml(lineStatusLabel(kind)) +
      "</span>" +
      "</span>"
    );
  }

  function departureMeta(departure) {
    var parts = [];
    if (departure.serviceRun) {
      parts.push("Tjenestekjøring");
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

  function situationMessages(departure) {
    if (!departure || departure.serviceRun) {
      return [];
    }
    var list = departure.situations || [];
    var out = [];
    var seen = Object.create(null);
    list.forEach(function (msg) {
      var text = String(msg || "").trim();
      if (!text || seen[text]) {
        return;
      }
      seen[text] = true;
      out.push(text);
    });
    return out;
  }

  var SITUATION_ROTATE_MS = 15000;

  function situationIndex(count, now) {
    if (count <= 1) {
      return 0;
    }
    var t = now instanceof Date ? now.getTime() : Date.now();
    return Math.floor(t / SITUATION_ROTATE_MS) % count;
  }

  var SITUATION_ICON_SVG =
    '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">' +
    '<path fill="#111" d="M12 3.1L22.6 21.4H1.4L12 3.1z"/>' +
    '<rect x="11" y="9.2" width="2" height="6.2" rx="0.35" fill="#f0c674"/>' +
    '<rect x="11" y="17" width="2" height="2" rx="0.35" fill="#f0c674"/>' +
    "</svg>";

  function renderSituationIconHtml() {
    return (
      '<span class="departure__situation-icon" aria-hidden="true">' +
      SITUATION_ICON_SVG +
      "</span>"
    );
  }

  function renderSituationHtml(departure, now) {
    var messages = situationMessages(departure);
    if (!messages.length) {
      return "";
    }
    var idx = situationIndex(messages.length, now || new Date());
    var current = messages[idx] || messages[0];
    return (
      '<div class="departure__situation" data-situations="' +
      escapeHtml(JSON.stringify(messages)) +
      '">' +
      '<span class="departure__situation-text">' +
      escapeHtml(current) +
      "</span>" +
      "</div>"
    );
  }

  function syncDepartureBadges(root) {
    var scope = root || els.boards;
    if (!scope) {
      return;
    }
    var rows = scope.querySelectorAll(".departure");
    if (!rows.length) {
      return;
    }

    var featured = [];
    var tickers = [];
    var maxFeatured = 0;

    rows.forEach(function (row) {
      var main = row.querySelector(".departure__main");
      var line = row.querySelector(".departure__line");
      var warn = row.querySelector(".departure__situation-icon");
      var situation = row.querySelector(".departure__situation");
      var ticker = row.querySelector(".departure__ticker");
      if (!main || !line) {
        return;
      }
      main.style.minHeight = "";
      main.style.height = "";
      line.style.height = "";
      line.style.minHeight = "";
      if (warn) {
        warn.style.height = "";
        warn.style.minHeight = "";
        warn.style.width = "";
      }
      if (situation) {
        situation.style.minHeight = "";
      }
      if (ticker) {
        ticker.style.height = "";
        ticker.style.maxHeight = "";
      }

      var item = {
        main: main,
        line: line,
        warn: warn,
        situation: situation,
        ticker: ticker,
      };

      if (row.classList.contains("departure--ticker")) {
        tickers.push(item);
        return;
      }

      var natural = Math.round(main.getBoundingClientRect().height);
      featured.push(item);
      if (natural > maxFeatured) {
        maxFeatured = natural;
      }
    });

    var target = maxFeatured;
    if (target < 1 && tickers.length) {
      // Bare ticker på tavlen — bruk CSS-gulvet, ikke %/innhold som kan løpe løpsk
      target = Math.round(
        tickers[0].main.getBoundingClientRect().height || 0
      );
    }
    if (target < 1) {
      return;
    }
    // Hard tak: aldri høyere enn ~28% av viewport (ticker-loop-vern)
    var cap = Math.max(96, Math.round(window.innerHeight * 0.28));
    if (target > cap) {
      target = cap;
    }

    function applySize(item) {
      item.main.style.minHeight = target + "px";
      item.main.style.height = target + "px";
      item.line.style.height = target + "px";
      item.line.style.minHeight = target + "px";
      if (item.warn) {
        var w = Math.round(item.line.getBoundingClientRect().width) || target;
        item.warn.style.height = target + "px";
        item.warn.style.minHeight = target + "px";
        item.warn.style.width = w + "px";
      }
      if (item.situation) {
        item.situation.style.minHeight = target + "px";
      }
      // Ticker beholder kompakt CSS-høyde midtstilt som Nå/min — ikke strekk til target
    }

    featured.forEach(applySize);
    tickers.forEach(applySize);
  }

  function patchSituations(now) {
    var nodes = els.boards.querySelectorAll(
      ".departure__situation[data-situations]"
    );
    if (!nodes.length) {
      return;
    }
    var at = now || new Date();
    nodes.forEach(function (node) {
      var raw = node.getAttribute("data-situations");
      var messages;
      try {
        messages = JSON.parse(raw || "[]");
      } catch (err) {
        return;
      }
      if (!Array.isArray(messages) || !messages.length) {
        return;
      }
      var text = messages[situationIndex(messages.length, at)] || messages[0];
      var textEl = node.querySelector(".departure__situation-text");
      if (textEl && textEl.textContent !== text) {
        textEl.textContent = text;
      }
    });
  }

  function departureDirection(departure, includeDirection) {
    if (!includeDirection || !departure.quayDescription) {
      return "";
    }
    return departure.quayDescription;
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
    var bg = safeCssColor(departure.colour);
    if (!bg) {
      return "";
    }
    var fg = safeCssColor(departure.textColour) || "#fff";
    return (
      ' style="background:' +
      escapeHtml(bg) +
      ";color:" +
      escapeHtml(fg) +
      '"'
    );
  }

  function renderDepartureRow(departure, now, includeDirection, animate) {
    var timeLabel = formatDepartureLabel(departure, now);
    var isNow = timeLabel === "Nå";
    var meta = departureMeta(departure);
    var direction = departureDirection(departure, includeDirection);
    var progress = journeyProgress(departure, now);
    var delayClass = delayTimeClass(departure);
    var delayLabel = formatDelayLabel(departure);
    var hasSituation = situationMessages(departure).length > 0;
    var statusKind = lineStatusKind(departure);

    return (
      '<li class="departure departure--status-' +
      statusKind +
      (departure.cancelled ? " departure--cancelled" : "") +
      (departure.serviceRun ? " departure--service-run" : "") +
      (hasSituation ? " departure--has-situation" : "") +
      (animate ? " departure--enter" : "") +
      '">' +
      '<div class="departure__aside">' +
      '<span class="departure__status" aria-hidden="true"></span>' +
      '<div class="departure__badges">' +
      renderLineBadge(departure) +
      (hasSituation ? renderSituationIconHtml() : "") +
      "</div>" +
      "</div>" +
      '<div class="departure__body">' +
      '<div class="departure__main">' +
      '<div class="departure__dest-wrap">' +
      '<div class="departure__destination">' +
      escapeHtml(departure.destination) +
      "</div>" +
      (direction
        ? '<div class="departure__direction">' +
          escapeHtml(direction) +
          "</div>"
        : "") +
      (meta
        ? '<div class="departure__meta">' + escapeHtml(meta) + "</div>"
        : "") +
      renderProgressHtml(progress) +
      "</div>" +
      renderTimeBlock(timeLabel, delayClass, isNow, delayLabel) +
      "</div>" +
      renderSituationHtml(departure, now) +
      "</div>" +
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
      var time = formatDepartureLabel(dep, now);
      var delayClass = delayTimeClass(dep);
      return {
        time: time,
        line: dep.line || "–",
        colour: dep.colour || "",
        textColour: dep.textColour || "",
        destination: dep.destination || "",
        status: lineStatusKind(dep),
        statusLabel: lineStatusLabel(lineStatusKind(dep)),
        cancelled: Boolean(dep.cancelled),
        delayClass: delayClass,
        delayLabel: formatDelayLabel(dep),
        now: time === "Nå",
      };
    });
    var destinationLabel = multiDestination
      ? first.destination || "Neste avganger"
      : uniqueDestinations[0] || "Neste avganger";
    var firstStatus = items[0].status || "scheduled";

    return (
      '<li class="departure departure--ticker departure--status-' +
      firstStatus +
      (animate ? " departure--enter" : "") +
      '" data-ticker-items="' +
      escapeHtml(JSON.stringify(items)) +
      '" data-ticker-sync-dest="' +
      (multiLine || multiDestination ? "1" : "0") +
      '">' +
      '<div class="departure__aside">' +
      '<span class="departure__status" aria-hidden="true"></span>' +
      '<div class="departure__badges">' +
      renderLineBadge(first, "data-ticker-line-wrap") +
      "</div>" +
      "</div>" +
      '<div class="departure__body">' +
      '<div class="departure__main">' +
      '<div class="departure__dest-wrap">' +
      '<div class="departure__destination" data-ticker-destination>' +
      escapeHtml(destinationLabel) +
      "</div>" +
      "</div>" +
      '<div class="departure__time-wrap">' +
      '<span class="departure__ticker" aria-live="off"></span>' +
      "</div>" +
      "</div>" +
      "</div>" +
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
    var lineWrap = node.querySelector("[data-ticker-line-wrap]");
    var lineEl = lineWrap
      ? lineWrap.querySelector(".departure__line")
      : node.querySelector("[data-ticker-line]");
    var lineSr = lineWrap
      ? lineWrap.querySelector(".visually-hidden")
      : null;
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
      el.setAttribute("data-item-index", String(index % items.length));

      var timeEl = document.createElement("span");
      timeEl.className = "departure__ticker-time";
      if (item.delayClass) {
        timeEl.className += " " + item.delayClass;
      } else if (item.now) {
        timeEl.className += " is-now";
      }
      timeEl.textContent = item.time;

      var delaySpan = document.createElement("span");
      delaySpan.className = "departure__ticker-delay";
      if (item.delayClass) {
        delaySpan.className += " " + item.delayClass;
      }
      if (item.delayLabel) {
        delaySpan.textContent = item.delayLabel;
      } else {
        delaySpan.className += " is-empty";
        delaySpan.textContent = "\u00a0";
      }

      el.appendChild(timeEl);
      el.appendChild(delaySpan);
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
      setDepartureStatusClass(node, item.status || "scheduled");
      if (lineWrap) {
        lineWrap.className = "departure__line-wrap";
        lineWrap.setAttribute("data-ticker-line-wrap", "");
      }
      if (lineSr && item.statusLabel) {
        lineSr.textContent = item.statusLabel;
      }
      if (lineEl && item.line) {
        lineEl.textContent = item.line;
        var bg = safeCssColor(item.colour);
        if (bg) {
          lineEl.style.background = bg;
          lineEl.style.color = safeCssColor(item.textColour) || "#fff";
        } else {
          lineEl.style.background = "";
          lineEl.style.color = "";
        }
      }
      if (destEl && syncDestination && item.destination) {
        destEl.textContent = item.destination;
      }
    }

    // Hvert element = hele rulleflaten, så topp- og bunngrense er like.
    function layoutTicker() {
      viewHeight = slot.clientHeight;
      if (!track.children.length || viewHeight <= 0) {
        return false;
      }
      Array.prototype.forEach.call(track.children, function (el) {
        el.style.minHeight = viewHeight + "px";
        el.style.height = viewHeight + "px";
      });
      track.style.gap = "0px";
      step = viewHeight;
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
        var active =
          Math.floor((visual + step * ACTIVE_LEAD) / step) % items.length;
        setActive(active);
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
              journeyProgressKey(dep),
              dep.occupancyStatus || "",
              situationMessages(dep).join("|"),
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
      patchProgressLabels(now || new Date());
      patchSituations(now || new Date());
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
    requestAnimationFrame(function () {
      syncDepartureBadges();
      startTickers();
    });
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
    if (els.showBuildInfo) {
      els.showBuildInfo.checked = settings.showBuildInfo;
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
    settings.showBuildInfo = els.showBuildInfo
      ? els.showBuildInfo.checked
      : true;
    settings.githubCheckIntervalSeconds = normalizeGithubInterval(
      els.githubCheckInterval.value
    );
    settings.quays = draftQuays.map(cloneQuay);
    saveSettings();
    closeSettings();
    updateBuildFooter();
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
    if (els.clearLocal) {
      els.clearLocal.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        clearLocalData();
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
    updateBuildFooter();
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
    var badgeResizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(badgeResizeTimer);
      badgeResizeTimer = setTimeout(function () {
        syncDepartureBadges();
        startTickers();
      }, 120);
    });
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
