# E6 — Message network recovery

- An unconfirmed outgoing message stays visible, with a Retry control.
- Retry reuses its original request UUID; existing PostgreSQL primary-key idempotency prevents duplicate creation.
- A browser online event automatically attempts failed sends; reconciliation with server sync can also confirm a lost response.
- Later drafts are never overwritten by errors from an earlier send.
- Initial sync preserves pending and failed local messages.

Verification: offline client compilation passed, 4 isolated network scenarios passed, regression suite 30/30 passed. No live browser fault-injection yet.

Limitation: outgoing state is memory-only. Refreshing while a request has not been delivered may lose the message. Browser storage is deliberately avoided until the privacy implications are reviewed.

No schema changes or Supabase modifications.
