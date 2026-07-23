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

`?sync=` er **åpent med vilje** for tavle (`main`), med **rate limit per IP** (ca. 45s for tavle, 120s for server). Ved rate limit settes `Retry-After`, og forespørselen faller tilbake til planlagt intervall.

På tavlen (hamburgermeny):

- **Bygg siden på nytt** → `?sync=server`
- **Bygg tavlen på nytt** → `?sync=main`

### Valgfri nøkkel for `?sync=server`

Som standard kreves ingen nøkkel. For å kreve nøkkel ved server-sync:

1. Sett miljøvariabel `NV5_SYNC_SERVER_KEY`, **eller**
2. Opprett filen `sync-server-secret` i state-mappen (se under)

Deretter: `?sync=server&key=DIN_NØKKEL` (eller `?sync=both&key=…`). Feil/manglende nøkkel soft-denyer bare server-delen.

Audit-logg: `sync-audit.log` i state-mappen (IP + allow/deny).

### Drift / state

- Sync bruker fil-låser i **state-mappe utenfor webroot** (`sys_get_temp_dir()/nv5-sis-…`)
- Ved første kjøring flyttes gamle `.last-*` / `.server-*` ut av `/sis/` og slettes fra webroot
- `README.md` / `.gitignore` speiles **ikke** til webroot
- Påkrevde serverfiler som alltid speiles: `index.php`, `.htaccess` (mangler de, kjøres sync på nytt selv om SHA er uendret)
- `?sync=server` tvinger alltid ny speiling av serverfilene (ikke bare SHA-sjekk)
- `content/` overskrives ikke av server-speil
- Hvis sync allerede kjører, vises cached tavle
- `main` → `content/` kopierer kun allowlistede filtyper (`html`, `css`, `js`, `woff2`, `png`, `webmanifest`, `json`); symlinks og path-traversal i zip avvises
- HTML får `?v=<board-sha>` på CSS/JS/font-URL-er, så nettleseren ikke sitter på gammel cache etter «Hent ny tavle»

Trenger PHP med **curl** (eller `allow_url_fopen`) og **zip**.

## Sikkerhetshoder

`index.php` sender CSP, HSTS (ved HTTPS), `X-Frame-Options`, `Permissions-Policy`, m.m. for tavle-HTML.

`.htaccess` setter tilsvarende hoder for statiske filer under `/sis/` (inkl. `content/`).

**Ikke sett en ekstra `Content-Security-Policy` i nginx** — browsere håndhever alle CSP-hoder samtidig (strengeste kombinasjon). La PHP være den ene CSP-kilden for HTML.

## Valgfritt: nginx defense-in-depth

State ligger i system-temp (ikke under document root), så deny-regler er ikke påkrevd for sync-metadata. Ekstra sperre + sikkerhetshoder (valgfritt):

```nginx
# HSTS (anbefalt på HTTPS-vhost)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# Ikke dupliser Content-Security-Policy her — den kommer fra PHP / .htaccess
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Frame-Options "DENY" always;

# PWA/start_url skal lande på /sis/, ikke /sis/content/
location = /sis/content {
    return 302 /sis/;
}
location = /sis/content/ {
    return 302 /sis/;
}
location = /sis/content/index.html {
    return 302 /sis/;
}

location ~* ^/sis/(README\.md|\.(last-sha|last-check|server-sha|server-check|sync\.lock|server\.lock))$ {
    deny all;
    return 404;
}
location ~ ^/sis/\. {
    deny all;
    return 404;
}
location ^~ /sis/content/ {
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "DENY" always;
    add_header Permissions-Policy "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()" always;
    location ~ \.php$ {
        deny all;
        return 404;
    }
}
```
