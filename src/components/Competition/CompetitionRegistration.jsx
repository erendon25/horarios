import React from "react";
import { statusLabel } from "./CompetitionViews";

export default function CompetitionRegistration({ data, contest, staffId, execute }) {
  const member = data.members.find((m) => m.staff_id === staffId);
  const ranking = data.individual.find((r) => r.staff_id === staffId);
  const mine = data.entries.filter((e) => e.member_id === member?.id);
  const editable = contest.status === "draft";
  return (
    <>
      <h2>Inscribirme en un área</h2>
      <p className="notice">
        Puedes elegir hasta {contest.max_areas_per_participant} áreas. Cada equipo
        dispone de 2 cupos por área. La inscripción se confirma al guardarse en
        el servidor; al activar el concurso se cierran las inscripciones y se
        sortea el orden de competencia.
      </p>
      {!member && <p className="notice">El administrador debe asociarte primero a un equipo. Los líderes consultan las áreas de sus integrantes en Mi concurso.</p>}
      {member && <p>{data.teams.find((t) => t.id === member.team_id)?.name} · {mine.length} / {contest.max_areas_per_participant} áreas elegidas</p>}
      {ranking?.eligible === false && <p className="notice error">Tu perfil está inactivo o tu cese ya es efectivo. No puedes inscribirte.</p>}
      {!editable && <p className="notice">Inscripciones cerradas. Consulta tus áreas y los competidores en el fixture.</p>}
      <div className="grid">
        {data.areas.filter((a) => a.active).map((area) => {
          const entrants = data.entries.filter((e) => e.area_id === area.id);
          const eligible = entrants.filter((e) => e.eligible);
          const entry = mine.find((e) => e.area_id === area.id);
          const used = entrants.filter((e) => e.team_id === member?.team_id).length;
          const minimum = contest.minimum_participants_per_area || 2;
          const full = used >= 2;
          return (
            <section className="card" key={area.id}>
              <h3>{area.name}</h3>
              <p>{eligible.length} inscritos elegibles · mínimo {minimum}</p>
              {member && <p>Cupos de tu equipo: {used} / 2</p>}
              {eligible.length < minimum && <p className="muted">Faltan {minimum - eligible.length} inscritos para competir en esta área.</p>}
              {entry ? (
                <>
                  <p className="badge success">Inscrito · {statusLabel(entry.effective_status || entry.status)}</p>
                  {editable && <button onClick={() => execute("withdraw", { area_id: area.id })}>Retirar mi inscripción</button>}
                </>
              ) : (
                <button className="primary" disabled={!editable || !member || ranking?.eligible === false || full || mine.length >= contest.max_areas_per_participant} onClick={() => execute("register", { area_id: area.id })}>
                  {full ? "Cupos del equipo completos" : "Inscribirme"}
                </button>
              )}
              <h4>Competidores inscritos</h4>
              {entrants.length ? <ul>{entrants.map((e) => <li key={e.id}>{e.display_name} · {e.team_name}{!e.eligible ? " · Fuera de competencia" : ""}</li>)}</ul> : <p className="muted">Todavía no hay inscritos.</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}

