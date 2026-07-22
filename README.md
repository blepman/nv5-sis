# nv5-sis

Sanntidstavle vist på `https://nv5.haatetepe.no/sis/` (speilet fra denne `main`-branchen av `server`/PHP).

## Branch-modell

| Branch | Innhold |
|--------|---------|
| `main` | Tavlen (HTML/CSS/JS) |
| `server` | PHP som speiler `main` til `/sis` |
| `feature/*` | Ny funksjonalitet → merge til `main` |

## Holdeplasser og elementer

- Standard: **Tveita T** kai `NSR:Quay:11309` (mot sentrum)
- **Innstillinger** på siden: søk holdeplass, velg **alle retninger** eller én kai, huk av linjer, sett antall elementer, sett hvor ofte GitHub sjekkes
- Valg lagres i `localStorage` (+ cookie for GitHub-intervall som PHP leser)
- Standard **3 elementer** per quay:
  1. Neste avgang
  2. Avgang nr. 2
  3. Neste 4 avganger som ticker i samme kortstil
- Hver holdeplass viser egen oppdateringsstatus (**Oppdatert** / **Ikke oppdatert · viser …** / feil). Ved feil beholdes forrige data (stale) i stedet for blank tavle.
- Endring av GitHub-sjekkintervall lagrer cookie og reloader med `?sync=1` slik at PHP kan hente ny kode. Andre innstillinger refresher tavlen uten full side-reload.

## Filer

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
