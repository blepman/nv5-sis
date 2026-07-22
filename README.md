# nv5-sis

Sanntidstavle for **Tveita T** (mot sentrum), vist på `https://nv5.haatetepe.no/sis/` i kioskmodus på iPhone.

## Branch-modell

| Branch | Innhold |
|--------|---------|
| `main` | Selve tavlen (denne branchen): HTML/CSS/JS mot Entur |
| `server` | PHP som lastes opp til `/sis` og synker/viser `main` |
| `feature/*` | Ny funksjonalitet → merge til `main` |

Når noe merges til `main`, oppdager PHP på serveren ny commit og oppdaterer tavlen automatisk. Du trenger ikke laste opp `main` manuelt.

## Holdeplass

- Stopp: Tveita T
- Kai: `NSR:Quay:11309` (retning sentrum)
- API: Entur Journey Planner v3 GraphQL
- Klientnavn: `haatetepe-nv5-sis` (settes i `config.js`)

## Lokal preview

Åpne `index.html` via en enkel statisk server (fetch mot Entur krever HTTP(S), ikke `file://`):

```bash
python3 -m http.server 8080
```

Gå til `http://localhost:8080`.

## Kiosk på iPhone

1. Åpne `https://nv5.haatetepe.no/sis/` i Safari
2. Del → **Legg til på Hjem-skjerm**
3. Åpne snarveien (standalone)
4. Valgfritt: **Guided Access** for å låse skjermen til appen

Tavlen henter avganger ca. hvert 30. sekund og forsøker Screen Wake Lock der det støttes.

## Utvikling

1. Opprett `feature/...` fra `main`
2. Endre tavlen, test lokalt
3. Merge til `main`
4. Vent på sync (cron / token-kall på server) — kiosken viser ny versjon
