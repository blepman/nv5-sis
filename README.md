# nv5-sis – server

Last opp til `nv5.haatetepe.no/sis/`.

`index.php` speiler `main` fra GitHub og viser tavlen.

## GitHub-sjekk

Intervallet settes i **Innstillinger** på tavlen (ikke i denne filen).

- Lagres som cookie `nv5_github_interval` (sekunder)
- Fallback hvis cookie mangler: `$githubCheckIntervalSeconds = 300` i `index.php`
- `?forceGithub=1` tvinger sjekk (brukes når innstillinger lagres)

Trenger PHP med **curl** (eller `allow_url_fopen`) og **zip**.
