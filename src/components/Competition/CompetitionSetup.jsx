import React, { useState } from "react";
import { defaultChecklist } from '../../services/competitionChecklist';
import {
  buildCompetitionTeamTemplate,
  competitionStaffName,
  competitionStaffUnavailable,
  competitionStaffIsTrainer,
} from "../../services/competitionRules";
import { statusLabel } from "./CompetitionViews";

const fullName = competitionStaffName;
export function StaffSelect({ staff, trainersOnly = false, ...props }) {
  return (
    <select required {...props}>
      <option value="">Seleccionar perfil existente…</option>
      {staff.filter((s) => !competitionStaffUnavailable(s) && (!trainersOnly || competitionStaffIsTrainer(s))).map((s) => (
        <option key={s.id} value={s.id}>
          {fullName(s)}
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
  const teamTemplate = buildCompetitionTeamTemplate(staff);
  const [draw, setDraw] = useState([]);
  const editable = contest.status === "draft";
  const saveTemplate = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const teams = teamTemplate.map((team) => ({
      ...team,
      name: String(form.get(`name-${team.trainer_staff_id}`) || '').trim(),
      trainer_staff_id: form.get(`trainer-${team.trainer_staff_id}`),
    }));
    if (!teams.length) return;
    if (new Set(teams.map((team) => team.trainer_staff_id)).size !== teams.length) {
      window.alert(
        "Cada equipo debe tener un trainer distinto. Revise las asociaciones.",
      );
      return;
    }
    const result = await execute("roster", { teams });
    if (result) setTemplate(false);
  };
  return (
    <>
      <h2>Equipos y trainers</h2>
      <p className="muted">
        Cada equipo puede tener distinta cantidad de integrantes. Los puntos
        del trainer son el total del equipo dividido entre sus colaboradores.
      </p>
      <p className="notice">
        Las personas con cese futuro pueden participar hasta esa fecha (hora de
        Lima). Después quedan fuera de nuevas evaluaciones. Su equipo y sus
        puntos ya obtenidos se conservan; quitar el cese restaura la elegibilidad
        en el mismo equipo.
      </p>
      <p className="muted">
        Solo aparecen colaboradores laboralmente vigentes, sin cese efectivo ni
        entrenamiento finalizado. Un registro de cuenta pendiente no equivale
        a un perfil inactivo ni impide integrar o liderar un equipo.
        La plantilla prepara un equipo por cada trainer vigente de esta tienda.
      </p>
      {editable && data.teams.length === 0 && (
        <div className="card">
          <button disabled={!teamTemplate.length} onClick={() => setTemplate(!template)}>
            Preparar equipos según trainers ({teamTemplate.length})
          </button>
          {!teamTemplate.length && <p className="notice">No hay perfiles disponibles con puesto ENTRENADOR en esta tienda.</p>}
          {template && (
            <form onSubmit={saveTemplate}>
              <p className="notice">
                Se crearán {teamTemplate.length} equipos, cada uno con un trainer
                vigente. Revise los nombres y asociaciones. Después podrá añadir
                o sortear integrantes sin límite por equipo.
              </p>
              {teamTemplate.map((team) => (
                <section key={team.trainer_staff_id}>
                  <h3>{team.name}</h3>
                  <label className="template-row">
                    Nombre del equipo
                    <input name={`name-${team.trainer_staff_id}`} defaultValue={team.name} required maxLength={100} />
                  </label>
                  <label className="template-row">
                    Trainer del equipo
                    <StaffSelect staff={staff} trainersOnly
                      name={`trainer-${team.trainer_staff_id}`}
                      defaultValue={team.trainer_staff_id} />
                  </label>
                </section>
              ))}
              <button className="primary" type="submit">
                Crear {teamTemplate.length} equipos
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
            <StaffSelect name="trainer_staff_id" staff={staff} trainersOnly />
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
              {!team.trainer_eligible && <p className="notice">Este equipo no tiene un trainer vigente. Solo los perfiles con puesto ENTRENADOR pueden liderarlo.</p>}
              <p className="badge">
                Participaciones utilizadas: {used}
              </p>
              <p className="muted">
                {members.length} integrantes · sin límite por equipo
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
                          trainersOnly
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
            distribuyéndolos entre los equipos sin límite de integrantes.
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
        Cada colaborador elige sus áreas desde Mi concurso, con un máximo de 2. Aquí puede consultar las inscripciones.
      </p>
      <p className="notice">
        No hay límite de integrantes de cada equipo por área. Se necesitan al menos
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
              {!entries.length && <p className="muted">Pendiente de elección del colaborador.</p>}
              {entries.map((x) => (
                <div className="actions" key={x.id}>
                  <span>
                    {x.area_name} · {x.current_phase_name}
                  </span>
                  <span className="badge">
                    {statusLabel(x.effective_status || x.status)}
                  </span>
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
      .map((r) => ({ label: r.label, max_score: r.max_score, checklist: r.checklist || [] })),
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
                  checklist: i.checklist.map(step=>({...step,points:Number(step.points)})),
                })),
              });
            }}
          >
            {items.map((item, index) => (
              <div className="card" key={index}>
              <div className="score-row">
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
              <p className="muted">Defina acciones observables. Sus puntos deben sumar {item.max_score || 0}.</p>
              {item.checklist.map((step,si)=><div className="score-row" key={step.id}>
                <label>Acción {si+1}<textarea required maxLength={1000} value={step.label} onChange={event=>{const label=event.target.value;setItems(current=>current.map((r,j)=>j===index?{...r,checklist:r.checklist.map((s,k)=>k===si?{...s,label}:s)}:r));}}/></label>
                <label>Puntos si cumple<input type="number" min="0.01" max="100" step="0.01" required value={step.points} onChange={event=>{const points=event.target.value;setItems(current=>current.map((r,j)=>j===index?{...r,checklist:r.checklist.map((s,k)=>k===si?{...s,points}:s)}:r));}}/></label>
                <label>Comprobación<select value={step.automatic || 'manual'} onChange={event=>{const automatic=event.target.value;setItems(current=>current.map((r,j)=>j===index?{...r,checklist:r.checklist.map((s,k)=>k===si?{id:s.id,label:s.label,points:s.points,...(automatic==='time_limit'?{automatic}:{})}:s)}:r));}}><option value="manual">Observación del evaluador</option><option value="time_limit">Tiempo registrado ≤ máximo del área</option></select></label>
                <button type="button" onClick={()=>setItems(current=>current.map((r,j)=>j===index?{...r,checklist:r.checklist.filter((_,k)=>k!==si)}:r))}>Quitar acción</button>
              </div>)}
              <p>Suma de acciones: {Math.round(item.checklist.reduce((sum,step)=>sum+Number(step.points || 0),0)*100)/100} / {item.max_score || 0}</p>
              <div className="actions">
                <button type="button" onClick={()=>setItems(current=>current.map((r,j)=>j===index?{...r,checklist:[...r.checklist,{id:crypto.randomUUID(),label:'',points:1}]}:r))}>Añadir acción</button>
                <button type="button" onClick={()=>setItems(current=>current.map((r,j)=>j===index?{...r,checklist:defaultChecklist(area.name,r.label,r.max_score)}:r))}>Restaurar guía inicial</button>
              </div>
              </div>
            ))}
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  setItems((v) => [...v, { label: "", max_score: 0, checklist: [] }])
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
        <h3>Publicación al equipo</h3>
        <p className="notice">
          {contest.published_at
            ? 'Publicado: los colaboradores y trainers de esta tienda pueden ver el concurso.'
            : 'Oculto: solo los administradores pueden preparar y consultar este concurso.'}
        </p>
        <p className="muted">
          Publicar muestra Mi concurso a todo el equipo de la tienda. Las
          inscripciones permanecen abiertas mientras el concurso esté en borrador.
          Activarlo cierra las inscripciones y sortea el orden de competencia.
        </p>
        <button
          className={contest.published_at ? undefined : 'primary'}
          onClick={() => {
            const published = !contest.published_at;
            if (window.confirm(published
              ? '¿Publicar el concurso para todo el equipo de esta tienda?'
              : '¿Ocultar el concurso a colaboradores y trainers? Las inscripciones y resultados se conservarán.')) {
              execute('publication', { published });
            }
          }}
        >
          {contest.published_at ? 'Ocultar al equipo' : 'Publicar al equipo'}
        </button>
      </section>
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
            <p className="notice">Cada colaborador puede elegir un máximo de 2 áreas desde su panel personal.</p>
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
