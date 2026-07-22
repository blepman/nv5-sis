# nv5-sis – server

Last opp denne branchen til `https://nv5.haatetepe.no/sis/`.

## Filer

- `index.php` – viser tavlen (cached `main`) og håndterer sync
- `.htaccess` – DirectoryIndex + skjul listing

## Oppsett

1. Last opp filene til `/sis/`
2. Rediger `sync_token` øverst i `index.php` (eller lag `config.php` som returnerer et array med overrides)
3. Første sync:

```text
https://nv5.haatetepe.no/sis/?sync=1&force=1&token=DITT_TOKEN
```

4. Cron (hvert 5. min):

```cron
*/5 * * * * curl -fsS "https://nv5.haatetepe.no/sis/?sync=1&token=DITT_TOKEN" >/dev/null
```

Trenger PHP med **curl** (eller `allow_url_fopen`) og **zip**.
