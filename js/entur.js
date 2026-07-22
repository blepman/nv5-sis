(function (global) {
  const QUERY = `
    query QuayDepartures($id: String!, $numberOfDepartures: Int!) {
      quay(id: $id) {
        id
        name
        description
        estimatedCalls(numberOfDepartures: $numberOfDepartures) {
          expectedDepartureTime
          aimedDepartureTime
          realtime
          destinationDisplay {
            frontText
          }
          serviceJourney {
            line {
              publicCode
              name
              transportMode
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

  async function fetchDepartures(config) {
    const response = await fetch(config.enturUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ET-Client-Name": config.clientName,
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          id: config.quayId,
          numberOfDepartures: config.numberOfDepartures,
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Entur svarte med HTTP " + response.status);
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
      throw new Error(payload.errors[0].message || "GraphQL-feil fra Entur");
    }

    const quay = payload.data && payload.data.quay;
    if (!quay) {
      throw new Error("Fant ikke kai " + config.quayId);
    }

    return {
      name: quay.name,
      description: quay.description,
      departures: (quay.estimatedCalls || []).map(normalizeCall),
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

    return {
      line: (call.serviceJourney &&
        call.serviceJourney.line &&
        call.serviceJourney.line.publicCode) ||
        "–",
      destination:
        (call.destinationDisplay && call.destinationDisplay.frontText) ||
        "Ukjent",
      mode:
        (call.serviceJourney &&
          call.serviceJourney.line &&
          call.serviceJourney.line.transportMode) ||
        "",
      expected: expected,
      aimed: aimed,
      realtime: Boolean(call.realtime),
      delayMinutes: delayMinutes,
      situations: situations,
    };
  }

  global.NV5Entur = {
    fetchDepartures: fetchDepartures,
  };
})(window);
