-- The cessation date is inclusive: only later days are discarded.
create function private.discard_shift_after_cessation() returns trigger
language plpgsql security definer set search_path='' as $$
declare cutoff date;
begin
 select s.cessation_date into cutoff from public.schedule_weeks w
 join public.staff_profiles s on s.id=w.staff_id
 where w.id=new.schedule_week_id for share of s;
 if cutoff is not null and new.work_date>cutoff then return null; end if;
 return new;
end $$;
revoke all on function private.discard_shift_after_cessation() from public,anon,authenticated;
create trigger schedule_shifts_discard_after_cessation before insert or update
on public.schedule_shifts for each row execute function private.discard_shift_after_cessation();

create function private.remove_shifts_after_cessation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.cessation_date is not null then
   delete from public.schedule_shifts sh using public.schedule_weeks w
   where sh.schedule_week_id=w.id and w.staff_id=new.id and sh.work_date>new.cessation_date;
 end if;
 return new;
end $$;
revoke all on function private.remove_shifts_after_cessation() from public,anon,authenticated;
create trigger staff_profiles_remove_shifts_after_cessation after insert or update of cessation_date
on public.staff_profiles for each row execute function private.remove_shifts_after_cessation();

delete from public.schedule_shifts sh using public.schedule_weeks w,public.staff_profiles s
where sh.schedule_week_id=w.id and s.id=w.staff_id and sh.work_date>s.cessation_date
and s.store_id='50294ced-5b38-5b06-a54e-515d6c94a513';
