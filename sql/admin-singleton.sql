-- REQUIRED ON NEW INSTALLATIONS BEFORE ARTAE_ALLOW_FRESH_BOOTSTRAP=1.
-- Existing installations: preflight and backup; do not apply automatically.
CREATE UNIQUE INDEX IF NOT EXISTS artae_users_single_admin_idx
 ON public.artae_users (role) WHERE role='admin';
