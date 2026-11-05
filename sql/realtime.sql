-- ART-AE: private event channels. No user message text is broadcast.
DROP POLICY IF EXISTS "artae_private_receive" ON realtime.messages;
CREATE POLICY "artae_private_receive" ON realtime.messages FOR SELECT TO authenticated
USING (
 extension = 'broadcast'
 AND (auth.jwt() ->> 'artae') = '1'
 AND realtime.topic() = ('artae:' || (auth.jwt() ->> 'artae_convo'))
);
CREATE OR REPLACE FUNCTION public.artae_emit_message_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM realtime.send(
   jsonb_build_object('id', NEW.id::text),
   'changed',
   'artae:' || NEW.conversation_id::text,
   true
 );
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.artae_emit_message_change() FROM PUBLIC;
DROP TRIGGER IF EXISTS artae_message_changed ON public.artae_messages;
CREATE TRIGGER artae_message_changed
AFTER INSERT OR UPDATE OF body, edited_at, deleted_at ON public.artae_messages
FOR EACH ROW EXECUTE FUNCTION public.artae_emit_message_change();
