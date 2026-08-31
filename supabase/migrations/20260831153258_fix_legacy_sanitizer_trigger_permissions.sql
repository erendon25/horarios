-- The trigger is invoked by authenticated table writes, but its recursive
-- sanitizer intentionally remains private. Run only the trigger wrapper with
-- its owner's privileges instead of exposing the helper through the Data API.
alter function private.sanitize_legacy_data_before_write()
  security definer;

alter function private.sanitize_legacy_data_before_write()
  set search_path = '';

revoke all on function private.sanitize_legacy_data_before_write()
  from public, anon, authenticated;

revoke all on function private.sanitize_legacy_identity_payload(jsonb)
  from public, anon, authenticated;
