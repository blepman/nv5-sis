# Agent-regler for nv5-sis

Kortfil for agenter. Detaljer og bakgrunn: [`docs/PROJECT_KNOWLEDGE.md`](docs/PROJECT_KNOWLEDGE.md). Drift for mennesker: [`README.md`](README.md).

## Oppdrag

NV5-SIS er en **sanntidstavle (kiosk)** på `https://nv5.haatetepe.no/sis/`. Standard fokusus: holdeplassavganger fra Entur, lesbar på stor skjerm / iPhone PWA — ikke et generelt reiseplanleggingsprodukt.

## Git og leveranse

- Feature-branch: `cursor/<beskrivelse>-e142` (lowercase).
- Inneholder **`main`** → tavle (HTML/CSS/JS). Inneholder **`server`** → PHP/speil.
- Når arbeidet er ferdig: **commit, push, PR, merge til riktig base** (`main` / `server`) uten å blokkere på at brukeren må synce manuelt først.
- Etter merge kan brukeren synce live (`?sync=main` / `server` / `both`); tilby det kort, ikke som forutsetning for merge.
- Ikke commit midlertidige undersøkelsesfiler, handoff-lister eller Tognr-kode inn i dette repoet med mindre brukeren ber om det.

## Dokumentasjon — hold den levende

Etter substantiell lærdom i en oppgave (ny UI-lov, Entur-funn, sync-felle, brukerpreferanse):

1. Oppdater **`docs/PROJECT_KNOWLEDGE.md`** (fakta / «ikke gjør X»).
2. Oppdater **denne fila** bare hvis det er en **ny hard regel** for agenter.
3. Oppdater **`README.md`** bare hvis **drift/arkitektur** endret seg.

## UI — harde lærdommer

- Avgangsrad = **aside** (statusstripe + badge-stack) + **body** (dest/tid + situasjon).
- Statusstripe følger **badge-stack**, ikke lang situasjonstekst.
- Featured-rader: equalize høyde (`syncDepartureBadges`) med viewport-tak.
- **Ticker** er kompakt (~`3.1rem`), vertikalt sentrert som Nå/min — ikke la den vokse med radhøyde.
- Sparse innhold / kort situasjonstekst: vertikalt sentrert.
- **Ikke** lag draw.io-/interaktive wireframes «for dokumentasjon» — de ble fjernet som for tungvinte på mobil.
- Footer: valgfrie commit-SHA (`showBuildInfo`); **favicon.png**-nedlasting skal forbli tilgjengelig.

## Entur — harde lærdommer

- Hovedkilde: Journey Planner GraphQL. Header: `ET-Client-Name`.
- `privateCode` ≠ vognløp. Tur-ID er opaque hash. Ruter har **ikke** offentlig kjøretøyposisjon via Entur.
- Prod-query i `js/entur.js` henter **ikke** `privateCode` i dag — legg det bare til hvis funksjonen trenger det.
- Vognløp-prediksjon / «Tognr» er **eget spor utenfor dette repoet**. Pek til handoff hos brukeren; ikke bygg inn prediksjon i kiosk-UI før det er eksplisitt bestilt og stabilt.

## Mobil / cloud-agent

- Cursor mobil-app har **ikke** filutforsker; artefakt-lenker kan gi **404**.
- Lange kodeblokker er upraktiske å kopiere på mobil — bruk korte svar, web (`cursor.com/agents`), eller midlertidig ekstern paste når brukeren trenger hele dokumenter.

## Scope-disiplin

- Én jobb om gangen; ikke utvid til vognløp/algoritme midt i en tavle-PR.
- Bevar eksisterende design-/kiosk-språk; ikke «redesign for moro».
