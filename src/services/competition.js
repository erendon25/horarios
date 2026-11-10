import { supabase } from "../lib/supabase/client";
import { profilePhotoUrls } from './profilePhoto';

export async function hasPublishedCompetition(storeId) {
  const { data, error } = await supabase
    .from("competitions")
    .select("id")
    .eq("store_id", storeId)
    .not("published_at", "is", null)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

export async function competitionCommand(competitionId, action, payload = {}) {
  const { data, error } = await supabase.rpc("competition_command", {
    p_competition_id: competitionId || null,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw error;
  return data;
}

export async function readAll(table, filters = {}, order = "id") {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase
      .from(table)
      .select("*")
      .range(offset, offset + 999);
    for (const column of Array.isArray(order) ? order : [order])
      query = query.order(column);
    for (const [key, value] of Object.entries(filters))
      query = query.eq(key, value);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export async function readCompetition(id, admin = false) {
  const tables = {
    teams: "competition_current_teams",
    members: "competition_team_members",
    areas: "competition_areas",
    phases: "competition_phases",
    rubric: "competition_rubric_items",
    entries: "competition_fixture_view",
    evaluations: "competition_evaluations",
    scores: "competition_evaluation_scores",
    individual: "competition_individual_ranking",
    teamRanking: "competition_team_ranking",
    trainerRanking: "competition_trainer_ranking",
  };
  const result = await Promise.all(
    Object.entries(tables).map(async ([key, table]) => [
      key,
      await readAll(
        table,
        { competition_id: id },
        key === "individual"
          ? "member_id"
          : key === "teamRanking" || key === "trainerRanking"
            ? "team_id"
            : key === "scores"
              ? ["evaluation_id", "rubric_item_id"]
              : "id",
      ),
    ]),
  );
  const bundle = Object.fromEntries(result);
  // Photos are optional; a storage failure must not block the competition.
  const photos = await profilePhotoUrls(supabase,bundle.entries.map(e=>e.staff_id)).catch(()=>new Map());
  bundle.entries = bundle.entries.map(entry=>({...entry,photo_url:photos.get(entry.staff_id)||null}));
  const currentTeams = new Map(bundle.teams.map((team) => [team.id, team]));
  for (const key of ['entries', 'individual', 'teamRanking', 'trainerRanking']) {
    bundle[key] = bundle[key].map((row) => {
      const team = currentTeams.get(row.team_id);
      return { ...row, trainer_staff_id: team?.trainer_staff_id ?? null,
        trainer_name: team?.trainer_name ?? 'Sin trainer vigente',
        trainer_eligible: team?.trainer_eligible === true };
    });
  }
  bundle.areas.sort((a, b) => a.sort_order - b.sort_order);
  bundle.phases.sort((a, b) => a.phase_order - b.phase_order);
  bundle.individual.sort(
    (a, b) =>
      Number(b.points) - Number(a.points) ||
      Number(b.average_quality) - Number(a.average_quality),
  );
  bundle.teamRanking.sort((a, b) => Number(b.points) - Number(a.points));
  bundle.trainerRanking.sort((a, b) => Number(b.points) - Number(a.points));
  bundle.audit = admin
    ? await readAll(
        "audit_log",
        { table_name: "competitions", record_id: id },
        ["created_at", "id"],
      )
    : [];
  return bundle;
}

export async function synchronizeCompetitionClock() {
  const before = performance.now();
  const { data, error } = await supabase.rpc("competition_server_time");
  const after = performance.now();
  if (error) throw error;
  return {
    serverMs: Date.parse(data) + (after - before) / 2,
    monotonicMs: after,
    uncertaintyMs: (after - before) / 2,
  };
}

export function subscribeCompetition(id, onChange, onStatus) {
  const channel = supabase
    .channel(`competition:${id}:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "competitions",
        filter: `id=eq.${id}`,
      },
      onChange,
    )
    .subscribe(onStatus);
  return () => {
    void supabase.removeChannel(channel);
  };
}
