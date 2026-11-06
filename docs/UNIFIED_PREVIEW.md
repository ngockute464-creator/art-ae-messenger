# ART-AE unified preview build — E1 + E2 + E3

The repository supports two isolated branch builds within **one existing Netlify site**.

## Branches
- `netlify-preview`: messenger, PostgreSQL E3 schema/guarded bootstrap, E1 fixes. Its Office integration is feature-gated.
- `office-preview`: static isolated VibeOffice, dedicated branch deploy. Its root netlify.toml builds `office-site/dist`.
- `main` / `test`: untouched.

## Deployment conditions
With Netlify credits exhausted, there may be **no active Office branch deploy**. GitHub commits do not guarantee Netlify deployment.
Do **not** set `ARTAE_OFFICE_ORIGIN` until `https://office-preview--art-ae-messenger.netlify.app` is confirmed to serve the correct Office app.

When Netlify deployment is available and `office-preview` branch deploy is enabled:
1. Verify office site serves `/quire/`, `/ledger/`, and `/artae-bridge.js` with CSP allowing only the exact messenger origin.
2. Verify independent origins and no messenger cookies on Office requests.
3. Add main-site environment variable `ARTAE_OFFICE_ORIGIN=https://office-preview--art-ae-messenger.netlify.app`.
4. Rebuild `netlify-preview` and test DOCX edit/preview, XLSX edit/preview, PDF generation, close/reopen and mobile handling.
5. Confirm that an Office script cannot make authenticated API calls to main host; test cross-origin communication source checks and API CORS/origin enforcement.
6. If any check fails, remove env variable and redeploy the prior known-good build. The default path remains the legacy Office.

## Security caveat
Until the isolated branch has been deployed and main feature-gate enabled, same-origin VibeOffice remains active. Avoid processing sensitive documents.

## Supabase
No E3 migrations are auto-run and no runtime Supabase data is changed by branch creation. E3 schema and uniqueness scripts remain proposals for separately approved application.
