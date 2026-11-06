# Isolated VibeOffice — site creation instructions

The **Office site is NOT deployed yet**. These files do not alter the live ART-AE application. Same-origin editor remains active until separate-origin QA passes.

Create a NEW site at Netlify using the *existing* GitHub repository `ngockute464-creator/art-ae-messenger`, branch `netlify-preview`.

- Base directory: repository root (empty)
- Package directory: `office-site` (selects `office-site/netlify.toml` instead of root config)
- Build command: `node office-site/build.mjs`
- Publish directory: `office-site/dist`
- Environment: `ARTAE_PARENT_ORIGIN=https://netlify-preview--art-ae-messenger.netlify.app`
- Do NOT add Yandex Disk, Supabase or ART-AE session secrets to Office site.

Netlify should create a distinct HTTPS domain. Validate `/quire/`, `/ledger/` and `/artae-bridge.js`, and verify response CSP `frame-ancestors` explicitly names parent.

Then set the **main site's** `ARTAE_OFFICE_ORIGIN` to the distinct exact HTTPS origin and switch main build from `server/office-patch.mjs` to `office-site/integration/office-patch.mjs`. Do not switch before browser tests for DOCX/XLSX/PDF and authenticated API isolation.

Pinned upstream VibeOffice: `2ee1000584945e69ee872cbd21ab2f8bd7a80d8d`. A network/build failure must fail closed; it must not fall back to same-origin. The PDF output is rasterized.
