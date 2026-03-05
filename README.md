# aham-cloudflare

Version Cloudflare Free Tier du projet `aham-calendar`:
- Runtime: Cloudflare Workers
- Base de donnees: Cloudflare D1 (SQLite)
- Frontend: HTML/CSS/JS vanilla (pas de framework)
- Dependances npm: `wrangler` uniquement

## Fonctionnalites

- `GET /`:
  - liste les evenements publies
  - formulaire public pour proposer un evenement (table `events_pending`)
- `GET /admin`:
  - UI admin simple (token)
  - liste `pending`
  - actions: modifier / valider / rejeter
- API:
  - `GET /api/events`
  - `GET /api/upcoming?days=8&limit=4`
  - `POST /api/submit`
  - `GET /api/admin/pending`
  - `POST /api/admin/update`
  - `POST /api/admin/validate`
  - `POST /api/admin/reject`

## Demarrage local

1. Installer deps:
   ```bash
   npm install
   ```
2. Copier `.dev.vars.example` en `.dev.vars` puis definir `ADMIN_TOKEN`.
3. Initialiser D1 local:
   ```bash
   npm run db:migrate:local
   ```
4. Lancer:
   ```bash
   npm run dev
   ```

## Deploiement Cloudflare

1. Creer la base D1:
   ```bash
   npm run db:create
   ```
2. Recuperer `database_id` depuis la sortie, puis remplacer `REPLACE_WITH_D1_DATABASE_ID` dans `wrangler.toml`.
3. Appliquer le schema sur D1 remote:
   ```bash
   npm run db:migrate:remote
   ```
4. Ajouter le secret admin:
   ```bash
   wrangler secret put ADMIN_TOKEN
   ```
5. Deploy:
   ```bash
   npm run deploy
   ```

## Notes Cloudflare Free Tier

- Compatible Free Tier: pas de serveur dedie, tout sur Worker + D1.
- Pas de framework UI ni backend.
- Pas de cron, pas de process long-running dans cette version.

