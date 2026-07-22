# nv5-sis – server

Last opp til `nv5.haatetepe.no/sis/`.

`index.php` speiler `main` fra GitHub og viser tavlen.

## GitHub-sjekk

Øverst i `index.php`:

```php
$githubCheckIntervalSeconds = 300; // sekunder mellom GitHub-sjekker
```

- `300` = sjekk maks hvert 5. minutt (standard)
- `0` = sjekk ved hvert besøk

Mellom sjekkene vises cached `content/`.

Trenger PHP med **curl** (eller `allow_url_fopen`) og **zip**.
