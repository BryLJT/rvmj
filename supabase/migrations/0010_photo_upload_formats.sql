-- ============================================================================
-- 0010 — accept verified JPEG fallbacks for notable-hand photos
--
-- WebKit may substitute PNG when canvas WebP encoding is unavailable. The app now detects
-- that substitution and falls back to JPEG. Existing objects remain WebP, so the private
-- bucket accepts exactly those two formats while keeping its original size and privacy.
-- ============================================================================

begin;

do $$
declare
  v_updated integer;
begin
  update storage.buckets
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/webp', 'image/jpeg']
  where id = 'notable-photos';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'expected exactly one notable-photos bucket, updated %', v_updated;
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'notable-photos'
      and public = false
      and file_size_limit = 2097152
      and allowed_mime_types = array['image/webp', 'image/jpeg']
  ) then
    raise exception 'notable-photos bucket format expansion did not stick';
  end if;
end $$;

commit;
