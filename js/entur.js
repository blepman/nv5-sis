(function (global) {
  const CALL_PROGRESS_FIELDS = `
    quay {
      name
    }
    expectedArrivalTime
    expectedDepartureTime
    actualArrivalTime
    actualDepartureTime
  `;

  const CALL_FIELDS = `
    expectedDepartureTime
    aimedDepartureTime
    realtime
    cancellation
    occupancyStatus
    destinationDisplay {
      frontText
    }
    quay {
      id
      name
      description
      publicCode
    }
    serviceJourney {
      id
      line {
        id
        publicCode
        name
        transportMode
        presentation {
          colour
          textColour
        }
      }
    }
    serviceJourneyEstimatedCalls {
      first {
        ${CALL_PROGRESS_FIELDS}
      }
      previous {
        ${CALL_PROGRESS_FIELDS}
      }
    }
    situations {
      summary {
        language
        value
      }
    }
  `;

  const OCCUPANCY_LABELS = {
    empty: "God plass",
    manySeatsAvailable: "God plass",
    fewSeatsAvailable: "Få seter",
    standingRoomOnly: "Ståplass",
    crushedStandingRoomOnly: "Ståplass",
    full: "Full",
    notAcceptingPassengers: "Tar ikke passasjerer",
  };

  const SERVICE_RUN_PATTERN =
    /tjenest|ikke i trafikk|tomkj|depot|garasje/;

  // Vis rutebasert posisjon fra litt før første stopp, og for avganger
  // som er nærmere enn dette (selv før start).
  const PROGRESS_LEAD_MS = 60 * 1000;
  const PROGRESS_UPCOMING_MS = 25 * 60 * 1000;

  const QUAY_QUERY = `
    query QuayDepartures($id: String!, $numberOfDepartures: Int!) {
      quay(id: $id) {
        id
        name
        description
        publicCode
        estimatedCalls(numberOfDepartures: $numberOfDepartures) {
          ${CALL_FIELDS}
        }
      }
    }
  `;

  const STOP_DEPARTURES_QUERY = `
    query StopDepartures($id: String!, $numberOfDepartures: Int!) {
      stopPlace(id: $id) {
        id
        name
        estimatedCalls(numberOfDepartures: $numberOfDepartures) {
          ${CALL_FIELDS}
        }
      }
    }
  `;

  const STOP_QUAYS_QUERY = `
    query StopQuays($id: String!) {
      stopPlace(id: $id) {
        id
        name
        quays {
          id
          name
          description
          publicCode
          lines {
            id
            publicCode
            name
            transportMode
          }
        }
      }
    }
  `;

  const MODE_LABELS = {
    metro: "T-bane",
    bus: "Buss",
    tram: "Trikk",
    rail: "Tog",
    water: "Båt",
    coach: "Buss",
  };

  function modeLabel(mode) {
    return MODE_LABELS[mode] || mode || "";
  }

  function occupancyLabel(status) {
    if (!status || status === "noData") {
      return "";
    }
    return OCCUPANCY_LABELS[status] || "";
  }

  function isServiceRun(destination, occupancyStatus) {
    if (occupancyStatus === "notAcceptingPassengers") {
      return true;
    }
    return SERVICE_RUN_PATTERN.test(String(destination || "").toLowerCase());
  }

  function parseTime(value) {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function normalizeProgressCall(call) {
    if (!call) {
      return null;
    }
    var name = (call.quay && call.quay.name) || call.name || "";
    if (!name) {
      return null;
    }
    return {
      name: name,
      expectedArrival: parseTime(call.expectedArrivalTime || call.expectedArrival),
      expectedDeparture: parseTime(
        call.expectedDepartureTime || call.expectedDeparture
      ),
      actualArrival: parseTime(call.actualArrivalTime || call.actualArrival),
      actualDeparture: parseTime(call.actualDepartureTime || call.actualDeparture),
    };
  }

  function progressFromActual(stops) {
    var idx = -1;
    for (var i = 0; i < stops.length; i++) {
      if (stops[i].actualArrival || stops[i].actualDeparture) {
        idx = i;
      }
    }
    if (idx < 0) {
      return null;
    }
    var stop = stops[idx];
    var at = stop.actualDeparture || stop.actualArrival;
    if (!stop.name || !at) {
      return null;
    }
    return {
      mode: "seen",
      place: stop.name,
      at: at,
    };
  }

  function progressFromExpected(stops, boardStopName, nowMs) {
    if (!stops.length) {
      return null;
    }
    var firstDep = stops[0].expectedDeparture || stops[0].expectedArrival;
    if (firstDep && nowMs + PROGRESS_LEAD_MS < firstDep.getTime()) {
      return { mode: "expected", place: stops[0].name };
    }

    var idx = -1;
    for (var i = 0; i < stops.length; i++) {
      var arrival = stops[i].expectedArrival || stops[i].expectedDeparture;
      var departure = stops[i].expectedDeparture || stops[i].expectedArrival;
      if (arrival && arrival.getTime() <= nowMs) {
        idx = i;
      }
      if (departure && departure.getTime() <= nowMs) {
        idx = i;
      }
    }

    if (idx < 0) {
      return { mode: "expected", place: stops[0].name };
    }

    var stop = stops[idx];
    if (!stop.name) {
      return boardStopName
        ? { mode: "expected", place: boardStopName }
        : null;
    }
    return { mode: "expected", place: stop.name };
  }

  function formatRelativeSeen(at, now) {
    if (!at || !now) {
      return "";
    }
    var sec = Math.max(
      0,
      Math.round((now.getTime() - at.getTime()) / 1000)
    );
    if (sec < 20) {
      return "nå";
    }
    if (sec < 60) {
      return "for " + sec + " sek siden";
    }
    var min = Math.round(sec / 60);
    if (min < 60) {
      return min === 1 ? "for 1 min siden" : "for " + min + " min siden";
    }
    var hours = Math.round(min / 60);
    return hours === 1 ? "for 1 time siden" : "for " + hours + " timer siden";
  }

  function withProgressLabel(progress, now) {
    if (!progress || !progress.place) {
      return null;
    }
    var nowDate = now instanceof Date ? now : new Date();
    if (progress.mode === "seen" && progress.at) {
      return {
        mode: "seen",
        place: progress.place,
        at: progress.at,
        label:
          "Sist sett " +
          progress.place +
          " · " +
          formatRelativeSeen(progress.at, nowDate),
      };
    }
    if (progress.mode === "expected") {
      return {
        mode: "expected",
        place: progress.place,
        at: null,
        label: "Forventet ved " + progress.place,
      };
    }
    return null;
  }

  function deriveJourneyProgress(departure, now) {
    if (!departure || departure.cancelled || departure.serviceRun) {
      return null;
    }
    var nowDate = now instanceof Date ? now : new Date();
    var nowMs = nowDate.getTime();
    var boardStopName = departure.quayName || "";
    var stops = (departure.previousStops || []).slice();
    var first = departure.firstStop;
    if (first && (!stops.length || stops[0].name !== first.name)) {
      if (!stops.length) {
        stops = [first];
      }
    }
    if (!stops.length && first) {
      stops = [first];
    }
    if (!stops.length) {
      return null;
    }

    var boardTime = departure.expected;
    var firstDep =
      (first && (first.expectedDeparture || first.expectedArrival)) ||
      stops[0].expectedDeparture ||
      stops[0].expectedArrival;
    var seen = progressFromActual(stops);
    if (seen) {
      return withProgressLabel(seen, nowDate);
    }

    var journeyStarted =
      firstDep && nowMs + PROGRESS_LEAD_MS >= firstDep.getTime();
    var soonEnough =
      boardTime && boardTime.getTime() - nowMs <= PROGRESS_UPCOMING_MS;
    if (!journeyStarted && !soonEnough) {
      return null;
    }

    return withProgressLabel(
      progressFromExpected(stops, boardStopName, nowMs),
      nowDate
    );
  }

  function journeyProgressLabel(departure, now) {
    var progress = deriveJourneyProgress(departure, now);
    return (progress && progress.label) || "";
  }

  function journeyProgressKey(departure) {
    if (!departure || departure.cancelled || departure.serviceRun) {
      return "";
    }
    var stops = (departure.previousStops || []).slice();
    var first = departure.firstStop;
    if (!stops.length && first) {
      stops = [first];
    }
    if (!stops.length) {
      return "";
    }
    var seen = progressFromActual(stops);
    if (seen) {
      return (
        "seen:" +
        seen.place +
        ":" +
        (seen.at ? seen.at.toISOString() : "")
      );
    }
    var nowMs = Date.now();
    var boardTime = departure.expected;
    var firstDep =
      (first && (first.expectedDeparture || first.expectedArrival)) ||
      (stops[0] && (stops[0].expectedDeparture || stops[0].expectedArrival));
    var journeyStarted =
      firstDep && nowMs + PROGRESS_LEAD_MS >= firstDep.getTime();
    var soonEnough =
      boardTime && boardTime.getTime() - nowMs <= PROGRESS_UPCOMING_MS;
    if (!journeyStarted && !soonEnough) {
      return "";
    }
    var expected = progressFromExpected(
      stops,
      departure.quayName || "",
      nowMs
    );
    return expected && expected.place ? "expected:" + expected.place : "";
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    var controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    var opts = Object.assign({}, options || {});
    if (controller) {
      opts.signal = controller.signal;
    }
    var timeout = timeoutMs || 10000;
    try {
      if (controller) {
        timer = setTimeout(function () {
          controller.abort();
        }, timeout);
      }
      return await fetch(url, opts);
    } catch (error) {
      if (controller && error && error.name === "AbortError") {
        throw new Error("Tidsavbrudd etter " + timeout + " ms");
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function graphql(config, query, variables) {
    const response = await fetchWithTimeout(
      config.enturUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ET-Client-Name": config.clientName,
        },
        body: JSON.stringify({ query: query, variables: variables }),
      },
      config.fetchTimeoutMs
    );

    if (!response.ok) {
      throw new Error("Entur svarte med HTTP " + response.status);
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
      throw new Error(payload.errors[0].message || "GraphQL-feil fra Entur");
    }
    return payload.data;
  }

  async function fetchDepartures(config, place, numberOfDepartures) {
    const kind = place.kind === "stopPlace" ? "stopPlace" : "quay";
    const id = place.id;
    if (kind === "stopPlace") {
      const data = await graphql(config, STOP_DEPARTURES_QUERY, {
        id: id,
        numberOfDepartures: numberOfDepartures,
      });
      const stop = data && data.stopPlace;
      if (!stop) {
        throw new Error("Fant ikke stopp " + id);
      }
      return {
        id: stop.id,
        name: stop.name,
        description: "Alle retninger",
        departures: (stop.estimatedCalls || []).map(normalizeCall),
      };
    }

    const data = await graphql(config, QUAY_QUERY, {
      id: id,
      numberOfDepartures: numberOfDepartures,
    });
    const quay = data && data.quay;
    if (!quay) {
      throw new Error("Fant ikke kai " + id);
    }

    return {
      id: quay.id,
      name: quay.name,
      description: quay.description,
      publicCode: quay.publicCode,
      departures: (quay.estimatedCalls || []).map(normalizeCall),
    };
  }

  function modesFromCategories(categories) {
    const modes = [];
    (categories || []).forEach(function (cat) {
      if (cat === "metroStation" || cat === "metro") {
        modes.push("metro");
      } else if (
        cat === "onstreetBus" ||
        cat === "busStation" ||
        cat === "bus"
      ) {
        modes.push("bus");
      } else if (cat === "onstreetTram" || cat === "tramStation") {
        modes.push("tram");
      } else if (cat === "railStation") {
        modes.push("rail");
      } else if (cat === "ferryStop" || cat === "harbourPort") {
        modes.push("water");
      }
    });
    return modes.filter(function (mode, index, all) {
      return all.indexOf(mode) === index;
    });
  }

  function formatModes(modes) {
    return modes
      .map(function (mode) {
        return modeLabel(mode);
      })
      .join(", ");
  }

  async function searchStops(config, text) {
    const url =
      config.geocoderUrl +
      "?text=" +
      encodeURIComponent(text) +
      "&lang=no&size=12&layers=venue";
    const response = await fetchWithTimeout(
      url,
      {
        headers: { "ET-Client-Name": config.clientName },
      },
      config.fetchTimeoutMs
    );
    if (!response.ok) {
      throw new Error("Geocoder HTTP " + response.status);
    }
    const payload = await response.json();
    return (payload.features || [])
      .map(function (feature) {
        const p = feature.properties || {};
        const modes = modesFromCategories(p.category);
        const locality = p.locality || p.county || "";
        const modeText = formatModes(modes);
        const baseName = p.name || p.label || p.id;
        const labelParts = [baseName];
        if (modeText) {
          labelParts[0] = baseName + " (" + modeText + ")";
        }
        if (locality) {
          labelParts.push(locality);
        }
        return {
          id: p.id,
          name: baseName,
          label: labelParts.join(" · "),
          category: p.category || [],
          modes: modes,
          locality: locality,
        };
      })
      .filter(function (item) {
        return item.id && String(item.id).indexOf("NSR:StopPlace:") === 0;
      });
  }

  async function fetchStopQuays(config, stopPlaceId) {
    const data = await graphql(config, STOP_QUAYS_QUERY, { id: stopPlaceId });
    const stop = data && data.stopPlace;
    if (!stop) {
      throw new Error("Fant ikke stopp " + stopPlaceId);
    }
    return {
      id: stop.id,
      name: stop.name,
      quays: (stop.quays || []).map(function (quay) {
        const lines = (quay.lines || []).map(normalizeLine);
        const modes = lines
          .map(function (line) {
            return line.transportMode;
          })
          .filter(Boolean)
          .filter(function (mode, index, all) {
            return all.indexOf(mode) === index;
          });
        const lineCodes = lines
          .map(function (line) {
            return line.publicCode;
          })
          .filter(Boolean);
        return {
          id: quay.id,
          name: quay.name || stop.name,
          description: quay.description || "",
          publicCode: quay.publicCode || "",
          modes: modes,
          lineCodes: lineCodes,
          lines: lines,
        };
      }),
    };
  }

  async function fetchQuayLines(config, quayId) {
    const data = await graphql(
      config,
      `
      query QuayLines($id: String!) {
        quay(id: $id) {
          id
          lines {
            id
            publicCode
            name
            transportMode
          }
        }
      }
    `,
      { id: quayId }
    );
    const quay = data && data.quay;
    if (!quay) {
      throw new Error("Fant ikke kai " + quayId);
    }
    return (quay.lines || []).map(normalizeLine);
  }

  async function fetchPlaceLines(config, place) {
    if (place.kind === "stopPlace") {
      const stop = await fetchStopQuays(config, place.id);
      const byId = {};
      (stop.quays || []).forEach(function (quay) {
        (quay.lines || []).forEach(function (line) {
          if (line.id) {
            byId[line.id] = line;
          }
        });
      });
      return Object.keys(byId)
        .map(function (id) {
          return byId[id];
        })
        .sort(function (a, b) {
          return String(a.publicCode).localeCompare(String(b.publicCode), "nb");
        });
    }
    return fetchQuayLines(config, place.id);
  }

  function normalizeLine(line) {
    return {
      id: line.id,
      publicCode: line.publicCode || "–",
      name: line.name || "",
      transportMode: line.transportMode || "",
    };
  }

  function normalizeCall(call) {
    const expected = call.expectedDepartureTime
      ? new Date(call.expectedDepartureTime)
      : null;
    const aimed = call.aimedDepartureTime
      ? new Date(call.aimedDepartureTime)
      : null;
    const delaySeconds =
      expected && aimed
        ? Math.round((expected.getTime() - aimed.getTime()) / 1000)
        : 0;
    const delayMinutes = Math.round(delaySeconds / 60);

    const situations = (call.situations || [])
      .map(function (situation) {
        const summaries = situation.summary || [];
        const nb = summaries.find(function (item) {
          return item.language === "no" || item.language === "nb";
        });
        return (nb || summaries[0] || {}).value;
      })
      .filter(Boolean);

    const line = (call.serviceJourney && call.serviceJourney.line) || {};
    const presentation = line.presentation || {};

    const quay = call.quay || {};
    const destination =
      (call.destinationDisplay && call.destinationDisplay.frontText) ||
      "Ukjent";
    const occupancyStatus = call.occupancyStatus || "noData";
    const serviceJourneyId =
      (call.serviceJourney && call.serviceJourney.id) || "";
    const sjCalls = call.serviceJourneyEstimatedCalls || {};
    const previousStops = (sjCalls.previous || [])
      .map(normalizeProgressCall)
      .filter(Boolean);
    const firstStop = normalizeProgressCall(sjCalls.first);
    return {
      lineId: line.id || "",
      line: line.publicCode || "–",
      destination: destination,
      mode: line.transportMode || "",
      colour: presentation.colour ? "#" + presentation.colour : "",
      textColour: presentation.textColour ? "#" + presentation.textColour : "",
      expected: expected,
      aimed: aimed,
      realtime: Boolean(call.realtime),
      cancelled: Boolean(call.cancellation),
      delaySeconds: delaySeconds,
      delayMinutes: delayMinutes,
      situations: situations,
      quayName: quay.name || "",
      quayDescription: quay.description || "",
      quayCode: quay.publicCode || "",
      serviceJourneyId: serviceJourneyId,
      occupancyStatus: occupancyStatus,
      occupancyLabel: occupancyLabel(occupancyStatus),
      serviceRun: isServiceRun(destination, occupancyStatus),
      firstStop: firstStop,
      previousStops: previousStops,
    };
  }

  global.NV5Entur = {
    fetchDepartures: fetchDepartures,
    searchStops: searchStops,
    fetchStopQuays: fetchStopQuays,
    fetchQuayLines: fetchQuayLines,
    fetchPlaceLines: fetchPlaceLines,
    deriveJourneyProgress: deriveJourneyProgress,
    journeyProgressLabel: journeyProgressLabel,
    journeyProgressKey: journeyProgressKey,
    formatRelativeSeen: formatRelativeSeen,
    modeLabel: modeLabel,
    occupancyLabel: occupancyLabel,
    isServiceRun: isServiceRun,
  };
})(window);
