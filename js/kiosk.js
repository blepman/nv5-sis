(function () {
  const config = window.NV5_SIS;
  if (!config) {
    console.error("Mangler config.js");
    return;
  }

  const els = {
    stopName: document.getElementById("stopName"),
    directionLabel: document.getElementById("directionLabel"),
    clock: document.getElementById("clock"),
    departures: document.getElementById("departures"),
    status: document.getElementById("status"),
    updated: document.getElementById("updated"),
  };

  let wakeLock = null;
  let refreshTimer = null;

  els.stopName.textContent = config.stopName;
  els.directionLabel.textContent = config.directionLabel;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatClock(date, withSeconds) {
    var time =
      pad(date.getHours()) + ":" + pad(date.getMinutes());
    if (withSeconds) {
      time += ":" + pad(date.getSeconds());
    }
    return time;
  }

  function formatDepartureLabel(departure, now) {
    if (!departure.expected) {
      return "–";
    }

    const diffMs = departure.expected.getTime() - now.getTime();
    const minutes = Math.round(diffMs / 60000);

    if (minutes <= 0) {
      return "Nå";
    }
    if (minutes < 10) {
      return minutes + " min";
    }
    return formatClock(departure.expected, false);
  }

  function updateClock() {
    const now = new Date();
    els.clock.textContent = formatClock(now, true);
    els.clock.setAttribute("datetime", now.toISOString());
  }

  function showStatus(message, isError) {
    els.departures.innerHTML = "";
    els.status.hidden = false;
    els.status.textContent = message;
    els.status.classList.toggle("is-error", Boolean(isError));
  }

  function hideStatus() {
    els.status.hidden = true;
    els.status.textContent = "";
    els.status.classList.remove("is-error");
  }

  function renderDepartures(departures) {
    const now = new Date();
    hideStatus();

    if (!departures.length) {
      showStatus("Ingen avganger akkurat nå.", false);
      return;
    }

    els.departures.innerHTML = departures
      .map(function (departure) {
        const timeLabel = formatDepartureLabel(departure, now);
        const isNow = timeLabel === "Nå";
        const delayText =
          departure.delayMinutes >= 2
            ? "Forsinket " + departure.delayMinutes + " min"
            : departure.realtime
              ? "Sanntid"
              : "Rutetid";
        const situation = departure.situations[0]
          ? " · " + departure.situations[0]
          : "";

        return (
          '<li class="departure">' +
          '<span class="departure__line">' +
          escapeHtml(departure.line) +
          "</span>" +
          '<div class="departure__dest-wrap">' +
          '<div class="departure__destination">' +
          escapeHtml(departure.destination) +
          "</div>" +
          '<div class="departure__meta' +
          (departure.delayMinutes >= 2 ? " is-late" : "") +
          '">' +
          escapeHtml(delayText + situation) +
          "</div>" +
          "</div>" +
          '<span class="departure__time' +
          (isNow ? " is-now" : "") +
          '">' +
          escapeHtml(timeLabel) +
          "</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function refresh() {
    try {
      const result = await window.NV5Entur.fetchDepartures(config);
      if (result.name) {
        els.stopName.textContent = result.name;
      }
      renderDepartures(result.departures);
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

  function start() {
    updateClock();
    setInterval(updateClock, 1000);
    refresh();
    refreshTimer = setInterval(refresh, config.pollIntervalMs);
    requestWakeLock();

    if (config.pageReloadIntervalMs > 0) {
      setTimeout(function () {
        location.reload();
      }, config.pageReloadIntervalMs);
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
