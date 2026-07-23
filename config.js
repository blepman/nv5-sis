window.NV5_SIS = {
  clientName: "haatetepe-nv5-sis",
  enturUrl: "https://api.entur.io/journey-planner/v3/graphql",
  geocoderUrl: "https://api.entur.io/geocoder/v1/autocomplete",
  pollIntervalMs: 30000,
  fetchTimeoutMs: 10000,
  pageReloadIntervalMs: 5 * 60 * 1000,
  // Default: Tveita T mot sentrum
  quays: [
    {
      // kind: "quay" (én retning) eller "stopPlace" (alle retninger)
      kind: "quay",
      id: "NSR:Quay:11309",
      name: "Tveita T",
      direction: "Mot sentrum",
      // Tom lineIds = alle linjer. Ellers liste med line-id (f.eks. RUT:Line:2).
      lineIds: [],
      availableLines: [],
    },
  ],
  // Elementer per quay: N-1 enkeltavganger + siste element = neste 3–4 avganger
  elementsPerQuay: 3,
  compactDepartures: 4,
  // Featured-avganger: posisjon i ruten, belegg, tjenestekjøring
  showJourneyProgress: true,
  showOccupancy: true,
  showServiceRuns: true,
  showBuildInfo: true,
  // Hvor ofte PHP skal sjekke GitHub (sekunder). 0 = ved hvert sidebesøk.
  githubCheckIntervalSeconds: 300,
  githubIntervalCookie: "nv5_github_interval",
  storageKey: "nv5-sis-settings",
};
