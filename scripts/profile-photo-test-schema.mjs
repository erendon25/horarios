// Minimal Storage SQL contract for isolated RLS/RPC tests. File serving/upload
// limits are exercised by the QA transport, not by a real Supabase Storage server.
import {readFile} from 'node:fs/promises';
export async function addProfilePhotoTestSchema(db) {
  await db.exec(`
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema storage to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant execute on function storage.foldername(text) to authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261011130351_staff_profile_photos.sql',import.meta.url),'utf8'));
}
