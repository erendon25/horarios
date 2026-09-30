import React, { useState } from "react";
import {
  INITIAL_TEAMS,
  matchCompetitionStaff,
  competitionStaffName,
  competitionStaffUnavailable,
} from "../../services/competitionRules";
import { statusLabel } from "./CompetitionViews";

const fullName = competitionStaffName;
export function StaffSelect({ staff, ...props }) {
  return (
    <select required {...props}>
      <option value="">Seleccionar perfil existente…</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id} disabled={Boolean(competitionStaffUnavailable(s))}>
          {fullName(s)}
          {competitionStaffUnavailable(s) ? ` · ${competitionStaffUnavailable(s)}` : s.status === "pending" ? " · Perfil pendiente de completar" : ""}
          {s.cessation_date ? ` · cese ${s.cessation_date}` : ""}
        </option>
      ))}
    </select>
  );
}
const values = (event) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
};

export function Teams({ data, contest, staff, execute }) {
  const [template, setTemplate] = useState(false);
  const [mapping, setMapping] = useState(() =>
    INITIAL_TEAMS.map((t) => ({
      trainer: matchCompetitionStaff(t.trainer, staff),
      members: t.members.map((n) => matchCompetitionStaff(n, staff)),
    })),
  );
  const [draw, setDraw] = useState([]);
  const editable = contest.status === "draft";
  const setMatch = (ti, index, value) =>
    setMapping((current) =>
      current.map((m, i) =>
        i !== ti
          ? m
          : index < 0
            ? { ...m, trainer: value }
            : {
                ...m,
                members: m.members.map((id, j) => (j === index ? value : id)),
              },
      ),
    );
  const saveTemplate = async (event) => {
    event.preventDefault();
    const all = mapping.flatMap((m) => [m.trainer, ...m.members]);
    if (new Set(all).size !== all.length) {
      window.alert(
        "Cada persona debe estar asociada una sola vez. Revise trainers e integrantes.",
      );
      return;
    }
    await execute("roster", {
      teams: INITIAL_TEAMS.map((t, i) => ({
        name: t.name,
        trainer_staff_id: mapping[i].trainer,
        staff_ids: mapping[i].members,
      })),
    });
  };
  return (
    <>
      <h2>Equipos y trainers</h2>
      <p className="muted">
        Los nombres se asocian a los perfiles existentes por UUID. El trainer
        recibe automáticamente los puntos de su equipo.
      </p>
      <p className="notice">
        Las personas con cese futuro pueden participar hasta esa fecha (hora de
        Lima). Después quedan fuera de nuevas evaluaciones. Su equipo y sus
        puntos ya obtenidos se conservan; quitar el cese restaura la elegibilidad
        en el mismo equipo.
      </p>
      <p className="muted">
        El selector incluye perfiles activos y pendientes de completar. Los
        inactivos o con cese efectivo aparecen deshabilitados con el motivo.
        La plantilla requiere coincidencia exacta; si el nombre difiere,
        seleccione el perfil manualmente.
      </p>
      {editable && data.teams.length === 0 && (
        <div className="card">
          <button onClick={() => setTemplate(!template)}>
            Asociar los cuatro equipos iniciales
          </button>
          {template && (
            <form onSubmit={saveTemplate}>
              <p className="notice">
                Las coincidencias exactas se sugieren. Revise cada asociación;
                los nombres ambiguos o diferentes requieren selección manual. No
                se crean colaboradores.
              </p>
              {INITIAL_TEAMS.map((t, ti) => (
                <section key={t.name}>
                  <h3>{t.name}</h3>
                  {[t.trainer, ...t.members].map((name, index) => (
                    <label className="template-row" key={name}>
                      <span>
                        {index === 0 ? "Trainer · " : ""}
                        {name}
                      </span>
                      <StaffSelect
                        staff={staff}
                        value={
                          index === 0
                            ? mapping[ti].trainer
                            : mapping[ti].members[index - 1]
                        }
                        onChange={(e) =>
                          setMatch(ti, index - 1, e.target.value)
                        }
                      />
                    </label>
                  ))}
                </section>
              ))}
              <button className="primary" type="submit">
                Guardar asociaciones revisadas
              </button>
            </form>
          )}
        </div>
      )}
      {editable && (
        <form
          className="card form"
          onSubmit={async (e) => {
            const p = values(e);
            await execute("team", p);
          }}
        >
          <label>
            Nombre de equipo
            <input name="name" required maxLength={100} />
          </label>
          <label>
            Trainer
            <StaffSelect name="trainer_staff_id" staff={staff} />
          </label>
          <button className="primary">Crear equipo</button>
        </form>
      )}
      <div className="grid">
        {data.teams.map((team) => {
          const members = data.members.filter((m) => m.team_id === team.id);
          const used = data.entries.filter((x) =>
            members.some((m) => m.id === x.member_id),
          ).length;
          return (
            <section className="card" key={team.id}>
              <h3>{team.name}</h3>
              <p>
                Trainer: <strong>{team.trainer_name}</strong>
              </p>
              <p className="badge">
                Participaciones utilizadas {used} /{" "}
                {contest.team_size * contest.max_areas_per_participant}
              </p>
              <p className="muted">
                {members.length} / {contest.team_size} integrantes
              </p>
              <ul>
                {members.map((m) => (
                  <li key={m.id} className="actions">
                    <span>
                      {m.display_name}
                      {data.individual.find((r) => r.member_id === m.id)
                        ?.eligible === false
                        ? " · Fuera de competencia"
                        : ""}
                    </span>
                    {editable && (
                      <button
                        onClick={() => execute("remove_member", { id: m.id })}
                      >
                        Quitar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {editable && (
                <>
                  <form
                    className="form"
                    onSubmit={(e) =>
                      execute("member", { ...values(e), team_id: team.id })
                    }
                  >
                    <label>
                      Añadir o mover integrante
                      <StaffSelect name="staff_id" staff={staff} />
                    </label>
                    <button>Añadir a {team.name}</button>
                  </form>
                  <details>
                    <summary className="muted">Editar equipo / trainer</summary>
                    <form
                      className="form"
                      onSubmit={(e) =>
                        execute("team", { ...values(e), id: team.id })
                      }
                    >
                      <label>
                        Nombre
                        <input name="name" defaultValue={team.name} required />
                      </label>
                      <label>
                        Trainer
                        <StaffSelect
                          name="trainer_staff_id"
                          staff={staff}
                          defaultValue={team.trainer_staff_id}
                        />
                      </label>
                      <button>Guardar equipo</button>
                    </form>
                  </details>
                </>
              )}
            </section>
          );
        })}
      </div>
      {editable && data.teams.length > 0 && data.members.length === 0 && (
        <section className="card">
          <h3>Sorteo de integrantes</h3>
          <p className="muted">
            Seleccione colaboradores. PostgreSQL distribuirá aleatoriamente,
            respetando la capacidad de los equipos.
          </p>
          <div className="grid">
            {staff
              .filter(
                (s) => !competitionStaffUnavailable(s) && !data.teams.some((t) => t.trainer_staff_id === s.id),
              )
              .map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={draw.includes(s.id)}
                    onChange={(e) =>
                      setDraw((d) =>
                        e.target.checked
                          ? [...d, s.id]
                          : d.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {fullName(s)}
                </label>
              ))}
          </div>
          <div className="actions">
            <button
              disabled={!draw.length}
              onClick={() =>
                window.confirm(`¿Sortear ${draw.length} integrantes?`) &&
                execute("draw", { staff_ids: draw })
              }
            >
              Realizar sorteo ({draw.length})
            </button>
          </div>
        </section>
      )}
    </>
  );
}

export function Participants({ data, contest, execute }) {
  return (
    <>
      <h2>Participantes y áreas</h2>
      <p className="muted">
        Hasta {contest.max_areas_per_participant} áreas por colaborador.
      </p>
      <p className="notice">
        Máximo 2 integrantes de cada equipo por área. Se necesitan al menos
        {" "}{contest.minimum_participants_per_area || 2} inscritos elegibles por
        área para activar. Los colaboradores pueden inscribirse desde su panel
        mientras el concurso está en borrador.
      </p>
      <div className="grid">
        {data.members.map((m) => {
          const entries = data.entries.filter((x) => x.member_id === m.id);
          return (
            <section className="card" key={m.id}>
              <h3>{m.display_name}</h3>
              {data.individual.find((r) => r.member_id === m.id)?.eligible ===
                false && (
                <p className="notice">
                  Cese efectivo o perfil inactivo. Conserva este equipo y sus
                  puntos; no se permiten nuevas evaluaciones.
                </p>
              )}
              <p>
                {data.teams.find((t) => t.id === m.team_id)?.name} ·{" "}
                {entries.length} / {contest.max_areas_per_participant}
              </p>
              {entries.map((x) => (
                <div className="actions" key={x.id}>
                  <span>
                    {x.area_name} · {x.current_phase_name}
                  </span>
                  <span className="badge">
                    {statusLabel(x.effective_status || x.status)}
                  </span>
                  {contest.status === "draft" && (
                    <button
                      onClick={() => execute("remove_entry", { id: x.id })}
                    >
                      Retirar
                    </button>
                  )}
                  {contest.status === "active" &&
                    x.status === "eliminated" &&
                    x.eligible && (
                    <button
                      onClick={() => {
                        const reason = window.prompt(
                          "Motivo para reabrir esta participación:",
                        );
                        if (reason?.trim())
                          execute("reopen", { entry_id: x.id, reason });
                      }}
                    >
                      Autorizar reintento
                    </button>
                  )}
                </div>
              ))}
              {contest.status === "draft" && (
                <form
                  className="form"
                  onSubmit={(e) =>
                    execute("entry", { ...values(e), member_id: m.id })
                  }
                >
                  <label>
                    Área
                    <select required name="area_id">
                      <option value="">Seleccionar…</option>
                      {data.areas
                        .filter(
                          (a) =>
                            a.active &&
                            !entries.some((x) => x.area_id === a.id) &&
                            data.entries.filter((x) => x.area_id === a.id && x.team_id === m.team_id).length < 2,
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={
                      entries.length >= contest.max_areas_per_participant ||
                      data.individual.find((r) => r.member_id === m.id)
                        ?.eligible === false
                    }
                  >
                    Asignar área
                  </button>
                </form>
              )}
            </section>
          );
        })}
      </div>
      {!data.members.length && (
        <p className="notice">
          Primero forme los equipos y asocie sus integrantes.
        </p>
      )}
    </>
  );
}

function AreaEditor({ area, data, execute, editable }) {
  const [items, setItems] = useState(() =>
    data.rubric
      .filter((r) => r.area_id === area.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ label: r.label, max_score: r.max_score })),
  );
  const submit = (e) => {
    const p = values(e);
    execute("area", {
      ...p,
      id: area.id,
      active: p.active === "on",
      minimum_quality: Number(p.minimum_quality),
      maximum_duration_ms: p.maximum
        ? Math.round(Number(p.maximum) * 1000)
        : null,
      target_duration_ms: p.target ? Math.round(Number(p.target) * 1000) : null,
      sort_order: area.sort_order,
    });
  };
  return (
    <section className="card">
      <h3>{area.name}</h3>
      <fieldset disabled={!editable}>
        <form className="form" onSubmit={submit}>
          <label>
            Nombre
            <input name="name" defaultValue={area.name} required />
          </label>
          <label>
            Calidad mínima
            <input
              type="number"
              name="minimum_quality"
              min="0"
              max="100"
              step="0.01"
              defaultValue={area.minimum_quality}
              required
            />
          </label>
          <label>
            Tiempo máximo (segundos)
            <input
              type="number"
              name="maximum"
              min="0.01"
              step="0.01"
              defaultValue={
                area.maximum_duration_ms == null
                  ? ""
                  : area.maximum_duration_ms / 1000
              }
              required
            />
          </label>
          <label>
            Tiempo objetivo (opcional)
            <input
              type="number"
              name="target"
              min="0.01"
              step="0.01"
              defaultValue={
                area.target_duration_ms == null
                  ? ""
                  : area.target_duration_ms / 1000
              }
            />
          </label>
          <label className="check">
            <input type="checkbox" name="active" defaultChecked={area.active} />
            Área activa
          </label>
          <button>Guardar área</button>
        </form>
        <details>
          <summary className="actions">
            Rúbrica · {items.reduce((s, i) => s + Number(i.max_score || 0), 0)}{" "}
            / 100 puntos
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              execute("rubric", {
                area_id: area.id,
                items: items.map((i) => ({
                  ...i,
                  max_score: Number(i.max_score),
                })),
              });
            }}
          >
            {items.map((item, index) => (
              <div className="score-row" key={index}>
                <label>
                  Criterio {index + 1}
                  <input
                    required
                    value={item.label}
                    onChange={(e) =>
                      setItems((v) =>
                        v.map((r, j) =>
                          j === index ? { ...r, label: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Puntos
                  <input
                    required
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={item.max_score}
                    onChange={(e) =>
                      setItems((v) =>
                        v.map((r, j) =>
                          j === index ? { ...r, max_score: e.target.value } : r,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setItems((v) => v.filter((_, j) => j !== index))
                    }
                  >
                    Quitar
                  </button>
                </label>
              </div>
            ))}
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  setItems((v) => [...v, { label: "", max_score: 0 }])
                }
              >
                Añadir criterio
              </button>
              <button className="primary">Guardar rúbrica</button>
            </div>
          </form>
        </details>
      </fieldset>
    </section>
  );
}
export function Areas({ data, contest, execute }) {
  const editable = contest.status === "draft";
  return (
    <>
      <h2>Áreas y rúbricas</h2>
      <p className="notice">
        Configure el tiempo máximo de cada área antes de activar el concurso.
        Cada rúbrica debe sumar exactamente 100.
      </p>
      {data.areas.map((area) => (
        <AreaEditor
          key={`${area.id}:${contest.updated_at}`}
          {...{ area, data, execute, editable }}
        />
      ))}
      {editable && (
        <form
          className="card form"
          onSubmit={(e) =>
            execute("area", { ...values(e), sort_order: data.areas.length + 1 })
          }
        >
          <label>
            Nueva área
            <input name="name" required maxLength={100} />
          </label>
          <button>Agregar área</button>
        </form>
      )}
    </>
  );
}
export function Configuration({ data, contest, execute }) {
  const editable = contest.status === "draft";
  const submit = (e) => {
    const p = values(e);
    execute("config", {
      ...p,
      allow_timer_pause: p.allow_timer_pause === "on",
      start_date: p.start_date || null,
      end_date: p.end_date || null,
    });
  };
  return (
    <>
      <h2>Configuración</h2>
      <section className="card">
        <fieldset disabled={!editable}>
          <form className="form" onSubmit={submit}>
            <label>
              Nombre
              <input
                name="name"
                defaultValue={contest.name}
                required
                maxLength={160}
              />
            </label>
            <label>
              Máximo de áreas por persona
              <input
                name="max_areas_per_participant"
                type="number"
                min="1"
                max="20"
                defaultValue={contest.max_areas_per_participant}
                required
              />
            </label>
            <label>
              Integrantes por equipo
              <input
                name="team_size"
                type="number"
                min="1"
                max="100"
                defaultValue={contest.team_size}
                required
              />
            </label>
            <label>
              Bonus campeón
              <input
                name="champion_bonus"
                type="number"
                min="0"
                max="100"
                defaultValue={contest.champion_bonus}
                required
              />
            </label>
            <label>
              Inicio
              <input
                type="date"
                name="start_date"
                defaultValue={contest.start_date || ""}
              />
            </label>
            <label>
              Fin
              <input
                type="date"
                name="end_date"
                defaultValue={contest.end_date || ""}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="allow_timer_pause"
                defaultChecked={contest.allow_timer_pause}
              />
              Permitir pausas
            </label>
            <button className="primary">Guardar configuración</button>
          </form>
        </fieldset>
      </section>
      <section className="card">
        <h3>Fases y puntos</h3>
        <fieldset disabled={!editable}>
          {data.phases.map((p) => (
            <form
              key={p.id}
              className="form"
              onSubmit={(e) => {
                const v = values(e);
                execute("phase", { ...v, id: p.id, active: v.active === "on" });
              }}
            >
              <label>
                Nombre
                <input name="name" defaultValue={p.name} required />
              </label>
              <label>
                Orden
                <input
                  type="number"
                  name="phase_order"
                  min="1"
                  defaultValue={p.phase_order}
                  required
                />
              </label>
              <label>
                Puntos
                <input
                  type="number"
                  name="points"
                  min="0"
                  max="100"
                  defaultValue={p.points}
                  required
                />
              </label>
              <label className="check">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={p.active}
                />
                Activa
              </label>
              <button>Guardar fase</button>
            </form>
          ))}
          <form className="form" onSubmit={(e) => execute("phase", values(e))}>
            <label>
              Nueva fase
              <input required name="name" />
            </label>
            <label>
              Orden
              <input
                type="number"
                name="phase_order"
                min="1"
                defaultValue={data.phases.length + 1}
                required
              />
            </label>
            <label>
              Puntos
              <input
                type="number"
                name="points"
                min="0"
                max="100"
                required
                defaultValue="0"
              />
            </label>
            <button>Añadir fase</button>
          </form>
        </fieldset>
      </section>
      <section className="card">
        <h3>Estado del concurso</h3>
        <p>
          Estado actual:{" "}
          <strong>
            {contest.status === "draft"
              ? "Borrador"
              : contest.status === "active"
                ? "Activo"
                : "Finalizado"}
          </strong>
        </p>
        <p className="muted">
          Al activar se validan áreas, tiempos y rúbricas. Con intentos
          registrados, la configuración queda congelada para conservar
          resultados comparables.
        </p>
        <div className="actions">
          {contest.status !== "active" && (
            <button
              className="primary"
              onClick={() => execute("status", { status: "active" })}
            >
              Activar concurso
            </button>
          )}
          {contest.status === "active" && (
            <>
              <button onClick={() => execute("status", { status: "draft" })}>
                Volver a borrador
              </button>
              <button
                onClick={() =>
                  window.confirm(
                    "¿Finalizar el concurso? Todas las áreas deben estar resueltas.",
                  ) && execute("status", { status: "completed" })
                }
              >
                Finalizar concurso
              </button>
            </>
          )}
        </div>
      </section>
    </>
  );
}
