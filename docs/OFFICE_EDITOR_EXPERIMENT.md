# ART-AE browser Office editor laboratory

This is an **isolated build-only experiment**, not a deployed editor. It builds
`ranuts/document` from pinned commit `07f26233e2cc2c1080f540b8393c23127cba6638`
and uploads its **complete static** `dist/` as a GitHub Actions artifact.

No project files, Yandex credentials, Supabase credentials or ART-AE messages
are sent to the build. The only external dependency is publicly available
open-source editor code and package dependencies.

## Next phase (only after checking the build)
Deploy this static bundle on an independently controlled **root-domain site**,
so absolute SDK paths such as `/sdkjs/` resolve correctly. Keep the editor
separate from the ART-AE Netlify site to avoid asset namespace and PWA
service-worker conflicts.

Use the editor's iframe API as described by the upstream
`docs/embed-api.md`. The ART-AE parent fetches a document through its own
authenticated files API, passes the in-memory ArrayBuffer using
`document:open-buffer`, and handles `document:saved`.

The first connected trial must **only download the edited copy** to the
operator's computer. No writeback to Yandex Disk until an explicit safe-save
implementation includes version/precondition checks, backup and conflict
handling. Never use a third-party editor deployment to open private files.

Editor license: AGPL-3.0 and upstream NOTICE, including attribution/logo terms.
Review compliance before distribution. The engine is large (upstream build
documentation mentions roughly 616MB of static files), so verify host limits
and realistic mobile data usage before public availability.

No change to `test` or `main`.
