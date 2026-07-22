# nv5-sis – server

Last opp til `nv5.haatetepe.no/sis/`.

`index.php` speiler `main` fra GitHub og viser tavlen.

## GitHub-sjekk

Intervallet settes i **Innstillinger** på tavlen (ikke i denne filen).

- Lagres som cookie `nv5_github_interval` (sekunder)
- Fallback hvis cookie mangler: `$githubCheckIntervalSeconds = 300` i `index.php`
- `?sync=1` tvinger sjekk (brukes når GitHub-intervallet endres)
- Sync bruker fil-lås (`.sync.lock`) så samtidige treff ikke korumperer `content/`
- Hvis sync allerede kjører, vises cached tavle med en gang

Trenger PHP med **curl** (eller `allow_url_fopen`) og **zip**.
