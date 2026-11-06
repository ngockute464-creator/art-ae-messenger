# E15 — exclusive editing of Office documents and message edit button row
- Only one editor may hold a lease for a given (project_id, file_path). The PostgreSQL primary key and UPSERT with expiry predicate implement atomic acquisition.
- Lease lasts 120 seconds and is renewed every 30 seconds; release occurs on close or pagehide. Loss of renewal disables saving. Second editor receives holder name.
- Ordinary file upload/replacement and deletion are rejected during active Office editing; only a lease holder can overwrite through Office save.
- For large Office saves, the browser uploads to private _artae_edit_staging/<lease_token>/pending.ext; only the authenticated server can move it over the original after revalidating the lease and file timestamp. Never return an overwrite link to the original file.
- This prevents two in-app Office editors from concurrently editing the same document. It is NOT real-time co-authoring. External Yandex Disk edits are detectable through changed timestamps but not locked.
- The save-to-Yandex path for Office requires real round-trip verification on Netlify staging before trusting important documents. Moves scheduled by Yandex may continue after request timeout; test before production.
- The message editor now displays «Добавить файл», «Сохранить», «Отмена» in a single no-wrap flex row. No handlers are replaced.
- DB migration `sql/office-locks.sql` applied to Supabase project art-ae on 2026-11-06 and validated with acquire / conflicting acquire / wrong-token renew / release / reacquire.
