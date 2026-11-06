# E5 message revision consistency (preview)
Verified with isolated simulated PostgreSQL REST and client bundle tests (16/16 passing).
Two devices editing the same message must send the `editedAt` value that the editor originally displayed.
Server checks `expectedEditedAt` against `edited_at` before the compare-and-set PATCH.
For delete, the client sends the version visible when the user initiates deletion.
A cached older PWA shell that does not send the field receives HTTP 409 rather than silently overwriting a newer message; refreshing to the new shell is required for edits/deletes.
No SQL migrations, live DB mutations, or user data transformations.
Remaining QA: real multi-device browser test and offline/send/restore scenarios; do not claim complete network fault coverage.
