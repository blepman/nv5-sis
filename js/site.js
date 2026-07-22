(function () {
  const defaults = window.NV5_SIS;
  if (!defaults) {
    console.error("Mangler config.js");
    return;
  }

  const els = {
    boardTitle: document.getElementById("boardTitle"),
    clock: document.getElementById("clock"),
    updated: document.getElementById("updated"),
    boards: document.getElementById("boards"),
    status: document.getElementById("status"),
    settingsOpen: document.getElementById("settingsOpen"),
    settingsDialog: document.getElementById("settingsDialog"),
    settingsSave: document.getElementById("settingsSave"),
    elementsPerQuay: document.getElementById("elementsPerQuay"),
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
  let draftQuays = settings.quays.slice();

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
    document.cookie =
      name +
      "=" +
      encodeURIComponent(String(seconds)) +
      "; path=/sis/; max-age=" +
      maxAge +
      "; SameSite=Lax";
  }

  function loadSettings() {
    var base = {
      quays: (defaults.quays || []).map(cloneQuay),
      elementsPerQuay: defaults.elementsPerQuay || 3,
      compactDepartures: defaults.compactDepartures || 4,
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
        githubCheckIntervalSeconds: settings.githubCheckIntervalSeconds,
      })
    );
    writeGithubIntervalCookie(settings.githubCheckIntervalSeconds);
  }

  function cloneQuay(quay) {
    return {
      id: quay.id,
      name: quay.name || quay.id,
      direction: quay.direction || quay.description || "",
    };
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

  function departureMeta(departure) {
    if (departure.cancelled) {
      return "Innstilt";
    }
    if (departure.delayMinutes >= 2) {
      return "Forsinket " + departure.delayMinutes + " min";
    }
    if (departure.realtime) {
      return "Sanntid";
    }
    return "Rutetid";
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
    if (settings.quays.length === 1) {
      els.boardTitle.textContent = settings.quays[0].name;
    } else {
      els.boardTitle.textContent = settings.quays.length + " holdeplasser";
    }
  }

  function showStatus(message, isError) {
    els.boards.innerHTML = "";
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

  function renderDepartureRow(departure, now, compact) {
    var timeLabel = formatDepartureLabel(departure, now);
    var isNow = timeLabel === "Nå";
    var meta = departureMeta(departure);
    if (departure.situations[0]) {
      meta += " · " + departure.situations[0];
    }
    var lineStyle = "";
    if (departure.colour) {
      lineStyle =
        ' style="background:' +
        escapeHtml(departure.colour) +
        ";color:" +
        escapeHtml(departure.textColour || "#fff") +
        '"';
    }

    return (
      '<li class="departure' +
      (compact ? " departure--compact" : "") +
      (departure.cancelled ? " departure--cancelled" : "") +
      '">' +
      '<span class="departure__line"' +
      lineStyle +
      ">" +
      escapeHtml(departure.line) +
      "</span>" +
      '<div class="departure__dest-wrap">' +
      '<div class="departure__destination">' +
      escapeHtml(departure.destination) +
      "</div>" +
      '<div class="departure__meta' +
      (departure.delayMinutes >= 2 || departure.cancelled ? " is-late" : "") +
      '">' +
      escapeHtml(meta) +
      "</div>" +
      "</div>" +
      '<span class="departure__time' +
      (isNow ? " is-now" : "") +
      '">' +
      escapeHtml(timeLabel) +
      "</span>" +
      "</li>"
    );
  }

  function renderQuayBoard(quayConfig, result, now) {
    var featuredCount = Math.max(0, settings.elementsPerQuay - 1);
    var compactCount = defaults.compactDepartures || 4;
    var deps = result.departures || [];
    var featured = deps.slice(0, featuredCount);
    var compact = deps.slice(featuredCount, featuredCount + compactCount);
    var direction =
      quayConfig.direction || result.description || "";

    var html =
      '<section class="quay-board">' +
      '<header class="quay-board__header">' +
      '<h2 class="quay-board__name">' +
      escapeHtml(quayConfig.name || result.name) +
      "</h2>";
    if (direction) {
      html +=
        '<p class="quay-board__direction">' +
        escapeHtml(direction) +
        "</p>";
    }
    html += "</header>";

    if (!deps.length) {
      html += '<p class="quay-board__empty">Ingen avganger akkurat nå.</p>';
      html += "</section>";
      return html;
    }

    html += '<ul class="departures">';
    featured.forEach(function (dep) {
      html += renderDepartureRow(dep, now, false);
    });
    html += "</ul>";

    if (compact.length && settings.elementsPerQuay >= 2) {
      html +=
        '<div class="quay-board__more">' +
        '<p class="quay-board__more-label">Neste avganger</p>' +
        '<ul class="departures departures--compact">';
      compact.forEach(function (dep) {
        html += renderDepartureRow(dep, now, true);
      });
      html += "</ul></div>";
    }

    html += "</section>";
    return html;
  }

  async function refresh() {
    if (!settings.quays.length) {
      showStatus("Ingen holdeplasser valgt. Åpne innstillinger.", false);
      els.updated.textContent = "Mangler holdeplass";
      return;
    }

    try {
      var now = new Date();
      var needed = departuresNeeded();
      var results = await Promise.all(
        settings.quays.map(function (quay) {
          return window.NV5Entur.fetchDepartures(defaults, quay.id, needed).then(
            function (result) {
              return { quay: quay, result: result };
            }
          );
        })
      );

      hideStatus();
      updateBoardTitle();
      els.boards.innerHTML = results
        .map(function (item) {
          return renderQuayBoard(item.quay, item.result, now);
        })
        .join("");
      els.updated.textContent =
        "Sist oppdatert " + formatClock(new Date(), false);
    } catch (error) {
      console.error(error);
      showStatus("Kunne ikke hente sanntidsdata. Prøver igjen…", true);
      els.updated.textContent = "Oppdatering feilet";
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
        return (
          "<li>" +
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
          "</li>"
        );
      })
      .join("");
  }

  function openSettings() {
    draftQuays = settings.quays.map(cloneQuay);
    els.elementsPerQuay.value = String(settings.elementsPerQuay);
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
  }

  function closeSettings() {
    if (typeof els.settingsDialog.close === "function") {
      els.settingsDialog.close();
    } else {
      els.settingsDialog.removeAttribute("open");
    }
  }

  function applySettings() {
    settings.elementsPerQuay = Math.max(
      2,
      Math.min(8, Number(els.elementsPerQuay.value) || 3)
    );
    settings.githubCheckIntervalSeconds = normalizeGithubInterval(
      els.githubCheckInterval.value
    );
    settings.quays = draftQuays.map(cloneQuay);
    saveSettings();
    closeSettings();
    // Last siden på nytt slik at PHP leser cookie og kan hente ny kode
    var url = new URL(window.location.href);
    url.searchParams.set("forceGithub", "1");
    window.location.replace(url.toString());
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

  async function pickStop(stopId, stopName) {
    els.searchResults.innerHTML = "";
    els.stopSearch.value = stopName;
    try {
      var stop = await window.NV5Entur.fetchStopQuays(defaults, stopId);
      els.quayPick.hidden = false;
      els.quayPickTitle.textContent = "Velg kai / retning for " + stop.name;
      if (!stop.quays.length) {
        els.quayResults.innerHTML =
          '<li class="settings__empty">Ingen kaier</li>';
        return;
      }
      els.quayResults.innerHTML = stop.quays
        .map(function (quay) {
          var label =
            (quay.description || quay.name || "Kai") +
            (quay.publicCode ? " (" + quay.publicCode + ")" : "");
          return (
            "<li>" +
            '<button type="button" data-quay="' +
            escapeHtml(quay.id) +
            '" data-name="' +
            escapeHtml(stop.name) +
            '" data-direction="' +
            escapeHtml(quay.description || "") +
            '">' +
            escapeHtml(label) +
            "</button>" +
            "</li>"
          );
        })
        .join("");
    } catch (error) {
      console.error(error);
      els.quayResults.innerHTML =
        '<li class="settings__empty">Kunne ikke hente kaier</li>';
      els.quayPick.hidden = false;
    }
  }

  function addQuay(quay) {
    var exists = draftQuays.some(function (item) {
      return item.id === quay.id;
    });
    if (exists) {
      return;
    }
    draftQuays.push(cloneQuay(quay));
    renderSelectedQuays();
    els.quayPick.hidden = true;
    els.stopSearch.value = "";
  }

  function bindSettings() {
    els.settingsOpen.addEventListener("click", openSettings);
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
      addQuay({
        id: btn.getAttribute("data-quay"),
        name: btn.getAttribute("data-name"),
        direction: btn.getAttribute("data-direction") || "",
      });
    });
  }

  function start() {
    updateBoardTitle();
    updateClock();
    setInterval(updateClock, 1000);
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
      if (document.visibilityState === "visible") {
        refresh();
        requestWakeLock();
      }
    });
  }

  start();
})();
