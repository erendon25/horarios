-- Firmas privadas de evaluaciones de capacitación.
-- La primera carpeta siempre es el UUID de tienda: <store_id>/<evaluation_id>/<type>.png

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-signatures', 'training-signatures', false, 1048576, array['image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists training_signatures_read on storage.objects;
create policy training_signatures_read on storage.objects for select to authenticated
using (
  bucket_id = 'training-signatures'
  and (
    (select private.current_user_role()) = 'superadmin'
    or (
      (storage.foldername(name))[1] = (select private.current_user_store_id())::text
      and (select private.current_user_role()) in ('admin', 'trainer')
    )
  )
);

drop policy if exists training_signatures_insert on storage.objects;
create policy training_signatures_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'training-signatures'
  and (
    (select private.current_user_role()) = 'superadmin'
    or (
      (storage.foldername(name))[1] = (select private.current_user_store_id())::text
      and (select private.current_user_role()) in ('admin', 'trainer')
    )
  )
);

drop policy if exists training_signatures_update on storage.objects;
create policy training_signatures_update on storage.objects for update to authenticated
using (
  bucket_id = 'training-signatures'
  and (
    (select private.current_user_role()) = 'superadmin'
    or (
      (storage.foldername(name))[1] = (select private.current_user_store_id())::text
      and (select private.current_user_role()) in ('admin', 'trainer')
    )
  )
)
with check (
  bucket_id = 'training-signatures'
  and (
    (select private.current_user_role()) = 'superadmin'
    or (
      (storage.foldername(name))[1] = (select private.current_user_store_id())::text
      and (select private.current_user_role()) in ('admin', 'trainer')
    )
  )
);

drop policy if exists training_signatures_delete on storage.objects;
create policy training_signatures_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'training-signatures'
  and (
    (select private.current_user_role()) = 'superadmin'
    or (
      (storage.foldername(name))[1] = (select private.current_user_store_id())::text
      and (select private.current_user_role()) in ('admin', 'trainer')
    )
  )
);
