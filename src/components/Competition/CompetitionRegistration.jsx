import React from "react";
import { statusLabel } from "./CompetitionViews";
import { COMPETITION_AREAS, competitionAreaRegistrationIssue } from '../../services/competitionRules';

export default function CompetitionRegistration({ data, contest, staffId, execute }) {
  const leaderTeam = data.teams.find((team) => team.trainer_eligible && team.trainer_staff_id === staffId);
  if (leaderTeam) return <section className="card">
    <h2>Seguimiento del equipo</h2>
    <p>Como líder de {leaderTeam.name}, solo haces seguimiento a tus colaboradores. Consulta sus áreas y resultados en Mi concurso, Fixture y Ranking.</p>
  </section>;
  const member = data.members.find((m) => m.staff_id === staffId);
  const ranking = data.individual.find((r) => r.staff_id === staffId);
  const mine = data.entries.filter((e) => e.member_id === member?.id);
  const editable = contest.status === "draft";
  const registrationOpen = ['draft', 'active'].includes(contest.status);
  return (
    <>
      <h2>Inscribirme en un área</h2>
      <p className="notice">
        Puedes elegir hasta {contest.max_areas_per_participant} áreas. No hay
        límite de inscritos por equipo en cada área. La inscripción se confirma al guardarse en
        el servidor. Durante el concurso puedes inscribirte en áreas que sigan
        en su fase inicial. Te añadirás al final del orden de evaluación.
      </p>
      {!member && <p className="notice">El administrador debe asociarte primero a un equipo.</p>}
      {member && <p>{data.teams.find((t) => t.id === member.team_id)?.name} · {mine.length} / {contest.max_areas_per_participant} áreas elegidas</p>}
      {mine.length >= contest.max_areas_per_participant && registrationOpen && <p className="notice">Ya elegiste tus 2 áreas.{editable && ' Para cambiar una, retira tu inscripción y elige otra antes de que se active el concurso.'}</p>}
      {ranking?.eligible === false && <p className="notice error">Tu perfil está inactivo o tu cese ya es efectivo. No puedes inscribirte.</p>}
      {!registrationOpen && <p className="notice">Inscripciones cerradas. Consulta tus áreas y los competidores en el fixture.</p>}
      {contest.status === 'active' && <p className="notice">El concurso está activo. Las nuevas inscripciones conservan el orden y los resultados existentes. Las inscripciones ya confirmadas no se pueden retirar durante la competencia.</p>}
      <div className="grid">
        {data.areas.filter((a) => a.active && COMPETITION_AREAS.includes(a.name)).map((area) => {
          const entrants = data.entries.filter((e) => e.area_id === area.id);
          const eligible = entrants.filter((e) => e.eligible);
          const entry = mine.find((e) => e.area_id === area.id);
          const used = entrants.filter((e) => e.team_id === member?.team_id).length;
          const minimum = contest.minimum_participants_per_area || 2;
          const registrationIssue = competitionAreaRegistrationIssue(contest, area, data);
          return (
            <section className="card" key={area.id}>
              <h3>{area.name}</h3>
              <p>{eligible.length} inscritos elegibles · mínimo {minimum}</p>
              {member && <p>Inscritos de tu equipo: {used}</p>}
              {eligible.length < minimum && <p className="muted">Faltan {minimum - eligible.length} inscritos para competir en esta área.</p>}
              {!entry && registrationIssue && <p className="muted">{registrationIssue}</p>}
              {entry ? (
                <>
                  <p className="badge success">Inscrito · {statusLabel(entry.effective_status || entry.status)}</p>
                  {editable && <button onClick={() => execute("withdraw", { area_id: area.id })}>Retirar mi inscripción</button>}
                </>
              ) : (
                <button className="primary" disabled={Boolean(registrationIssue) || !member || ranking?.eligible === false || mine.length >= contest.max_areas_per_participant} onClick={() => execute("register", { area_id: area.id })}>
                  Inscribirme
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
