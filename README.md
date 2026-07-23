# nv5-sis – server

Last opp til `nv5.haatetepe.no/sis/` **én gang**.

`index.php` speiler deretter seg selv fra GitHub-branchen `server`, og speiler tavlen fra `main` til `content/`.

## Engangs-oppsett

1. Last opp:
   - https://raw.githubusercontent.com/blepman/nv5-sis/server/index.php
   - https://raw.githubusercontent.com/blepman/nv5-sis/server/.htaccess
2. Åpne `https://nv5.haatetepe.no/sis/?sync=both`

Etter dette trenger du normalt ikke laste opp filer manuelt ved senere endringer.

## GitHub-sjekk

| Hva | Automatisk | Tving med URL |
|-----|------------|---------------|
| Serverfiler (`server` → `/sis/`) | Hver time | `?sync=server` |
| Tavle (`main` → `content/`) | Cookie `nv5_github_interval` (Innstillinger), fallback 300s | `?sync=main` |
| Begge | — | `?sync=both` eller `?sync=1` |

På tavlen (hamburgermeny):

- **Bygg siden på nytt** → `?sync=server`
- **Bygg tavlen på nytt** → `?sync=main`

- Sync bruker fil-låser (`.server.lock`, `.sync.lock`)
- `content/` og cache-filer (`.last-*`, `.server-*`) overskrives ikke av server-speil
- Hvis sync allerede kjører, vises cached tavle

Trenger PHP med **curl** (eller `allow_url_fopen`) og **zip**.
