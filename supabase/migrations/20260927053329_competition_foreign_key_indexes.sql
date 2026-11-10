-- Cover domain FK lookups and contest filters identified by Supabase advisors.
create index competition_entries_contest_idx on public.competition_entries(competition_id);
create index competition_entries_member_idx on public.competition_entries(member_id,competition_id);
create index competition_scores_evaluation_idx on public.competition_evaluation_scores(evaluation_id,competition_id);
create index competition_evaluations_entry_idx on public.competition_evaluations(entry_id,competition_id);
create index competition_evaluations_evaluator_idx on public.competition_evaluations(evaluated_by);
create index competition_evaluations_starter_idx on public.competition_evaluations(started_by);
create index competition_rubric_area_idx on public.competition_rubric_items(area_id,competition_id);
create index competition_rubric_contest_idx on public.competition_rubric_items(competition_id);
create index competition_events_actor_idx on public.competition_timer_events(performed_by);
create index competition_creator_idx on public.competitions(created_by);
