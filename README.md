# nv5-sis

Sanntidstavle vist på `https://nv5.haatetepe.no/sis/`.

## Branch-modell

| Branch | Innhold |
|--------|---------|
| `main` | Tavlen (HTML/CSS/JS) |
| `server` | PHP som speiler seg selv + speiler `main` til `content/` |

Feature-branches:

- Til `main`: branchnavn må inneholde `main`
- Til `server`: branchnavn må inneholde `server`

## Hvordan det fungerer

1. PHP i `/sis/` speiler **`server`-branchen** til samme mappe (ca. hver time, eller via menyknappen).
2. Deretter speiles **`main`** til `content/` (intervall styres i Innstillinger).
3. Tavlen vises fra `content/` og henter avganger fra Entur.

## Meny

Hamburgermeny øverst til høyre:

- **Innstillinger** — holdeplasser, linjer, elementer, intervall for `main`
- **Bygg siden på nytt** — tvinger sync av `server` (`?sync=server`)
- **Bygg tavlen på nytt** — tvinger sync av `main` (`?sync=main`)

`?sync=both` (eller `?sync=1`) synker begge.

## Holdeplasser og elementer

- Standard: **Tveita T** kai `NSR:Quay:11309` (mot sentrum)
- Valg lagres i `localStorage` (+ cookie for `main`-intervall som PHP leser)
- Standard **3 elementer** per quay (siste = ticker)
- Hver holdeplass viser egen oppdateringsstatus med sekunder
- Statusfarge på oppdateringstid: grønn under 29s, gul fra 29s, rød fra 179s

## Filer (`main`)

- `index.html` – layout
- `config.js` – defaults
- `js/entur.js` – Entur GraphQL + geocoder
- `js/site.js` – UI, poll, innstillinger
- `css/kiosk.css` – stil

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
