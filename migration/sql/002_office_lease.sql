-- ART-AE M1. EMPTY ISOLATED TEST DATABASE ONLY.
-- Recreates office lease RPC semantics; depends on 001_clean_schema.
-- Runtime privileges will be granted later to a dedicated app role.
BEGIN;
CREATE OR REPLACE FUNCTION public.artae_office_lease(
 p_action text,p_project uuid,p_path text,p_token uuid,p_user uuid,p_name text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $body$
DECLARE l public.artae_office_locks%ROWTYPE;
BEGIN
 IF p_project IS NULL OR p_path IS NULL OR length(p_path)=0 OR length(p_path)>500
  OR (lower(p_path) NOT LIKE '%.docx' AND lower(p_path) NOT LIKE '%.xlsx')
  OR p_token IS NULL OR p_user IS NULL THEN
  RAISE EXCEPTION 'Invalid lease request' USING ERRCODE='22023';
 END IF;
 IF p_action='acquire' THEN
  INSERT INTO public.artae_office_locks(project_id,file_path,token,owner_user_id,owner_name,expires_at)
  VALUES(p_project,p_path,p_token,p_user,left(coalesce(p_name,''),80),now()+interval '120 seconds')
  ON CONFLICT(project_id,file_path) DO UPDATE
  SET token=EXCLUDED.token,owner_user_id=EXCLUDED.owner_user_id,
      owner_name=EXCLUDED.owner_name,expires_at=EXCLUDED.expires_at
  WHERE artae_office_locks.expires_at<=now()
  RETURNING * INTO l;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'expiresAt',l.expires_at); END IF;
  SELECT * INTO l FROM public.artae_office_locks WHERE project_id=p_project AND file_path=p_path;
  RETURN jsonb_build_object('ok',false,'holder',coalesce(l.owner_name,'Другой участник'),'expiresAt',l.expires_at);
 ELSIF p_action='renew' THEN
  UPDATE public.artae_office_locks SET expires_at=now()+interval '120 seconds'
  WHERE project_id=p_project AND file_path=p_path AND token=p_token AND owner_user_id=p_user AND expires_at>now()
  RETURNING * INTO l;
  RETURN jsonb_build_object('ok',FOUND,'expiresAt',l.expires_at);
 ELSIF p_action='release' THEN
  DELETE FROM public.artae_office_locks
  WHERE project_id=p_project AND file_path=p_path AND token=p_token AND owner_user_id=p_user;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_action='verify' THEN
  SELECT * INTO l FROM public.artae_office_locks
  WHERE project_id=p_project AND file_path=p_path AND token=p_token AND owner_user_id=p_user AND expires_at>now();
  RETURN jsonb_build_object('ok',FOUND);
 ELSIF p_action='status' THEN
  SELECT * INTO l FROM public.artae_office_locks
  WHERE project_id=p_project AND file_path=p_path AND expires_at>now();
  RETURN jsonb_build_object('busy',FOUND,'holder',CASE WHEN FOUND THEN l.owner_name ELSE NULL END);
 ELSE
  RAISE EXCEPTION 'Invalid lease action' USING ERRCODE='22023';
 END IF;
END
$body$;
REVOKE ALL ON FUNCTION public.artae_office_lease(text,uuid,text,uuid,uuid,text) FROM PUBLIC;
INSERT INTO public.artae_schema_migrations(version) VALUES('002_office_lease');
COMMIT;
