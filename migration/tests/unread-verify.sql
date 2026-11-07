-- Migration was applied twice, safely and without resetting read baselines.
DO $test$
DECLARE n int; baseline bigint; unread int; total int;
BEGIN
 SELECT count(*) INTO n FROM public.artae_read_baselines;
 IF n<>2 THEN RAISE EXCEPTION 'Missing read baselines: %',n; END IF;
 SELECT before_created_at INTO baseline FROM public.artae_read_baselines
  WHERE user_id='11111111-1111-4111-8111-111111111111';
 IF baseline<>1000 THEN RAISE EXCEPTION 'Wrong historical baseline: %',baseline; END IF;
END
$test$;
-- Message after migration by Bob must be unread for Alice, not Bob.
INSERT INTO public.artae_messages(id,conversation_id,author_id,author_name,body,created_at) VALUES
 ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Bob','New for Alice',2000),
 ('77777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Alice','New for Bob',2001);
DO $test$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.artae_messages WHERE deleted_at IS NULL;
 IF n<>3 THEN RAISE EXCEPTION 'Unexpected message total %',n; END IF;
 SELECT count(*) INTO n FROM public.artae_messages m
 LEFT JOIN public.artae_message_reads r ON r.message_id=m.id AND r.user_id='11111111-1111-4111-8111-111111111111'
 WHERE m.deleted_at IS NULL AND m.author_id<>'11111111-1111-4111-8111-111111111111'
 AND m.created_at>(SELECT before_created_at FROM public.artae_read_baselines WHERE user_id='11111111-1111-4111-8111-111111111111')
 AND r.message_id IS NULL;
 IF n<>1 THEN RAISE EXCEPTION 'Alice should have 1 unread, has %',n; END IF;
END
$test$;
SET ROLE artae_app;
INSERT INTO public.artae_message_reads(user_id,message_id,read_at) VALUES
 ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',3000)
 ON CONFLICT(user_id,message_id) DO NOTHING;
INSERT INTO public.artae_message_reads(user_id,message_id,read_at) VALUES
 ('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',3000)
 ON CONFLICT(user_id,message_id) DO NOTHING;
RESET ROLE;
DO $test$
DECLARE n int;
BEGIN
 SELECT count(*) INTO n FROM public.artae_message_reads;
 IF n<>1 THEN RAISE EXCEPTION 'Read receipts are not idempotent: %',n; END IF;
END
$test$;
