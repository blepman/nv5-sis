# nv5-sis – server

Denne branchen lastes opp til **`https://nv5.haatetepe.no/sis/`**.

Filene her synker branchen **`main`** fra GitHub og viser tavlen. Du endrer ikke UI her — det gjøres i `main` / feature-brancher.

## Filer

| Fil | Rolle |
|-----|--------|
| `index.php` | Offentlig inngang – viser cached `main` |
| `sync.php` | Beskyttet sync-endepunkt for cron |
| `lib/sync.php` | GitHub-zipball → `content/` |
| `.htaccess` | DirectoryIndex, skjul listing, beskytt hemmeligheter |
| `config.example.php` | Mal for `config.php` |
| `content/` | Lokal cache av `main` (opprettes automatisk) |

## Første gangs oppsett

1. Last opp hele innholdet i `server` til `/sis/` på hosten
2. Kopier `config.example.php` → `config.php`
3. Sett et sterkt `sync_token`
4. Valgfritt: legg inn `github_token` for høyere GitHub rate limit
5. Sørg for at PHP har **curl** (eller `allow_url_fopen`) og **zip** (`ZipArchive`)
6. Kjør første sync:

```text
https://nv5.haatetepe.no/sis/sync.php?token=DITT_TOKEN&force=1
```

7. Åpne `https://nv5.haatetepe.no/sis/`

## Cron (anbefalt)

Kjør sync ca. hvert 5. minutt, f.eks.:

```cron
*/5 * * * * curl -fsS "https://nv5.haatetepe.no/sis/sync.php?token=DITT_TOKEN" >/dev/null
```

`index.php` kan også synke i bakgrunnen (styrt av `sync_on_view_interval`), men cron er mer pålitelig for kiosk.

## .htaccess / nginx

`.htaccess` setter `DirectoryIndex index.php` og slår av mappe-listing. Hvis hosten er ren nginx uten Apache bak, kan `.htaccess` ignoreres — sett da DirectoryIndex / index-fil i hostpanelet.

## Flyt etter deploy

1. Utvikle feature → merge til `main`
2. Cron / sync.php henter ny commit
3. Kiosken viser ny tavle uten ny opplasting av `/sis`
