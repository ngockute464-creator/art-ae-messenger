-- Run only in disposable PostgreSQL 17 after migrations 001..004.
INSERT INTO public.artae_sessions(sid,user_id,generation,last_seen,created_at)
VALUES (repeat('b',64),'22222222-2222-4222-8222-222222222222',1,100000,100000);
INSERT INTO public.artae_push_subscriptions
(id,user_id,session_sid,endpoint,endpoint_hash,p256dh,auth_key,created_at,updated_at)
VALUES('88888888-8888-4888-8888-888888888888',
'22222222-2222-4222-8222-222222222222',repeat('b',64),
'https://web.push.apple.com/push/test-device',repeat('a',64),
repeat('A',87),repeat('B',22),100000,100000);
INSERT INTO public.artae_push_deliveries
(message_id,subscription_id,recipient_user_id,created_at,next_try_at)
VALUES('77777777-7777-4777-8777-777777777777',
'88888888-8888-4888-8888-888888888888',
'22222222-2222-4222-8222-222222222222',100001,100001)
ON CONFLICT DO NOTHING;
INSERT INTO public.artae_push_deliveries
(message_id,subscription_id,recipient_user_id,created_at,next_try_at)
VALUES('77777777-7777-4777-8777-777777777777',
'88888888-8888-4888-8888-888888888888',
'22222222-2222-4222-8222-222222222222',100001,100001)
ON CONFLICT DO NOTHING;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.artae_push_deliveries)<>1 THEN
  RAISE EXCEPTION 'Duplicate delivery';
 END IF;
END $$;
DELETE FROM public.artae_sessions WHERE sid=repeat('b',64);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.artae_push_subscriptions)
 OR EXISTS(SELECT 1 FROM public.artae_push_deliveries) THEN
  RAISE EXCEPTION 'Subscription/delivery survived session revocation';
 END IF;
END $$;
