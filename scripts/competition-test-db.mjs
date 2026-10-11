import { readFile } from "node:fs/promises";
import { addProfilePhotoTestSchema } from './profile-photo-test-schema.mjs';
export async function createCompetitionTestDb({ includeSheetout = true, includeObservable = true, includeRecognition = true, includeTimeScoring = true } = {}) {
  const { PGlite } = await import(
    process.env.PGLITE_MODULE || "@electric-sql/pglite"
  );
  const db = new PGlite();
  await db.exec(`
 create role anon; create role authenticated; create schema auth; create schema private;
 create type public.app_role as enum ('superadmin','admin','trainer','collaborator');
 create type public.record_status as enum ('active','inactive','pending');
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.stores(id uuid primary key default gen_random_uuid(),is_active boolean default true);
create table public.staff_profiles(id uuid primary key default gen_random_uuid(),store_id uuid references public.stores,first_name text,last_name text,position text default 'COLABORADOR',status public.record_status default 'active',cessation_date date,is_trainee boolean default false,training_end_date date,training_scores jsonb default '{}',position_abilities jsonb default '[]');
 create table public.user_profiles(id uuid primary key references auth.users,store_id uuid references public.stores,staff_profile_id uuid references public.staff_profiles,role public.app_role,status public.record_status default 'active');
 create table public.audit_log(id bigint generated always as identity primary key,actor_id uuid references auth.users,store_id uuid references public.stores,table_name text not null,record_id text,action text check(action in ('INSERT','UPDATE','DELETE','IMPORT')),old_data jsonb,new_data jsonb,created_at timestamptz default now());
 create function private.current_user_role() returns public.app_role language sql security definer set search_path='' as $$select role from public.user_profiles where id=auth.uid() and status='active'$$;
 create function private.current_user_store_id() returns uuid language sql security definer set search_path='' as $$select store_id from public.user_profiles where id=auth.uid() and status='active'$$;
 create function private.current_staff_profile_id() returns uuid language sql security definer set search_path='' as $$select staff_profile_id from public.user_profiles where id=auth.uid() and status='active'$$;
 grant usage on schema private,auth to authenticated;
 grant execute on all functions in schema private,auth to authenticated;
`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260927053023_speed_quality_competition.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260927053329_competition_foreign_key_indexes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260927055506_competition_staff_eligibility.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260930000609_competition_registration_and_draw.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260930203005_competition_publication.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260930210634_competition_current_trainers.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260930212759_competition_active_staff_only.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260930213448_competition_fair_trainer_points.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260930214519_competition_employment_registration_status.sql', import.meta.url), 'utf8'),
  );
  await db.exec(
    await readFile(new URL('../supabase/migrations/20260930220620_competition_self_selected_areas.sql', import.meta.url), 'utf8'),
  );
  if (includeSheetout) await db.exec(
    await readFile(new URL('../supabase/migrations/20260930221302_competition_sheetout_area.sql', import.meta.url), 'utf8'),
  );
  if (includeObservable) await db.exec(
    await readFile(new URL('../supabase/migrations/20260930231033_competition_observable_rubrics.sql', import.meta.url), 'utf8'),
  );
  await addProfilePhotoTestSchema(db);
  if (includeRecognition) await db.exec(await readFile(new URL('../supabase/migrations/20261011063222_competition_profile_recognition.sql',import.meta.url),'utf8'));
  if (includeObservable && includeTimeScoring) await db.exec(
    await readFile(new URL('../supabase/migrations/20261011070918_score_time_in_all_competition_areas.sql', import.meta.url), 'utf8'),
  );
  await db.exec(await readFile(new URL('../supabase/migrations/20261011131719_competition_leaders_followup_only.sql', import.meta.url), 'utf8'));
  return db;
}
