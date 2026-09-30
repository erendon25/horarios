// Real PostgreSQL execution via PGlite, isolated fixtures; never touches production.
// PGLITE_MODULE may point to an installed @electric-sql/pglite module.
import assert from "node:assert/strict";
import { createCompetitionTestDb } from "./competition-test-db.mjs";
const db = await createCompetitionTestDb();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const scalar = async (sql, params = []) =>
  Object.values(await one(sql, params))[0];
const store = await scalar("insert into stores default values returning id");
const store2 = await scalar("insert into stores default values returning id");
const admin = await scalar(
  "insert into auth.users values(gen_random_uuid()) returning id",
);
const collab = await scalar(
  "insert into auth.users values(gen_random_uuid()) returning id",
);
const otherAdmin = await scalar(
  "insert into auth.users values(gen_random_uuid()) returning id",
);
await db.query(
  "insert into user_profiles(id,store_id,role) values($1,$4,'admin'),($2,$4,'collaborator'),($3,$5,'admin')",
  [admin, collab, otherAdmin, store, store2],
);
const login = async (id) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
};
const cmd = async (id, action, payload = {}) =>
  scalar("select public.competition_command($1,$2,$3::jsonb)", [
    id,
    action,
    JSON.stringify(payload),
  ]);
const fails = async (fn, pattern) => assert.rejects(fn, pattern);
await login(admin);
const c = await cmd(null, "create", { store_id: store });
assert.equal(
  await scalar("select count(*)::integer from competition_areas"),
  7,
);
assert.equal(
  await scalar("select count(*)::integer from competition_phases"),
  4,
);
await fails(
  () => cmd(null, "create", { store_id: store2 }),
  /Tienda no autorizada/,
);
await fails(
  () => db.exec("update competitions set name='hack'"),
  /permission denied/,
);
await db.exec("reset role");
const staff = [];
for (let i = 0; i < 9; i++)
  staff.push(
    await scalar(
      "insert into staff_profiles(store_id,first_name,last_name) values($1,$2,'Prueba') returning id",
      [store, `Persona ${i}`],
    ),
  );
await login(admin);
const team = await cmd(c.id, "team", {
  name: "Equipo 1",
  trainer_staff_id: staff[0],
});
const member = await cmd(c.id, "member", {
  team_id: team.id,
  staff_id: staff[1],
});
const m2 = await cmd(c.id, "member", { team_id: team.id, staff_id: staff[2] });
await fails(
  () => cmd(c.id, "member", { team_id: team.id, staff_id: staff[0] }),
  /trainer/,
);
const areas = (
  await db.query("select * from competition_areas order by sort_order")
).rows;
for (const a of areas)
  await cmd(c.id, "area", { ...a, maximum_duration_ms: 45000 });
const entry = await cmd(c.id, "entry", {
  member_id: member.id,
  area_id: areas[0].id,
});
await cmd(c.id, "entry", { member_id: member.id, area_id: areas[1].id });
await fails(
  () => cmd(c.id, "entry", { member_id: member.id, area_id: areas[2].id }),
  /Límite/,
);
await fails(
  () => cmd(c.id, "area", { ...areas[0], minimum_quality: 101 }),
  /check constraint/,
);
const otherEntry = await cmd(c.id, "entry", { member_id: m2.id, area_id: areas[0].id });
await cmd(c.id, "entry", { member_id: m2.id, area_id: areas[1].id });
await cmd(c.id, "status", { status: "active" });
await fails(() => cmd(c.id, "config", { team_size: 7 }), /borrador/);
let ev = await cmd(c.id, "prepare", { entry_id: entry.id });
assert.equal((await cmd(c.id, "prepare", { entry_id: entry.id })).id, ev.id);
ev = await cmd(c.id, "start", { evaluation_id: ev.id });
await fails(
  () => cmd(c.id, "start", { evaluation_id: ev.id }),
  /ya fue iniciado/,
);
await fails(() => cmd(c.id, "pause", { evaluation_id: ev.id }), /pausa/);
await new Promise((r) => setTimeout(r, 50));
const restored = await one(
  "select * from competition_evaluations where id=$1",
  [ev.id],
);
assert.equal(restored.timer_status, "running");
assert.equal(
  new Date(restored.started_at).getTime(),
  Date.parse(ev.started_at),
);
ev = await cmd(c.id, "stop", { evaluation_id: ev.id });
assert.ok(ev.duration_ms >= 40);
assert.ok(ev.duration_ms < 45000);
const scoresFor = async (id, total = 100) => {
  const rows = (
    await db.query(
      "select * from competition_evaluation_scores where evaluation_id=$1 order by sort_order",
      [id],
    )
  ).rows;
  return Object.fromEntries(
    rows.map((r, i) => [
      r.rubric_item_id,
      Number(r.max_score) - (i === 0 ? 100 - total : 0),
    ]),
  );
};
await fails(
  () => cmd(c.id, "finalize", { evaluation_id: ev.id, scores: {} }),
  /criterios/,
);
await fails(
  async () =>
    cmd(c.id, "finalize", {
      evaluation_id: ev.id,
      scores: await scoresFor(ev.id, 101),
    }),
  /check constraint/,
);
let result = await cmd(c.id, "finalize", {
  evaluation_id: ev.id,
  scores: await scoresFor(ev.id, 89),
});
assert.equal(result.approved, false);
assert.equal(result.points_awarded, 0);
await cmd(c.id, "reopen", {
  entry_id: entry.id,
  reason: "Nueva oportunidad documentada",
});
async function evaluate(entryId, total = 100, extra = {}) {
  let v = await cmd(c.id, "prepare", { entry_id: entryId });
  await cmd(c.id, "start", { evaluation_id: v.id });
  await cmd(c.id, "stop", { evaluation_id: v.id });
  return cmd(c.id, "finalize", {
    evaluation_id: v.id,
    scores: await scoresFor(v.id, total),
    ...extra,
  });
}
result = await evaluate(entry.id, 99, {
  critical_error: true,
  reason: "Manipulación insegura",
});
assert.equal(result.approved, false);
await cmd(c.id, "reopen", {
  entry_id: entry.id,
  reason: "Reintento autorizado",
});
result = await evaluate(entry.id, 90);
assert.equal(result.points_awarded, 1);
for (const points of [2, 3, 5]) {
  result = await evaluate(entry.id);
  assert.equal(result.points_awarded, points);
}
await evaluate(otherEntry.id, 0);
await cmd(c.id, "champion", { area_id: areas[0].id });
assert.equal(
  Number(
    await scalar(
      "select points from competition_individual_ranking where member_id=$1",
      [member.id],
    ),
  ),
  14,
);
await cmd(c.id, "finalize", { evaluation_id: result.id, scores: {} });
await cmd(c.id, "champion", { area_id: areas[0].id });
assert.equal(
  Number(
    await scalar(
      "select points from competition_team_ranking where team_id=$1",
      [team.id],
    ),
  ),
  14,
);
await cmd(c.id, "correct", {
  evaluation_id: result.id,
  reason: "Rectificación verificable",
});
assert.equal(
  Number(
    await scalar(
      "select points from competition_individual_ranking where member_id=$1",
      [member.id],
    ),
  ),
  6,
);
assert.equal(
  await scalar("select status from competition_entries where id=$1", [
    entry.id,
  ]),
  "active",
);
await login(collab);
assert.equal(await scalar("select count(*)::integer from competitions"), 1);
await fails(
  () => cmd(c.id, "start", { evaluation_id: ev.id }),
  /administradores/,
);
await fails(
  () => db.exec("delete from competition_evaluations"),
  /permission denied/,
);
await fails(
  () =>
    db.exec(
      "insert into competitions(store_id,name,created_by) values('" +
        store +
        "','hack','" +
        collab +
        "')",
    ),
  /permission denied/,
);
await login(otherAdmin);
assert.equal(
  await scalar("select count(*)::integer from competition_individual_ranking"),
  0,
);
await fails(
  () => cmd(c.id, "champion", { area_id: areas[0].id }),
  /Tienda no autorizada/,
);
await db.exec("reset role; set role anon");
await fails(() => db.exec("select * from competitions"), /permission denied/);
await fails(() => cmd(c.id, "config", {}), /permission denied/);
await login(admin);
assert.ok(
  Number(await scalar("select count(*) from competition_timer_events")) >= 12,
);
await db.exec("reset role");
assert.ok(
  Number(
    await scalar(
      "select count(*) from audit_log where table_name='competitions'",
    ),
  ) > 20,
);
// Independent final-only tournament exercises ties, retries, pause events and cancellation.
await login(admin);
const c2 = await cmd(null, "create", { store_id: store, name: "Desempates" });
await cmd(c2.id, "config", { allow_timer_pause: true });
const t2 = await cmd(c2.id, "team", {
  name: "Equipo único",
  trainer_staff_id: staff[0],
});
const t2Other = await cmd(c2.id, "team", { name: "Segundo equipo", trainer_staff_id: staff[8] });
const mm = [];
for (const [index, id] of staff.slice(1, 4).entries())
  mm.push(await cmd(c2.id, "member", { team_id: index < 2 ? t2.id : t2Other.id, staff_id: id }));
const aa = (
  await db.query(
    "select * from competition_areas where competition_id=$1 order by sort_order",
    [c2.id],
  )
).rows;
for (const ar of aa)
  await cmd(c2.id, "area", {
    ...ar,
    maximum_duration_ms: 45000,
    active: ar.id === aa[0].id,
  });
const pp = (
  await db.query("select * from competition_phases where competition_id=$1", [
    c2.id,
  ])
).rows;
for (const p of pp)
  await cmd(c2.id, "phase", { ...p, active: p.phase_order === 4 });
const xx = [];
for (const m of mm)
  xx.push(await cmd(c2.id, "entry", { member_id: m.id, area_id: aa[0].id }));
await cmd(c2.id, "status", { status: "active" });
let timer = await cmd(c2.id, "prepare", { entry_id: xx[0].id });
const starts = await Promise.allSettled([
  cmd(c2.id, "start", { evaluation_id: timer.id }),
  cmd(c2.id, "start", { evaluation_id: timer.id }),
]);
assert.equal(starts.filter((s) => s.status === "fulfilled").length, 1);
await cmd(c2.id, "pause", { evaluation_id: timer.id });
await new Promise((r) => setTimeout(r, 30));
await cmd(c2.id, "resume", { evaluation_id: timer.id });
timer = await cmd(c2.id, "stop", { evaluation_id: timer.id });
assert.ok(timer.paused_duration_ms >= 20);
await cmd(c2.id, "cancel", { evaluation_id: timer.id, reason: "Ensayo" });
await fails(
  () => cmd(c2.id, "finalize", { evaluation_id: timer.id, scores: {} }),
  /Detenga/,
);
async function final2(entryId, quality, duration = 42370) {
  const attempt = await cmd(c2.id, "prepare", { entry_id: entryId });
  await cmd(c2.id, "start", { evaluation_id: attempt.id });
  // Set an exact elapsed interval only as database owner in this isolated test.
  await db.exec("reset role");
  await db.query(
    "update competition_evaluations set started_at=clock_timestamp()-($2::text||' milliseconds')::interval where id=$1",
    [attempt.id, duration],
  );
  await login(admin);
  await cmd(c2.id, "stop", { evaluation_id: attempt.id });
  // Deterministic identical millisecond times are required to test the exact tie branch.
  await db.exec("reset role");
  await db.query(
    "update competition_evaluations set duration_ms=$2 where id=$1",
    [attempt.id, duration],
  );
  await login(admin);
  return cmd(c2.id, "finalize", {
    evaluation_id: attempt.id,
    scores: await scoresFor(attempt.id, quality),
  });
}
await final2(xx[0].id, 100);
await final2(xx[1].id, 100);
await fails(() => cmd(c2.id, "champion", { area_id: aa[0].id }), /Termine/);
assert.equal((await final2(xx[2].id, 100, 46000)).approved, false);
assert.equal(
  (await cmd(c2.id, "champion", { area_id: aa[0].id })).status,
  "tiebreak_required",
);
await fails(
  () => cmd(c2.id, "prepare", { entry_id: xx[2].id }),
  /no es evaluable/,
);
assert.equal((await final2(xx[0].id, 89)).points_awarded, 0);
await final2(xx[1].id, 89);
assert.equal(
  (await cmd(c2.id, "champion", { area_id: aa[0].id })).tiebreak_round,
  2,
);
await final2(xx[0].id, 99);
await final2(xx[1].id, 98);
await cmd(c2.id, "champion", { area_id: aa[0].id });
assert.equal(
  await scalar("select status from competition_entries where id=$1", [
    xx[0].id,
  ]),
  "champion",
);
assert.equal(
  Number(
    await scalar(
      "select points from competition_individual_ranking where member_id=$1",
      [mm[0].id],
    ),
  ),
  8,
);
// No duplicate score credits in either tiebreak round.
assert.equal(
  Number(
    await scalar(
      "select points from competition_team_ranking where team_id=$1",
      [t2.id],
    ),
  ),
  13,
);
await cmd(c2.id, "status", { status: "completed" });
await fails(
  () => cmd(c2.id, "prepare", { entry_id: xx[0].id }),
  /no está activo/,
);
const c3 = await cmd(null, "create", { store_id: store, name: "Plantilla" });
await cmd(c3.id, "roster", {
  teams: [
    { name: "A", trainer_staff_id: staff[0], staff_ids: [staff[1], staff[2]] },
    { name: "B", trainer_staff_id: staff[3], staff_ids: [staff[4]] },
  ],
});
assert.equal(
  await scalar(
    "select count(*)::integer from competition_team_members where competition_id=$1",
    [c3.id],
  ),
  3,
);
// A future cessation remains eligible through its Lima date. Removing it later
// restores eligibility in the original team; no membership is synthesized.
const c3Member = await one(
  "select id,team_id from competition_team_members where competition_id=$1 and staff_id=$2",
  [c3.id, staff[1]],
);
const c3Area = await scalar(
  "select id from competition_areas where competition_id=$1 order by sort_order limit 1",
  [c3.id],
);
await db.exec("reset role");
await db.query(
  "update staff_profiles set cessation_date=((clock_timestamp() at time zone 'America/Lima')::date+1) where id=$1",
  [staff[1]],
);
await login(admin);
assert.equal(
  await scalar("select private.competition_staff_eligible($1,$2)", [staff[1], c3.id]),
  true,
);
const c3Entry = await cmd(c3.id, "entry", { member_id: c3Member.id, area_id: c3Area });
const c3OtherMember = await scalar("select id from competition_team_members where competition_id=$1 and staff_id=$2", [c3.id, staff[2]]);
await cmd(c3.id, "entry", { member_id: c3OtherMember, area_id: c3Area });
await db.exec("reset role");
await db.query(
  "update competition_areas set maximum_duration_ms=60000 where competition_id=$1",
  [c3.id],
);
await login(admin);
await cmd(c3.id, "status", { status: "active" });
const c3Attempt = await cmd(c3.id, "prepare", { entry_id: c3Entry.id });
await db.exec("reset role");
await db.query(
  "update staff_profiles set cessation_date=(clock_timestamp() at time zone 'America/Lima')::date where id=$1",
  [staff[1]],
);
await login(admin);
assert.equal(
  await scalar("select private.competition_staff_eligible($1,$2)", [staff[1], c3.id]),
  true,
);
await db.exec("reset role");
await db.query(
  "update staff_profiles set cessation_date=((clock_timestamp() at time zone 'America/Lima')::date-1) where id=$1",
  [staff[1]],
);
await login(admin);
assert.equal(
  await scalar("select private.competition_staff_eligible($1,$2)", [staff[1], c3.id]),
  false,
);
assert.deepEqual(
  await one("select eligible,effective_status from competition_fixture_view where id=$1", [c3Entry.id]),
  { eligible: false, effective_status: "withdrawn" },
);
assert.equal(
  Number(await scalar("select points from competition_individual_ranking where member_id=$1", [mm[0].id])),
  8,
);
assert.equal(
  await scalar("select status from competition_entries where id=$1", [xx[0].id]),
  "champion",
);
await fails(() => cmd(c3.id, "prepare", { entry_id: c3Entry.id }), /cese efectivo/);
await fails(() => cmd(c3.id, "start", { evaluation_id: c3Attempt.id }), /cese efectivo/);
await cmd(c3.id, "cancel", { evaluation_id: c3Attempt.id, reason: "Cese efectivo" });
await db.exec("reset role");
await db.query("update staff_profiles set cessation_date=null where id=$1", [staff[1]]);
await login(admin);
assert.equal(
  await scalar("select private.competition_staff_eligible($1,$2)", [staff[1], c3.id]),
  true,
);
assert.deepEqual(
  await one("select eligible,effective_status from competition_fixture_view where id=$1", [c3Entry.id]),
  { eligible: true, effective_status: "active" },
);
assert.deepEqual(
  await one("select id,team_id from competition_team_members where id=$1", [c3Member.id]),
  c3Member,
);
assert.equal(
  await scalar("select count(*)::integer from competition_team_members where competition_id=$1", [c3.id]),
  3,
);
const restoredAttempt = await cmd(c3.id, "prepare", { entry_id: c3Entry.id });
await cmd(c3.id, "start", { evaluation_id: restoredAttempt.id });
await cmd(c3.id, "stop", { evaluation_id: restoredAttempt.id });
await db.exec("reset role");
await db.query("update staff_profiles set status='inactive' where id=$1", [staff[1]]);
await login(admin);
await fails(() => cmd(c3.id, "prepare", { entry_id: c3Entry.id }), /perfil inactivo/);
const restoredScores = await scoresFor(restoredAttempt.id, 100);
await fails(
  () => cmd(c3.id, "finalize", {
    evaluation_id: restoredAttempt.id,
    scores: restoredScores,
  }),
  /perfil inactivo/,
);
await cmd(c3.id, "cancel", { evaluation_id: restoredAttempt.id, reason: "Perfil inactivo" });
await db.exec("reset role");
await db.query("update staff_profiles set status='active' where id=$1", [staff[1]]);
await login(collab);
assert.deepEqual(
  await one("select eligible,effective_status from competition_fixture_view where id=$1", [c3Entry.id]),
  { eligible: true, effective_status: "active" },
);
console.log(
  "PASS: pause/resume, concurrent starts, exact ties, all-failed tiebreak, new round, ineligible candidate, no duplicated tiebreak points, overtime, roster;",
);
console.log(
  "PASS: migration, roles/RLS, store isolation, bounds, timer restore/double start/server stop, critical error, 89/90/101, points 14/idempotence, correction, audit.",
);
await db.close();
