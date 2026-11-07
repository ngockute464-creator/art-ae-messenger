DO $check$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.artae_messages WHERE deleted_at IS NOT NULL AND body<>'';
 IF n<>0 THEN RAISE EXCEPTION 'Deleted message texts remain: %',n; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.artae_messages'::regclass
  AND conname='artae_deleted_message_has_no_body' AND convalidated)
 THEN RAISE EXCEPTION 'Deletion invariant missing'; END IF;
END $check$;
DO $negative$
BEGIN
 BEGIN
  UPDATE public.artae_messages SET deleted_at=5000 WHERE id='66666666-6666-4666-8666-666666666666';
  RAISE EXCEPTION 'Invariant permitted nonempty deleted body';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $negative$;
