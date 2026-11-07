-- ART-AE P4: additive local PostgreSQL Web Push queues.
-- Run as postgres against artae. Existing projects/messages are unchanged.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'artae' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.artae_schema_migrations WHERE version='003_message_reads')
 THEN RAISE EXCEPTION 'Apply read receipts migration first'; END IF;
END
$guard$;
CREATE TABLE IF NOT EXISTS public.artae_push_subscriptions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.artae_users(id) ON DELETE CASCADE,
 session_sid text NOT NULL REFERENCES public.artae_sessions(sid) ON DELETE CASCADE,
 endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 30 AND 2048),
 endpoint_hash text NOT NULL UNIQUE CHECK (endpoint_hash ~ '^[a-f0-9]{64}$'),
 p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 40 AND 200),
 auth_key text NOT NULL CHECK (length(auth_key) BETWEEN 16 AND 90),
 user_agent text NOT NULL DEFAULT '',
 created_at bigint NOT NULL,
 updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS artae_push_subscriptions_user_idx
 ON public.artae_push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS artae_push_subscriptions_session_idx
 ON public.artae_push_subscriptions(session_sid);
CREATE TABLE IF NOT EXISTS public.artae_push_deliveries (
 message_id uuid NOT NULL REFERENCES public.artae_messages(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL REFERENCES public.artae_push_subscriptions(id) ON DELETE CASCADE,
 recipient_user_id uuid NOT NULL REFERENCES public.artae_users(id) ON DELETE CASCADE,
 created_at bigint NOT NULL,
 next_try_at bigint NOT NULL,
 lease_until bigint NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0,
 finished_at bigint,
 last_error text,
 PRIMARY KEY(message_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS artae_push_deliveries_due_idx
 ON public.artae_push_deliveries(next_try_at)
 WHERE finished_at IS NULL;
GRANT SELECT,INSERT,UPDATE,DELETE ON
 public.artae_push_subscriptions,
 public.artae_push_deliveries TO artae_app;
INSERT INTO public.artae_schema_migrations(version)
 VALUES('004_web_push') ON CONFLICT(version) DO NOTHING;
COMMIT;
