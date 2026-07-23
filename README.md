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
| Tavle (`main` → `content/`) | Cookie `nv5_github_interval` (Innstillinger), min 60s, fallback 300s | `?sync=main` |
| Begge | — | `?sync=both` eller `?sync=1` |

`?sync=` er **åpent med vilje** — brukeren skal kunne tvinge oppdatering uten nøkkel. Tilliten ligger i GitHub-repoet (`server` = PHP, `main` = tavle).

På tavlen (hamburgermeny):

- **Bygg siden på nytt** → `?sync=server`
- **Bygg tavlen på nytt** → `?sync=main`

- Sync bruker fil-låser i **state-mappe utenfor webroot** (`sys_get_temp_dir()/nv5-sis-…`)
- Ved første kjøring flyttes gamle `.last-*` / `.server-*` ut av `/sis/` og slettes fra webroot
- `README.md` / `.gitignore` speiles **ikke** til webroot
- `content/` overskrives ikke av server-speil
- Hvis sync allerede kjører, vises cached tavle
- `main` → `content/` kopierer kun allowlistede filtyper (`html`, `css`, `js`, `woff2`, `png`, `webmanifest`, `json`); symlinks og path-traversal i zip avvises

Trenger PHP med **curl** (eller `allow_url_fopen`) og **zip**.

## Valgfritt: nginx defense-in-depth

State ligger i system-temp (ikke under document root), så deny-regler er ikke påkrevd for sync-metadata. Ekstra sperre mot gamle restfiler / PHP under `content/` (valgfritt):

```nginx
location ~* ^/sis/(README\.md|\.(last-sha|last-check|server-sha|server-check|sync\.lock|server\.lock))$ {
    deny all;
    return 404;
}
location ~ ^/sis/\. {
    deny all;
    return 404;
}
location ^~ /sis/content/ {
    location ~ \.php$ {
        deny all;
        return 404;
    }
}
```