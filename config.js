window.NV5_SIS = {
  clientName: "haatetepe-nv5-sis",
  enturUrl: "https://api.entur.io/journey-planner/v3/graphql",
  geocoderUrl: "https://api.entur.io/geocoder/v1/autocomplete",
  pollIntervalMs: 30000,
  pageReloadIntervalMs: 5 * 60 * 1000,
  // Default: Tveita T mot sentrum
  quays: [
    {
      id: "NSR:Quay:11309",
      name: "Tveita T",
      direction: "Mot sentrum",
    },
  ],
  // Elementer per quay: N-1 enkeltavganger + siste element = neste 3–4 avganger
  elementsPerQuay: 3,
  compactDepartures: 4,
  storageKey: "nv5-sis-settings",
};
