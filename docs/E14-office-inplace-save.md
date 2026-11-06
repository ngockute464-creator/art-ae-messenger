# E14 — In-place Office document editing
Previous behavior: VibeOffice's File > Save downloaded a modified local copy; the document on Yandex Disk was unchanged.

New intended behavior:
- For a project DOCX/XLSX opened using **Edit**, a visible **Сохранить** button in ART-AE and VibeOffice's File > Save use VibeOffice's own exporter, not a custom serialization.
- The embedded office frame intercepts L.saveFile **only for the original filename**, sends the resulting Blob to the authenticated parent; Save As under a different name still downloads locally.
- The server obtains the document's modified timestamp before opening, and on save rejects a known mismatch with HTTP 409. Successful small saves replace the same Yandex Disk path and return the new modification timestamp. Saving success is acknowledged to VibeOffice only after remote completion; on error it should retain dirty changes.
- Docs above Netlify's 3 MiB transfer safety limit use a signed Yandex Disk URL with a version precheck. Browser direct transfers depend on Yandex CORS: MUST be tested. The version check and direct transfer are **not atomic**, so simultaneous writes between the precheck and upload can still race.
- All API endpoints check session, validate file path relative to an active project, and enforce same-origin for POST. OAuth key never enters the browser.
- Both same-origin and isolated-office build variants have the save bridge. The second isolated Office site remains separately configured.

Before relying on this for important files, manually test on staging:
1. DOCX under 3 MiB: edit, Save, close, reopen, verify changes; verify another browser/user sees the update.
2. XLSX under 3 MiB: change a cell, Save, reopen, verify.
3. Two users edit the same file: second save must show version conflict, not overwrite earlier changes.
4. Save As under a different filename should download a copy and not overwrite project original.
5. Large DOCX/XLSX: opening, saving and round-trip validation across target browsers (CORS, memory). Test a backup first.
6. Check view/preview mode does not write back.

Risks: no atomic compare-and-swap exposed by current Yandex Disk upload API, so timestamps minimize but cannot eliminate concurrent-write races. No live Netlify/Yandex integration test or Office binary round-trip has been performed by this change.
