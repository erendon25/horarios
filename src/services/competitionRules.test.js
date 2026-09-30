import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluationOutcome,
  formatCompetitionTime,
  timerElapsed,
  matchCompetitionStaff,
} from "./competitionRules.js";
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
  const staff = [{ id: "a", first_name: "Kiara", last_name: "Nuñez" }];
  assert.equal(matchCompetitionStaff(" KIARA NUNEZ ", staff), "a");
  assert.equal(
    matchCompetitionStaff("Kiara Nuñez", [...staff, { ...staff[0], id: "b" }]),
    "",
  );
  assert.equal(matchCompetitionStaff("Kiara Torres", staff), "");
});
