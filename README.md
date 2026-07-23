# nv5-sis

Sanntidstavle vist på `https://nv5.haatetepe.no/sis/`.

## Dokumentasjon

| Fil | For hvem | Innhold |
|-----|----------|---------|
| [README.md](README.md) (denne) | Drift / oppsett | Sync, branches, kiosk, filer |
| [AGENTS.md](AGENTS.md) | AI-agenter | Harde regler, scope, merge-vaner |
| [docs/PROJECT_KNOWLEDGE.md](docs/PROJECT_KNOWLEDGE.md) | Agenter + vedlikeholdere | UI-lover, Entur-fakta, anti-mønstre, Tognr-peker |

**Levende kunnskap:** Når noe nytt læres i arbeid eller samtale som er verdt å huske, oppdater `docs/PROJECT_KNOWLEDGE.md` (og `AGENTS.md` / denne README bare hvis regler eller drift endres).

Vognløp-prediksjon («Tognr») er et **eget spor utenfor dette repoet** — se pekeren i prosjektkunnskapen.

## Branch-modell

| Branch | Innhold |
|--------|---------|
| `main` | Tavlen (HTML/CSS/JS) |
| `server` | PHP som speiler seg selv + speiler `main` til `content/` |

Feature-branches:

- Til `main`: branchnavn må inneholde `main`
- Til `server`: branchnavn må inneholde `server`

Cloud-agent: `cursor/<beskrivelse>-e142` (lowercase).

## Hvordan det fungerer

1. PHP i `/sis/` speiler **`server`-branchen** til samme mappe (ca. hver time, eller via menyknappen).
2. Deretter speiles **`main`** til `content/` (intervall styres i Innstillinger, minimum 60s).
3. Tavlen vises fra `content/` og henter avganger fra Entur.

## Sync-modell og tillit

`?sync=main`, `?sync=server` og `?sync=both` er **åpne med vilje** — brukeren skal kunne tvinge oppdatering uten nøkkel når tavlen ikke er oppdatert. Tilliten ligger i GitHub-repoet: skrivetilgang til `server` kan endre PHP på hosten, skrivetilgang til `main` kan endre tavle-JS for alle kiosker.

## Meny

Hamburgermeny øverst til høyre:

- **Innstillinger** — holdeplasser, linjer, elementer, intervall for `main`, visningstoggles (posisjon, belegg, tjenestekjøring, commit-hash i footer), og **Bygg siden på nytt** (`?sync=server`)
- **Hent ny tavle** — tvinger sync av `main` (`?sync=main`)

`?sync=both` (eller `?sync=1`) synker begge.

## Holdeplasser og elementer

- Standard: **Tveita T** kai `NSR:Quay:11309` (mot sentrum)
- Valg lagres i `localStorage` (+ cookie for `main`-intervall som PHP leser)
- Standard **3 elementer** per quay (siste = ticker)
- Hver holdeplass viser egen oppdateringsstatus med sekunder
- Statusfarge på oppdateringstid: grønn under 29s, gul fra 29s, rød fra 179s

## Footer

- Valgfritt: siste 4 tegn av server-/main-commit (meta fra PHP), styrt av «Vis commit-hash i footer»
- Alltid: liten lenke **favicon.png** → laster ned `icons/favicon-32.png`

## Filer (`main`)

- `index.html` – layout
- `config.js` – defaults
- `js/entur.js` – Entur GraphQL + geocoder
- `js/site.js` – UI, poll, innstillinger
- `js/boot.js` – tidlig boot
- `css/kiosk.css` – stil
- `icons/` – favicon og PWA-ikoner
- `manifest.webmanifest` – PWA

## Lokal preview

```bash
python3 -m http.server 8080
```

Åpne `http://localhost:8080`.

## Kiosk på iPhone

1. Åpne `/sis/` i Safari
2. Del → **Legg til på Hjem-skjerm**
3. Valgfritt: Guided Access

Tavlen henter avganger ca. hvert 30. sekund og laster siden på nytt ca. hvert 5. minutt.
