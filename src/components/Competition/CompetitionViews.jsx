import React, { useState } from "react";
import CompetitionDraw from "./CompetitionDraw";
import {
  evaluationOutcome,
  formatCompetitionTime,
} from "../../services/competitionRules";
export const statusLabel = (status) =>
  ({
    active: "En competencia",
    eliminated: "Eliminado",
    finalist: "Finalista",
    withdrawn: "Fuera de competencia",
    champion: "Campeón",
    pending: "Pendiente",
    running: "En curso",
    paused: "Pausado",
    stopped: "Por guardar",
    saved: "Guardado",
    cancelled: "Cancelado",
    void: "Invalidado",
  })[status] || status;
const badgeClass = (status) =>
  status === "champion"
    ? "gold"
    : status === "eliminated" || status === "withdrawn"
      ? "failure"
      : status === "finalist"
        ? "success"
        : "";
export function Statistics({ data }) {
  const saved = data.evaluations.filter(
    (e) => e.timer_status === "saved" && !e.is_tiebreaker,
  );
  const approved = saved.filter((e) => e.approved).length;
  const average = (field) =>
    saved.length
      ? saved.reduce((n, e) => n + Number(e[field]), 0) / saved.length
      : null;
  const areaStats = data.areas
    .map((a) => {
      const ids = data.entries
        .filter((x) => x.area_id === a.id)
        .map((x) => x.id);
      const all = saved.filter((e) => ids.includes(e.entry_id));
      return {
        ...a,
        total: all.length,
        rate: all.length
          ? (all.filter((e) => e.approved).length / all.length) * 100
          : null,
      };
    })
    .filter((a) => a.total)
    .sort((a, b) => b.rate - a.rate);
  return (
    <>
      <h2>Dashboard del concurso</h2>
      <div className="grid">
        {[
          ["Participantes", data.members.length],
          [
            "Participaciones activas",
            data.entries.filter((x) => x.effective_status === "active").length,
          ],
          [
            "Aprobación",
            saved.length
              ? `${Math.round((approved / saved.length) * 100)}%`
              : "—",
          ],
          ["Calidad promedio", average("quality_score")?.toFixed(1) ?? "—"],
          [
            "Tiempo promedio",
            saved.length ? formatCompetitionTime(average("duration_ms")) : "—",
          ],
          [
            "Eliminados",
            data.entries.filter((x) => x.status === "eliminated").length,
          ],
          [
            "Finalistas",
            data.entries.filter((x) => x.effective_status === "finalist").length,
          ],
          [
            "Fuera de competencia",
            data.entries.filter((x) => x.effective_status === "withdrawn")
              .length,
          ],
          [
            "Campeones",
            data.entries.filter((x) => x.status === "champion").length,
          ],
        ].map(([label, value]) => (
          <section className="card" key={label}>
            <p className="muted">{label}</p>
            <p className="stat">{value}</p>
          </section>
        ))}
      </div>
      <p className="muted">
        Aprobación y promedios consideran todos los intentos oficiales
        guardados, incluidos reintentos; excluyen cancelaciones, correcciones y
        desempates.
      </p>
      <div className="grid">
        <section className="card">
          <h3>Aprobación por área</h3>
          {areaStats.length ? (
            <>
              <p>
                Mayor: <strong>{areaStats[0].name}</strong> ·{" "}
                {areaStats[0].rate.toFixed(0)}%
              </p>
              <p>
                Menor: <strong>{areaStats.at(-1).name}</strong> ·{" "}
                {areaStats.at(-1).rate.toFixed(0)}%
              </p>
              {areaStats.map((a) => (
                <p key={a.id}>
                  {a.name}: {a.rate.toFixed(0)}% ({a.total} intentos)
                </p>
              ))}
            </>
          ) : (
            <p>Sin evaluaciones guardadas.</p>
          )}
        </section>
        <section className="card">
          <h3>Puntos por trainer</h3>
          {data.teamRanking.map((t) => (
            <p key={t.team_id}>
              {t.trainer_name}
              <br />
              <strong>{t.points} puntos</strong> · {t.team_name}
            </p>
          ))}
        </section>
      </div>
    </>
  );
}

export function Fixture({ data, admin, contest, execute }) {
  const [areaId, setAreaId] = useState(data.areas[0]?.id || "");
  const area = data.areas.find((a) => a.id === areaId);
  const entries = data.entries.filter((x) => x.area_id === areaId).sort((a, b) =>
    (a.seed_order ?? Infinity) - (b.seed_order ?? Infinity) || a.display_name.localeCompare(b.display_name),
  );
  return (
    <>
      <h2>Fixture por área</h2>
      <div className="toolbar">
        <label>
          Área del fixture
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            {data.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {admin && contest.status === "active" && (
          <button
            className="primary"
            onClick={() =>
              window.confirm(
                "¿Resolver el área con todos sus resultados actuales? Se exigirá desempate cuando corresponda.",
              ) && execute("champion", { area_id: areaId })
            }
          >
            Resolver final / declarar campeón
          </button>
        )}
      </div>
      <CompetitionDraw {...{ entries, contest, statusLabel }} />
      {area?.status === "tiebreak_required" && (
        <p className="notice">
          Desempate requerido · Ronda {area.tiebreak_round}. Evalúe en Final a
          quienes tienen la marca «Desempate» y vuelva a resolver.
        </p>
      )}
      <div className="fixture">
        {data.phases
          .filter((p) => p.active)
          .map((phase) => (
            <section className="phase" key={phase.id}>
              <h3>{phase.name} →</h3>
              {entries.map((entry) => {
                const results = data.evaluations
                  .filter(
                    (e) =>
                      e.entry_id === entry.id &&
                      e.phase_id === phase.id &&
                      !e.is_tiebreaker &&
                      e.timer_status === "saved",
                  )
                  .sort((a, b) => b.attempt_number - a.attempt_number);
                const last = results[0];
                if (!last && entry.current_phase_id !== phase.id) return null;
                const outcome =
                  last &&
                  evaluationOutcome(
                    Number(last.quality_score),
                    last.duration_ms,
                    last.minimum_quality,
                    last.maximum_duration_ms,
                    last.critical_error,
                  );
                return (
                  <article className="card" key={entry.id}>
                    <h3>{entry.display_name}</h3>
                    <p className="muted">{entry.team_name}</p>
                    {last ? (
                      <>
                        <p>
                          <strong>{last.quality_score} / 100</strong> ·{" "}
                          {formatCompetitionTime(last.duration_ms)}
                        </p>
                        <span
                          className={`badge ${last.approved ? "success" : "failure"}`}
                        >
                          {last.approved ? "✓ APROBADO" : "NO APROBADO"}
                        </span>
                        <p className="muted">
                          {last.approved
                            ? `→ ${statusLabel(entry.effective_status || entry.status)} · ${entry.current_phase_name}`
                            : outcome.reason}
                        </p>
                      </>
                    ) : (
                      <span className="badge">Pendiente</span>
                    )}
                    {entry.tiebreak_candidate &&
                      area.status === "tiebreak_required" && (
                        <p className="badge gold">Desempate</p>
                      )}
                  </article>
                );
              })}
            </section>
          ))}
        <section className="phase">
          <h3>Campeón</h3>
          {entries
            .filter((x) => x.status === "champion")
            .map((x) => (
              <article className="card gold" key={x.id}>
                <h3>★ {x.display_name}</h3>
                <p>{x.team_name}</p>
                <p>+{x.champion_points} puntos de campeón</p>
              </article>
            ))}
          {!entries.some((x) => x.status === "champion") && (
            <p className="muted">
              {area?.status === "completed"
                ? "Área finalizada sin aprobados en final."
                : "Pendiente de resolución"}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
export function Rankings({ data }) {
  const [view, setView] = useState("individual");
  return (
    <>
      <h2>Ranking</h2>
      <div className="actions">
        {[
          ["individual", "Individual"],
          ["teams", "Equipos"],
          ["trainers", "Trainers"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={view === key ? "primary" : ""}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              {(view === "individual"
                ? [
                    "Posición",
                    "Colaborador",
                    "Equipo",
                    "Trainer",
                    "Áreas",
                    "Fase máxima aprobada",
                    "Calidad promedio",
                    "Puntos",
                  ]
                : [
                    "Posición",
                    view === "teams" ? "Equipo" : "Trainer",
                    "Equipo / trainer",
                    ...data.phases.filter((p) => p.active).map((p) => p.name),
                    "Campeones",
                    "Puntos",
                  ]
              ).map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view === "individual"
              ? data.individual.map((r, i) => (
                  <tr key={r.member_id}>
                    <td>{i + 1}</td>
                    <td>{r.display_name}</td>
                    <td>{r.team_name}</td>
                    <td>{r.trainer_name}</td>
                    <td>{r.areas}</td>
                    <td>
                      {data.phases.find((p) => p.phase_order === r.max_phase)
                        ?.name || "—"}
                    </td>
                    <td>{r.average_quality ?? "—"}</td>
                    <td>
                      <strong>{r.points}</strong>
                    </td>
                  </tr>
                ))
              : data.teamRanking.map((r, i) => (
                  <tr key={r.team_id}>
                    <td>{i + 1}</td>
                    <td>{view === "teams" ? r.team_name : r.trainer_name}</td>
                    <td>{view === "teams" ? r.trainer_name : r.team_name}</td>
                    {data.phases
                      .filter((p) => p.active)
                      .map((p) => (
                        <td key={p.id}>{r.phase_approvals[p.name] || 0}</td>
                      ))}
                    <td>{r.champions}</td>
                    <td>
                      <strong>{r.points}</strong>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Puntos derivados de evaluaciones oficiales aprobadas y bonus de campeón.
        Los desempates no repiten puntos.
      </p>
    </>
  );
}
export function MyCompetition({ data, staffId }) {
  const member = data.members.find((m) => m.staff_id === staffId);
  const trainerTeam = data.teams.find((t) => t.trainer_staff_id === staffId);
  const team = data.teams.find((t) => t.id === member?.team_id) || trainerTeam;
  const ranking = data.individual.find((r) => r.staff_id === staffId);
  const entries = data.entries.filter((x) => x.staff_id === staffId);
  if (!team)
    return (
      <div className="card">
        <h2>Mi concurso</h2>
        <p>
          Todavía no estás asociado a un equipo en este concurso. Puedes
          consultar el fixture y los rankings de tu tienda.
        </p>
      </div>
    );
  return (
    <>
      <h2>Mi concurso</h2>
      <section className="card">
        <h3>{team.name}</h3>
        {ranking?.eligible === false && (
          <p className="notice">
            Tu cese ya es efectivo o tu perfil está inactivo. Conservas tus
            resultados y tu equipo; no puedes recibir nuevas evaluaciones
            mientras siga así.
          </p>
        )}
        <p>
          Trainer: <strong>{team.trainer_name}</strong>
        </p>
        <p className="stat">
          {ranking?.points ??
            data.teamRanking.find((t) => t.team_id === team.id)?.points ??
            0}{" "}
          <small className="muted">
            puntos{trainerTeam ? " de tu equipo" : ""}
          </small>
        </p>
        <h3>Compañeros</h3>
        <p>
          {data.members
            .filter((m) => m.team_id === team.id)
            .map((m) => m.display_name)
            .join(" · ")}
        </p>
        <h3>Áreas de los integrantes de {team.name}</h3>
        <ul>
          {data.members.filter((m) => m.team_id === team.id).map((m) => {
            const areas = data.entries.filter((e) => e.member_id === m.id);
            return <li key={m.id}><strong>{m.display_name}</strong>: {areas.length ? areas.map((e) => `${e.area_name} (${statusLabel(e.effective_status || e.status)} · ${e.current_phase_name})`).join("; ") : "Sin inscripción todavía"}</li>;
          })}
        </ul>
      </section>
      <div className="grid">
        {entries.map((entry) => {
          const results = data.evaluations
            .filter(
              (e) => e.entry_id === entry.id && e.timer_status === "saved",
            )
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
          const last = results[0];
          return (
            <section className="card" key={entry.id}>
              <h3>{entry.area_name}</h3>
              <span className={`badge ${badgeClass(entry.effective_status || entry.status)}`}>
                {statusLabel(entry.effective_status || entry.status)}
              </span>
              <ol>
                {data.phases
                  .filter((p) => p.active)
                  .map((p) => (
                    <li key={p.id}>
                      {p.name}{" "}
                      {results.some(
                        (e) =>
                          e.phase_id === p.id && e.approved && !e.is_tiebreaker,
                      )
                        ? "✓"
                        : entry.current_phase_id === p.id &&
                            entry.effective_status === "active"
                          ? "⏳"
                          : ""}
                    </li>
                  ))}
              </ol>
              {last && (
                <>
                  <h3>Última evaluación</h3>
                  <p>
                    Calidad: {last.quality_score}/100
                    <br />
                    Tiempo: {formatCompetitionTime(last.duration_ms)}
                    <br />
                    {last.approved ? "APROBADO" : "NO APROBADO"} · +
                    {last.points_awarded} puntos
                  </p>
                </>
              )}
              <p>Fase actual: {entry.current_phase_name}</p>
            </section>
          );
        })}
      </div>
    </>
  );
}
export function History({ data, execute, contest }) {
  return (
    <>
      <h2>Historial y auditoría</h2>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Colaborador / área",
                "Fase / intento",
                "Tiempo",
                "Calidad",
                "Resultado",
                "Puntos",
                "Acciones",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.evaluations]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((e) => {
                const x = data.entries.find((x) => x.id === e.entry_id);
                return (
                  <tr key={e.id}>
                    <td>
                      {x?.display_name}
                      <br />
                      {x?.area_name}
                    </td>
                    <td>
                      {data.phases.find((p) => p.id === e.phase_id)?.name} ·{" "}
                      {e.attempt_number}
                      {e.is_tiebreaker ? " · Desempate" : ""}
                    </td>
                    <td>
                      {e.duration_ms == null
                        ? "—"
                        : formatCompetitionTime(e.duration_ms)}
                    </td>
                    <td>{e.quality_score ?? "—"}</td>
                    <td>
                      {statusLabel(e.timer_status)}
                      {e.timer_status === "saved"
                        ? e.approved
                          ? " · Aprobado"
                          : " · No aprobado"
                        : ""}
                    </td>
                    <td>{e.points_awarded}</td>
                    <td>
                      {e.timer_status === "saved" &&
                        contest.status === "active" && (
                          <button
                            onClick={() => {
                              const reason = window.prompt(
                                "Corregir invalida este resultado y los posteriores de esta participación, y revoca el campeón del área. Motivo obligatorio:",
                              );
                              if (reason?.trim())
                                execute("correct", {
                                  evaluation_id: e.id,
                                  reason,
                                });
                            }}
                          >
                            Corregir con auditoría
                          </button>
                        )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h3>Registro de cambios</h3>
        {[...data.audit].reverse().map((a) => (
          <details key={a.id}>
            <summary>
              {new Date(a.created_at).toLocaleString("es-PE")} ·{" "}
              {a.new_data?.event} · {a.actor_id?.slice(0, 8)}
            </summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: 12,
              }}
            >
              {JSON.stringify(
                { anterior: a.old_data, nuevo: a.new_data },
                null,
                2,
              )}
            </pre>
          </details>
        ))}
      </section>
    </>
  );
}
