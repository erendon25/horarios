import React from "react";

export default function CompetitionDraw({ entries, contest, statusLabel }) {
  const groups = new Map();
  entries.filter((e) => e.draw_group != null).sort((a, b) => a.seed_order - b.seed_order).forEach((e) => {
    if (!groups.has(e.draw_group)) groups.set(e.draw_group, []);
    groups.get(e.draw_group).push(e);
  });
  if (!groups.size) return <p className="notice">El sorteo del orden y los cruces se genera al activar el concurso, después de cerrar las inscripciones. Mínimo {contest.minimum_participants_per_area || 2} inscritos elegibles por área.</p>;
  return (
    <section className="card">
      <h3>Cruces y orden sorteado</h3>
      <p className="muted">Los cruces organizan las evaluaciones. Cada persona avanza al cumplir calidad y tiempo; la comparación final decide el campeón. Si el total es impar, el último cruce reúne tres personas.</p>
      <div className="grid">
        {[...groups].map(([number, entrants]) => (
          <article className="card" key={number}>
            <h4>Cruce {number}</h4>
            <ol>{entrants.map((e) => <li key={e.id}>Turno {e.seed_order}: <strong>{e.display_name}</strong> · {e.team_name} · {statusLabel(e.effective_status || e.status)}</li>)}</ol>
          </article>
        ))}
      </div>
    </section>
  );
}
