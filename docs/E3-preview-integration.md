# ART-AE E3 preview integration
This preview contains E3 PostgreSQL schema documents and opt-in fresh-admin bootstrap.
* Published app retains the existing same-origin Office from E1. The E2 origin-isolation bundle is NOT enabled until an isolated Office deployment exists.
* No SQL changes are applied automatically; SQL files are inspection / fresh-install references.
* In existing environments ARTAE_ALLOW_FRESH_BOOTSTRAP is unset: POST bootstrap returns 409.
* Fresh installations require the separate singleton index, setup key, explicit flag and independent verification.
* Security warning: same-origin VibeOffice remains unresolved. Test with non-sensitive documents only.
* Changes built from netlify-preview baseline 6d0b68bdb74cc5cad246e3896de4979507c2a78b.
