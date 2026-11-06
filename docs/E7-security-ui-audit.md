# ART-AE E7: authorization/API and file-row UI audit (read-only security audit)
Repository base: a7aaae11c08b4a9333857e9ed751d9588df63306. Code review only, no database mutations and no live account penetration test.

## Verified in source
- PostgreSQL-backed auth accepts a session from a Secure, HttpOnly, SameSite=Strict cookie and verifies user is enabled, generation matches, and session last-seen deadline has not expired.
- Session-less callers are rejected by sync, file explorer, pins and realtime token endpoints; admin user/key management requires admin role.
- Revoking or disabling a member increments its generation and removes sessions, so older cookies fail on subsequent protected API requests.
- Supabase secret and Yandex Disk OAuth token are used by the server endpoints, not embedded into the browser file list.
- Write requests use same-origin checks, and file path handling validates relative paths. Office document viewer is still same-origin with the messenger unless ARTAE_OFFICE_ORIGIN is explicitly activated.

## Risk / limitations
- All enabled users currently share all projects. This matches the chosen 2–5-person collaborative model; do not claim per-project access isolation exists.
- VibeOffice still runs on the main origin until separate-origin Branch Deploy is activated. Its source must be treated as privileged; this is the highest remaining security task.
- Cookie lifetime is 180 days (inactivity checked on each request). Consider shorter sessions only if desirable for this closed group; no changes made.
- No dynamic test against a logged-out/disabled real account and no deployed cross-origin browser isolation test have been run. Those must happen before declaring the security audit complete.
- A GET auth/status endpoint reveals initialization as a boolean; it does not expose user names or access keys.

## File UI changes
- File name remains the preview action, including DOCX/XLSX.
- Magnifying glass removed. A leading native three-dot menu contains Edit (DOCX/XLSX only) and Delete. Download remains a visible arrow; pin remains a direct action.
- Pin visual: gray upright when unpinned, green tilted when pinned. No share action is implemented until requested.
