// Stage 1 counters and read receipts; local PostgreSQL only.
import {query} from './postgres.mjs';

async function ensureReadBaseline(userId){
 // New users do not inherit old messages as unread.
 // Existing baselines are immutable.
 await query(
  'INSERT INTO public.artae_read_baselines(user_id,before_created_at) '+
  'SELECT $1,COALESCE(MAX(created_at),0) FROM public.artae_messages WHERE true '+
  'ON CONFLICT(user_id) DO NOTHING',[userId]);
}

export async function messageStats(userId){
 await ensureReadBaseline(userId);
 const {rows}=await query(
  'SELECT c.id,COUNT(m.id)::integer AS total, '+
  'COUNT(m.id) FILTER (WHERE m.author_id <> $1::uuid '+
  'AND m.created_at > b.before_created_at AND r.message_id IS NULL)::integer AS unread '+
  'FROM public.artae_conversations c '+
  'JOIN public.artae_projects p ON p.id=c.project_id AND p.deleted_at IS NULL '+
  'JOIN public.artae_read_baselines b ON b.user_id=$1::uuid '+
  'LEFT JOIN public.artae_messages m ON m.conversation_id=c.id AND m.deleted_at IS NULL '+
  'LEFT JOIN public.artae_message_reads r ON r.user_id=$1::uuid AND r.message_id=m.id '+
  'WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY c.id',[userId]);
 return rows.map(r=>({id:r.id,total:Number(r.total),unread:Number(r.unread)}));
}

export async function markMessagesRead(userId,conversationId,messageIds){
 await ensureReadBaseline(userId);
 const {rows}=await query(
  'INSERT INTO public.artae_message_reads(user_id,message_id,read_at) '+
  'SELECT $1::uuid,m.id,$4::bigint FROM public.artae_messages m '+
  'JOIN public.artae_read_baselines b ON b.user_id=$1::uuid '+
  'WHERE m.conversation_id=$2::uuid AND m.id=ANY($3::uuid[]) '+
  'AND m.author_id <> $1::uuid AND m.deleted_at IS NULL '+
  'AND m.created_at > b.before_created_at '+
  'ON CONFLICT(user_id,message_id) DO NOTHING RETURNING message_id',
  [userId,conversationId,messageIds,Date.now()]);
 return {saved:rows.length};
}
