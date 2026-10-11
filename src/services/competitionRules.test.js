import test from "node:test";
import assert from "node:assert/strict";
import {
  competitionLeaderRanking,
  evaluationOutcome,
  formatCompetitionTime,
  timerElapsed,
  matchCompetitionStaff,
  buildCompetitionTeamTemplate,
  competitionStaffUnavailable,
} from "./competitionRules.js";
test('three current trainers prepare exactly three teams without fixed names', () => {
  const trainers = ['a', 'b', 'c'].map(id => ({ id, first_name: id, position: 'ENTRENADOR', status: 'active' }));
  const staff = [...trainers,
    { id: 'former', position: 'COLABORADOR', role: 'trainer', status: 'active' },
    { id: 'inactive', position: 'ENTRENADOR', status: 'inactive' },
    { id: 'ceased', position: 'ENTRENADOR', status: 'active', cessation_date: '2000-01-01' }];
  assert.deepEqual(buildCompetitionTeamTemplate(staff), trainers.map((trainer, index) => ({
    name: `Equipo ${index + 1}`, trainer_staff_id: trainer.id, staff_ids: [],
  })));
  assert.equal(buildCompetitionTeamTemplate(staff.slice(1)).length, 2);
  assert.deepEqual(buildCompetitionTeamTemplate([]), []);
});
test("leaders rank by average including zero scorers, rather than team total", () => {
  const teams = [
    { team_id: "a", members: 6, points: 60 },
    { team_id: "b", members: 4, points: 44 },
    { team_id: "c", members: 0, points: 0 },
    { team_id: "d", members: 2, points: 20 },
  ];
  const ranking = competitionLeaderRanking(teams);
  assert.deepEqual(ranking.map((r) => r.team_id), ["b", "a", "d", "c"]);
  assert.deepEqual(ranking.map((r) => r.average_points), [11, 10, 10, 0]);
  assert.equal(teams[0].average_points, undefined);
  assert.equal(competitionLeaderRanking([{ team_id: "z", members: "6", points: "14" }])[0].average_points, 14 / 6);
});
test("time formatting retains centiseconds and supports long durations", () => {
  assert.equal(formatCompetitionTime(42370), "00:42.37");
  assert.equal(formatCompetitionTime(60005), "01:00.00");
  assert.equal(formatCompetitionTime(3600000), "60:00.00");
});
test("quality, time and critical error are independent requirements", () => {
  assert.equal(evaluationOutcome(89, 30000, 90, 45000, false).approved, false);
  assert.equal(evaluationOutcome(90, 45000, 90, 45000, false).approved, true);
  assert.equal(evaluationOutcome(100, 45001, 90, 45000, false).approved, false);
  assert.equal(evaluationOutcome(101, 30000, 90, 45000, false).approved, false);
  assert.equal(evaluationOutcome(99, 30000, 90, 45000, true).approved, false);
});
test("reload uses server anchor; paused and stopped clocks do not drift", () => {
  const e = {
    started_at: "2026-09-26T14:30:00Z",
    timer_status: "running",
    paused_duration_ms: 1000,
  };
  const clock = {
    serverMs: Date.parse("2026-09-26T14:30:37Z"),
    monotonicMs: 500,
  };
  assert.equal(timerElapsed(e, clock, 1000), 36500);
  assert.equal(
    timerElapsed(
      { ...e, timer_status: "paused", paused_at: "2026-09-26T14:30:20Z" },
      clock,
      9999999,
    ),
    19000,
  );
  assert.equal(
    timerElapsed(
      { ...e, timer_status: "stopped", duration_ms: 42370 },
      clock,
      9999999,
    ),
    42370,
  );
});
test("name matching suggests only unique normalized names", () => {
  const staff = [{ id: "a", first_name: "Kiara", last_name: "Nuñez", status: "active" }];
  assert.equal(matchCompetitionStaff(" KIARA NUNEZ ", staff), "a");
  assert.equal(
    matchCompetitionStaff("Kiara Nuñez", [...staff, { ...staff[0], id: "b" }]),
    "",
  );
  assert.equal(matchCompetitionStaff("Kiara Torres", staff), "");
});
test('team selection uses employment, independent of pending registration, respecting the final day', () => {
  const today = '2026-09-30';
  const active = { status: 'active' };
  assert.equal(competitionStaffUnavailable(active, today), '');
  assert.equal(competitionStaffUnavailable({ status: 'pending' }, today), '');
  assert.ok(competitionStaffUnavailable({ status: 'pending', is_trainee: true, training_end_date: '2026-09-29' }, today));
  assert.ok(competitionStaffUnavailable({ status: 'inactive' }, today));
  assert.ok(competitionStaffUnavailable({}, today));
  assert.ok(competitionStaffUnavailable({ ...active, cessation_date: '2026-09-29' }, today));
  assert.ok(competitionStaffUnavailable({ ...active, is_trainee: true, training_end_date: '2026-09-29' }, today));
  assert.equal(competitionStaffUnavailable({ ...active, is_trainee: true, training_end_date: today }, today), '');
  assert.equal(competitionStaffUnavailable({ ...active, is_trainee: true, training_end_date: '2026-10-01' }, today), '');
  assert.equal(competitionStaffUnavailable({ ...active, is_trainee: false, training_end_date: '2026-09-29' }, today), '');
});
