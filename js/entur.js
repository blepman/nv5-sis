(function (global) {
  const QUAY_QUERY = `
    query QuayDepartures($id: String!, $numberOfDepartures: Int!) {
      quay(id: $id) {
        id
        name
        description
        publicCode
        estimatedCalls(numberOfDepartures: $numberOfDepartures) {
          expectedDepartureTime
          aimedDepartureTime
          realtime
          cancellation
          destinationDisplay {
            frontText
          }
          serviceJourney {
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

  async function graphql(config, query, variables) {
    const response = await fetch(config.enturUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ET-Client-Name": config.clientName,
      },
      body: JSON.stringify({ query: query, variables: variables }),
    });

    if (!response.ok) {
      throw new Error("Entur svarte med HTTP " + response.status);
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
      throw new Error(payload.errors[0].message || "GraphQL-feil fra Entur");
    }
    return payload.data;
  }

  async function fetchDepartures(config, quayId, numberOfDepartures) {
    const data = await graphql(config, QUAY_QUERY, {
      id: quayId,
      numberOfDepartures: numberOfDepartures,
    });
    const quay = data && data.quay;
    if (!quay) {
      throw new Error("Fant ikke kai " + quayId);
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
        return MODE_LABELS[mode] || mode;
      })
      .join(", ");
  }

  async function searchStops(config, text) {
    const url =
      config.geocoderUrl +
      "?text=" +
      encodeURIComponent(text) +
      "&lang=no&size=20&layers=venue";
    const response = await fetch(url, {
      headers: { "ET-Client-Name": config.clientName },
    });
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

    return {
      lineId: line.id || "",
      line: line.publicCode || "–",
      destination:
        (call.destinationDisplay && call.destinationDisplay.frontText) ||
        "Ukjent",
      mode: line.transportMode || "",
      colour: presentation.colour ? "#" + presentation.colour : "",
      textColour: presentation.textColour ? "#" + presentation.textColour : "",
      expected: expected,
      aimed: aimed,
      realtime: Boolean(call.realtime),
      cancelled: Boolean(call.cancellation),
      delayMinutes: delayMinutes,
      situations: situations,
    };
  }

  global.NV5Entur = {
    fetchDepartures: fetchDepartures,
    searchStops: searchStops,
    fetchStopQuays: fetchStopQuays,
    fetchQuayLines: fetchQuayLines,
  };
})(window);
