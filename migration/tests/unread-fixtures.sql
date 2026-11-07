-- Seed historical data BEFORE applying 003_message_reads.sql.
INSERT INTO public.artae_users(id,name,role,key_hash) VALUES
 ('11111111-1111-4111-8111-111111111111','Alice','admin',repeat('a',64)),
 ('22222222-2222-4222-8222-222222222222','Bob','member',repeat('b',64));
INSERT INTO public.artae_projects(id,name,created_at) VALUES
 ('33333333-3333-4333-8333-333333333333','Project',100);
INSERT INTO public.artae_conversations(id,project_id,name,created_at) VALUES
 ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','Chat',100);
INSERT INTO public.artae_messages(id,conversation_id,author_id,author_name,body,created_at) VALUES
 ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Bob','Historical',1000);
