(function (global) {
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
    situations {
      summary {
        language
        value
      }
    }
  `;

  const JOURNEY_PROGRESS_QUERY = `
    query JourneyProgress($id: String!) {
      serviceJourney(id: $id) {
        id
        estimatedCalls {
          actualArrivalTime
          actualDepartureTime
          stopPositionInPattern
          quay {
            id
            name
          }
        }
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

  const progressCache = {};
  const PROGRESS_CACHE_MS = 25000;

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

  function deriveJourneyProgress(calls) {
    if (!calls || !calls.length) {
      return null;
    }
    var idx = -1;
    for (var i = 0; i < calls.length; i++) {
      if (calls[i].actualArrivalTime || calls[i].actualDepartureTime) {
        idx = i;
      }
    }
    if (idx < 0) {
      return null;
    }
    var call = calls[idx];
    var stopName = (call.quay && call.quay.name) || "";
    if (!stopName) {
      return null;
    }
    if (call.actualDepartureTime) {
      var next = calls[idx + 1];
      var nextName = (next && next.quay && next.quay.name) || "";
      if (nextName) {
        return {
          state: "towards",
          stopName: stopName,
          nextStopName: nextName,
          label: "Mot " + nextName,
        };
      }
      return {
        state: "passed",
        stopName: stopName,
        nextStopName: "",
        label: "Passerte " + stopName,
      };
    }
    return {
      state: "at",
      stopName: stopName,
      nextStopName: "",
      label: "På " + stopName,
    };
  }

  async function fetchJourneyProgress(config, serviceJourneyId) {
    if (!serviceJourneyId) {
      return null;
    }
    var cached = progressCache[serviceJourneyId];
    var now = Date.now();
    if (cached && now - cached.at < PROGRESS_CACHE_MS) {
      return cached.progress;
    }
    try {
      var data = await graphql(config, JOURNEY_PROGRESS_QUERY, {
        id: serviceJourneyId,
      });
      var journey = data && data.serviceJourney;
      var progress = deriveJourneyProgress(
        (journey && journey.estimatedCalls) || []
      );
      progressCache[serviceJourneyId] = { at: now, progress: progress };
      return progress;
    } catch (error) {
      console.warn("Kunne ikke hente turprogress", serviceJourneyId, error);
      if (cached) {
        return cached.progress;
      }
      return null;
    }
  }

  async function fetchJourneyProgressMany(config, serviceJourneyIds) {
    var unique = [];
    var seen = {};
    (serviceJourneyIds || []).forEach(function (id) {
      if (id && !seen[id]) {
        seen[id] = true;
        unique.push(id);
      }
    });
    var results = await Promise.allSettled(
      unique.map(function (id) {
        return fetchJourneyProgress(config, id).then(function (progress) {
          return { id: id, progress: progress };
        });
      })
    );
    var map = {};
    results.forEach(function (outcome) {
      if (outcome.status === "fulfilled" && outcome.value) {
        map[outcome.value.id] = outcome.value.progress;
      }
    });
    return map;
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
    const delayMinutes =
      expected && aimed
        ? Math.round((expected.getTime() - aimed.getTime()) / 60000)
        : 0;

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
      delayMinutes: delayMinutes,
      situations: situations,
      quayDescription: quay.description || "",
      quayCode: quay.publicCode || "",
      serviceJourneyId: serviceJourneyId,
      occupancyStatus: occupancyStatus,
      occupancyLabel: occupancyLabel(occupancyStatus),
      serviceRun: isServiceRun(destination, occupancyStatus),
      progressLabel: "",
    };
  }

  global.NV5Entur = {
    fetchDepartures: fetchDepartures,
    searchStops: searchStops,
    fetchStopQuays: fetchStopQuays,
    fetchQuayLines: fetchQuayLines,
    fetchPlaceLines: fetchPlaceLines,
    fetchJourneyProgress: fetchJourneyProgress,
    fetchJourneyProgressMany: fetchJourneyProgressMany,
    deriveJourneyProgress: deriveJourneyProgress,
    modeLabel: modeLabel,
    occupancyLabel: occupancyLabel,
    isServiceRun: isServiceRun,
  };
})(window);
