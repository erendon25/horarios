import React, { useEffect, useState } from "react";
import {
  evaluationOutcome,
  formatCompetitionTime,
  timerElapsed,
} from "../../services/competitionRules";

export function EvaluationSummary({
  evaluation,
  entry,
  quality,
  critical,
  reason,
}) {
  const outcome = evaluationOutcome(
    quality,
    evaluation.duration_ms,
    evaluation.minimum_quality,
    evaluation.maximum_duration_ms,
    critical,
  );
  return (
    <>
      <dl className="summary">
        {[
          ["Colaborador", entry.display_name],
          ["Equipo", entry.team_name],
          ["Trainer", entry.trainer_name],
          ["Área", entry.area_name],
          [
            "Calidad",
            `${quality} / 100 (mínimo ${evaluation.minimum_quality})`,
          ],
          ["Tiempo", formatCompetitionTime(evaluation.duration_ms)],
          ["Máximo", formatCompetitionTime(evaluation.maximum_duration_ms)],
          ["Error crítico", critical ? `Sí · ${reason}` : "No"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={`notice ${outcome.approved ? "success" : "error"}`}>
        <strong>{outcome.approved ? "APROBADO" : "NO APROBADO"}</strong>
        <br />
        {outcome.reason}
      </p>
    </>
  );
}

function ActiveEvaluation({
  evaluation,
  entry,
  data,
  clock,
  execute,
  selectEvaluation,
  stale,
}) {
  const rubric = data.scores
    .filter((s) => s.evaluation_id === evaluation.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const [scores, setScores] = useState(() =>
    Object.fromEntries(rubric.map((r) => [r.rubric_item_id, r.score ?? ""])),
  );
  const [critical, setCritical] = useState(evaluation.critical_error);
  const [reason, setReason] = useState(evaluation.critical_error_reason || "");
  const [confirm, setConfirm] = useState(false);
  const [tick, setTick] = useState(performance.now());
  useEffect(() => {
    if (evaluation.timer_status !== "running") return;
    const interval = setInterval(() => setTick(performance.now()), 30);
    return () => clearInterval(interval);
  }, [evaluation.timer_status]);
  const total =
    Math.round(
      rubric.reduce(
        (sum, r) => sum + Number(scores[r.rubric_item_id] || 0),
        0,
      ) * 100,
    ) / 100;
  const valid =
    rubric.length > 0 &&
    rubric.every(
      (r) =>
        scores[r.rubric_item_id] !== "" &&
        Number.isFinite(Number(scores[r.rubric_item_id])) &&
        Number(scores[r.rubric_item_id]) >= 0 &&
        Number(scores[r.rubric_item_id]) <= Number(r.max_score),
    ) &&
    (!critical || reason.trim());
  const status = evaluation.timer_status;
  const terminal = ["saved", "cancelled", "void"].includes(status);
  const timerAction = (action) =>
    execute(action, { evaluation_id: evaluation.id });
  const reset = async () => {
    const why = window.prompt(
      entry.eligible
        ? "Motivo obligatorio para cancelar este intento y reiniciar:"
        : "Motivo obligatorio para cancelar el intento de una persona con cese efectivo:",
    );
    if (!why?.trim()) return;
    if (
      await execute("cancel", { evaluation_id: evaluation.id, reason: why })
    ) {
      if (entry.eligible) {
        const next = await execute("prepare", { entry_id: entry.id });
        if (next) selectEvaluation(next.id);
      } else {
        selectEvaluation(null);
      }
    }
  };
  return (
    <section className="card">
      <div className="actions">
        <span className="badge">{entry.area_name}</span>
        <span className="badge">
          {data.phases.find((p) => p.id === evaluation.phase_id)?.name}
        </span>
        <span className="badge">
          Intento {evaluation.attempt_number}
          {evaluation.is_tiebreaker
            ? ` · Desempate ${evaluation.tiebreak_round}`
            : ""}
        </span>
      </div>
      <h2>{entry.display_name}</h2>
      <p>
        {entry.team_name} · Trainer: {entry.trainer_name}
      </p>
      {!entry.eligible && !terminal && (
        <p className="notice error">
          Cese efectivo o perfil inactivo: detenga y cancele este intento. No se
          puede iniciar, reanudar ni guardar.
        </p>
      )}
      <div className="timer-panel">
        <p>
          {
            {
              pending: "LISTO PARA INICIAR",
              running: "EN CURSO",
              paused: "PAUSADO",
              stopped: "TIEMPO REGISTRADO",
              saved: "EVALUACIÓN GUARDADA",
              cancelled: "CANCELADO",
              void: "INVALIDADO",
            }[status]
          }
        </p>
        <div className="timer" aria-label="Cronómetro" role="timer">
          {clock || evaluation.duration_ms != null
            ? formatCompetitionTime(timerElapsed(evaluation, clock, tick))
            : "--:--.--"}
        </div>
        <p>Máximo: {formatCompetitionTime(evaluation.maximum_duration_ms)}</p>
        <div className="actions">
          {status === "pending" && (
            <button
              className="primary"
              disabled={stale || !clock || !entry.eligible}
              onClick={() => timerAction("start")}
            >
              INICIAR
            </button>
          )}
          {status === "running" && (
            <button
              className="danger"
              disabled={stale}
              onClick={() => timerAction("stop")}
            >
              DETENER
            </button>
          )}
          {status === "running" && evaluation.allow_pause && (
            <button
              disabled={stale || !entry.eligible}
              onClick={() => timerAction("pause")}
            >
              PAUSAR
            </button>
          )}
          {status === "paused" && (
            <button
              className="primary"
              disabled={stale || !entry.eligible}
              onClick={() => timerAction("resume")}
            >
              REANUDAR
            </button>
          )}
          {!terminal && (
            <button disabled={stale} onClick={reset}>
              REINICIAR
            </button>
          )}
        </div>
        <p style={{ color: "#d3d0cb", fontSize: 12 }}>
          Hora sincronizada con PostgreSQL. La cifra definitiva se registra al
          recibir DETENER en el servidor.
        </p>
      </div>
      {stale && (
        <p className="notice error">
          No hay confirmación reciente del servidor. El cronómetro puede seguir
          activo; reconecte y actualice antes de operar.
        </p>
      )}
      <h3>Rúbrica de calidad</h3>
      <fieldset disabled={terminal || stale || !entry.eligible}>
        {rubric.map((r) => (
          <label key={r.rubric_item_id} className="score-row">
            <span>
              {r.label}
              <br />
              <small className="muted">Máximo: {r.max_score}</small>
            </span>
            <input
              aria-label={r.label}
              type="number"
              min="0"
              max={r.max_score}
              step="0.01"
              required
              value={scores[r.rubric_item_id] ?? ""}
              onChange={(e) =>
                setScores((v) => ({ ...v, [r.rubric_item_id]: e.target.value }))
              }
            />
          </label>
        ))}
        <p className="stat">
          {total} <small className="muted">/ 100</small>
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={critical}
            onChange={(e) => setCritical(e.target.checked)}
          />
          ERROR CRÍTICO
        </label>
        {critical && (
          <label>
            Motivo obligatorio
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
            />
          </label>
        )}
      </fieldset>
      {status === "stopped" && (
        <>
          <EvaluationSummary
            {...{ evaluation, entry, quality: total, critical, reason }}
          />
          <button
            className="primary"
            disabled={!valid || stale || !entry.eligible}
            onClick={() => setConfirm(true)}
          >
            GUARDAR EVALUACIÓN
          </button>
        </>
      )}
      {status === "saved" && (
        <p className={`notice ${evaluation.approved ? "success" : "error"}`}>
          {evaluation.approved ? "APROBADO" : "NO APROBADO"} ·{" "}
          {evaluation.quality_score}/100 · +{evaluation.points_awarded} puntos.
          Resultado confirmado por PostgreSQL.
        </p>
      )}
      {confirm && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar evaluación"
        >
          <div className="modal">
            <h2>Confirmar evaluación</h2>
            <p>{data.phases.find((p) => p.id === evaluation.phase_id)?.name}</p>
            <EvaluationSummary
              {...{ evaluation, entry, quality: total, critical, reason }}
            />
            <div className="actions">
              <button onClick={() => setConfirm(false)}>
                Volver a revisar
              </button>
              <button
                className="primary"
                disabled={!valid || stale || !entry.eligible}
                onClick={async () => {
                  const result = await execute("finalize", {
                    evaluation_id: evaluation.id,
                    scores,
                    critical_error: critical,
                    reason: critical ? reason : null,
                  });
                  if (result) setConfirm(false);
                }}
              >
                Confirmar y guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function CompetitionEvaluation({
  data,
  contest,
  clock,
  execute,
  evaluationId,
  selectEvaluation,
  guard,
  stale,
}) {
  const selected = data.evaluations.find((e) => e.id === evaluationId);
  const selectedEntry = data.entries.find((e) => e.id === selected?.entry_id);
  const [areaId, setAreaId] = useState(
    selectedEntry?.area_id || data.areas.find((a) => a.active)?.id || "",
  );
  const [phaseId, setPhaseId] = useState(
    selected?.phase_id || data.phases.find((p) => p.active)?.id || "",
  );
  const [entryId, setEntryId] = useState("");
  const open = data.evaluations.filter((e) =>
    ["pending", "running", "paused", "stopped"].includes(e.timer_status),
  );
  const eligible = data.entries.filter(
    (e) =>
      e.area_id === areaId &&
      e.current_phase_id === phaseId &&
      e.eligible &&
      (e.status === "active" || e.tiebreak_candidate),
  ).sort((a, b) => (a.seed_order ?? Infinity) - (b.seed_order ?? Infinity));
  return (
    <>
      <h2>Evaluar velocidad y calidad</h2>
      {contest.status !== "active" && (
        <p className="notice">
          Active el concurso desde Configuración para evaluar.
        </p>
      )}
      {open.length > 0 && (
        <section className="card">
          <h3>Intentos pendientes / en curso</h3>
          <div className="actions">
            {open.map((e) => (
              <button
                key={e.id}
                onClick={() => guard(() => selectEvaluation(e.id), e.id)}
              >
                {data.entries.find((x) => x.id === e.entry_id)?.display_name} ·{" "}
                {e.timer_status}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="card">
        <div className="form">
          <label>
            Área
            <select
              value={areaId}
              onChange={(e) => {
                setAreaId(e.target.value);
                setEntryId("");
              }}
            >
              {data.areas
                .filter((a) => a.active)
                .map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.name}
                    {a.status === "tiebreak_required" ? " · Desempate" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Fase
            <select
              value={phaseId}
              onChange={(e) => {
                setPhaseId(e.target.value);
                setEntryId("");
              }}
            >
              {data.phases
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Colaborador
            <select
              value={entryId}
              onChange={(e) => setEntryId(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {eligible.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.display_name} · {e.team_name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={!entryId || contest.status !== "active" || stale}
            onClick={() =>
              guard(async () => {
                const next = await execute("prepare", { entry_id: entryId });
                if (next) selectEvaluation(next.id);
              })
            }
          >
            Abrir evaluación
          </button>
        </div>
      </section>
      {selected && selectedEntry && (
        <ActiveEvaluation
          key={selected.id}
          evaluation={selected}
          entry={selectedEntry}
          {...{ data, clock, execute, selectEvaluation, stale }}
        />
      )}{" "}
      {!selected && (
        <p className="muted">
          Seleccione área, fase y colaborador para preparar el intento. Puede
          recuperar un intento abierto desde cualquier pestaña.
        </p>
      )}
    </>
  );
}
