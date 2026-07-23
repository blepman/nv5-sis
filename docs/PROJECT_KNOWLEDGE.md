# Prosjektkunnskap — nv5-sis

Levende kunnskapsbase for mennesker og agenter.  
**Oppdater denne fila** når samtalen eller arbeidet avdekker noe som er verdt å huske.

- Agent-regler (korte): [`AGENTS.md`](../AGENTS.md)
- Drift / sync / kiosk-oppsett: [`README.md`](../README.md)
- Vognløp-prediksjon (eget spor): se [Tognr / handoff](#tognr--vognløp-eget-spor) — **ikke** full algoritme her

**Sist vesentlig oppdatert:** 2026-07-23

---

## 1. Hva produktet er

| | |
|---|---|
| Live | `https://nv5.haatetepe.no/sis/` |
| Formål | Sanntids **avgangstavle** (kiosk / PWA) for kollektivtrafikk |
| Default | Tveita T, kai `NSR:Quay:11309` (mot sentrum) |
| Data | Entur Journey Planner GraphQL (+ geocoder for søk) |
| Ikke | Full reiseplanlegger; ikke Sporveien-operasjonsverktøy; ikke vognløp-UI (foreløpig) |

Klientnavn mot Entur: `haatetepe-nv5-sis` (`config.js`).

---

## 2. Arkitektur (kort)

| Branch | Rolle |
|---|---|
| `main` | Tavle: HTML/CSS/JS under repo-roten |
| `server` | PHP som speiler seg selv til `/sis/` og speiler `main` → `content/` |

Feature-branches: navn må inneholde `main` eller `server` etter mål.

**Sync (bevisst åpen):** `?sync=main` | `?sync=server` | `?sync=both` (eller `?sync=1`).  
Tillit ligger i GitHub-skrivetilgang, ikke i en sync-nøkkel.

**Innstillinger:** `localStorage` (`nv5-sis-settings`) + cookie for GitHub-sjekkintervall (PHP leser cookien). Minimum intervall 60s; bruk `?sync=` for øyeblikkelig sjekk.

**Bygg-info:** PHP kan injecte meta `nv5-server-sha` / `nv5-board-sha`. Footer viser siste 4 tegn når `showBuildInfo` er på. Footer viser også lenke for nedlasting av `icons/favicon-32.png` som `nv5-sis-favicon.png`.

**nginx:** `nginx-sis-pwa.conf` speiles til `/sis/` for referanse; er ikke HTTP-servert som statisk fil-app. Engangs `include` i vhost på hosten.

**Filer (`main`):**

| Fil | Rolle |
|---|---|
| `index.html` | Layout, meny, settings, footer |
| `config.js` | Defaults |
| `js/boot.js` | Tidlig boot |
| `js/entur.js` | Entur GraphQL + geocoder |
| `js/site.js` | UI, poll, innstillinger, rad-layout |
| `css/kiosk.css` | Kiosk-stil |
| `icons/` | Favicon, PWA-ikoner |
| `manifest.webmanifest` | PWA |

---

## 3. Begreper (Entur / tavle)

| Begrep | Betydning | Entur / kode |
|---|---|---|
| Holdeplassavgang | Én «avgang» på tavla | `EstimatedCall` |
| Tur | Én planlagt kjøring A→B | `ServiceJourney` / `DatedServiceJourney` |
| Tur-ID | Opaque ID | `serviceJourney.id` (hash — **ikke** predikerbar) |
| privateCode | Intern NeTEx-turkode | `serviceJourney.privateCode` — **hentes ikke** i prod i dag |
| Vognløp | Hastus duty-/tognummer | Finnes **ikke** i åpne Entur-data |
| Kjøretøy | Fysisk sett | **Ikke** offentlig for RUT via Entur |
| Featured | Store enkeltavganger | Første N−1 elementer per quay |
| Ticker | Kompakt liste neste avganger | Siste element per quay |

---

## 4. UI-lover (avgangsrad)

Lært gjennom mange layout-iterasjoner; ikke bryt uten bevisst redesign:

1. **Anatomi:** `aside` = statusstripe + badge-stack (linje, evt. situasjonsikon) | `body` = dest/tid + situasjonstekst.
2. **Statusstripe** følger høyden til **badge-stack**, ikke hele situasjonsblokken.
3. **Linjebadge** fyller `.departure__main`-høyde; situasjonsikon samme størrelse under når relevant.
4. **Equalize** featured-rader via `syncDepartureBadges()` (etter render), med viewport-tak.
5. **Ticker** forblir kompakt (~`3.1rem`), vertikalt midtstilt som Nå/min — ikke strekk til full radhøyde (klassisk «runaway height»-bug).
6. **Sparse** innhold og kort situasjonstekst: vertikalt sentrert.
7. Tid (Nå/min) og ticker-tid: samme vertikale midtlinje.
8. **Wireframes** (draw.io + interaktiv HTML) ble innført og **fjernet** — for tungvinte på mobil. Ikke gjeninnfør som standard dokumentasjonsform.

### Footer

- Commit-SHA: valgfritt (`showBuildInfo`).
- `favicon.png`-lenke: footeren forblir synlig selv om SHA er av.

---

## 5. Entur — praktisk

### Endepunkter

| Tjeneste | URL |
|---|---|
| Journey Planner | `POST https://api.entur.io/journey-planner/v3/graphql` |
| Geocoder | `GET https://api.entur.io/geocoder/v1/autocomplete` |

Alle kall: header **`ET-Client-Name: <org>-<app>`** (lowercase).

### Ruter (codespace `RUT`) via Entur realtime

| Feed | Tilgjengelig |
|---|---|
| SIRI ET, SX; GTFS-RT trip updates & alerts | Ja |
| SIRI VM / GTFS-RT vehicle positions | **Nei** (tomt i praksis) |
| Vehicle Positions GraphQL `codespaceId: "RUT"` | **0 kjøretøy** (2026-07-23) |

Docs:

- https://developer.entur.no/open-data/realtime
- https://developer.entur.no/docs/open-services/vehicle-positions
- Norsk SIRI-profil (Atlassian Entur)
- Ruter Vehicle API (lukket/TaaS): ikke antatt tilgjengelig uten avtale

### GraphQL-feller

- `whiteListed.lines` forventer **`[ID!]`**, ikke `[String!]`.
- Nyttige stopp-ID-er: Tveita `NSR:StopPlace:59517`, kai sentrum `NSR:Quay:11309`, Østerås `NSR:StopPlace:58277`, linje 2 `RUT:Line:2`.

### Det tavla faktisk bruker i dag

Fra `js/entur.js`: avganger, realtime, delay, situasjoner, occupancy (ofte `noData` på T-bane), journey progress (previous/first calls), linjefarger, tjenestekjøring-heuristikk. **Ikke** `privateCode`.

---

## 6. Tognr / vognløp (eget spor)

**Utenfor nv5-sis.** Egen idé om å predikere Hastus-vognløp fra `privateCode` + kalibrering.

Kort fakta (detaljer og kode ligger i separat handoff hos eier / evt. privat `Tognr`-repo):

- Linje 1–5: vognløp **X01–X99**; midtsiffer **2** = ekstra (**X2Y**); arrangement kan ha andre nummer.
- Anker 2026-07-23: Tveita→Østerås **07:49 = vognløp 202 = privateCode 2195**.
- Ordinær prediksjon: `Δvognløp ≈ ΔprivateCode` innen gyldig område; ikke publiser under X01.
- Snu Østerås (empiri): retur-`privateCode` ≈ vest − **479**, layover ~6 min — tids-par, ikke bevis for samme fysiske sett.
- `privateCode` er **ikke** stabil gjennom snu/døgnet.

**Regel for dette repoet:** ikke merge Tognr-algoritme eller store handoff-dokumenter inn i nv5-sis med mindre brukeren eksplisitt ber om det. Én setning + peker her er nok.

---

## 7. Agent- og samarbeidspreferanser

| Preferanse | Detalj |
|---|---|
| Merge | Fullfør med merge til `main`/`server` når arbeidet er ferdig; ikke be brukeren synce *før* merge |
| Sync | Kort tips etter merge er OK |
| Mobil | Ingen filutforsker i Cursor-appen; artefakter kan 404; lange copy-blocks er problematiske |
| Private repo | Cloud-agent ser bare repos GitHub App har tilgang til (f.eks. `Tognr` var utilgjengelig uten ekstra grant) |
| Scope | Hold tavle-PR-er rene; forskningslister kan ligge i chat / eksternt |

---

## 8. Anti-mønstre (ikke gjenta)

- Anta at `privateCode` = vognløp eller døgnstabil tog-ID.
- Ekstrapolere vognløp under X01 (f.eks. 195–200 på linje 2).
- La ticker arve full featured-radhøyde.
- Legge situasjonsstripe langs hele teksten i stedet for badge-stack.
- Store wireframe-dokumenter som «hjelp» for mobil-eier.
- Laste opp undersøkelses-CSV / Tognr-handoff til GitHub i nv5-sis uten forespørsel.
- Redesigne hele kiosken når oppgaven er en liten footer-/layout-fiks.

---

## 9. Endringslogg for denne fila

| Dato | Endring |
|---|---|
| 2026-07-23 | Første versjon: arkitektur, UI-lover, Entur, Tognr-peker, agentpreferanser, anti-mønstre |

Når du oppdaterer: legg en rad her + endre «Sist vesentlig oppdatert» øverst.
