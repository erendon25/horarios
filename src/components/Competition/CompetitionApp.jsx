import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { registerCompetitionNavigationGuard } from "../../services/competitionNavigationGuard";
import { useCompetition } from "../../hooks/useCompetition";
import { competitionCommand, readAll } from "../../services/competition";
import { Teams, Participants, Areas, Configuration } from "./CompetitionSetup";
import CompetitionEvaluation from "./CompetitionEvaluation";
import CompetitionRegistration from "./CompetitionRegistration";
import {
  Statistics,
  Fixture,
  Rankings,
  MyCompetition,
  History,
} from "./CompetitionViews";
import "./Competition.css";

export default function CompetitionApp() {
  const { userData, userRole } = useAuth();
  const admin = ["admin", "superadmin"].includes(userRole);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const competitionId = params.get("id") || "";
  const evaluationId = params.get("evaluation") || "";
  const [tab, setTab] = useState(
    evaluationId && admin ? "evaluate" : admin ? "dashboard" : "mine",
  );
  const [contests, setContests] = useState([]);
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState(userData?.storeId || "");
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [leave, setLeave] = useState(null);
  const lock = useRef(false);
  const {
    data,
    contest,
    loading,
    error: readError,
    clock,
    connection,
    refresh,
  } = useCompetition(competitionId, admin);
  const selectedEvaluation = data?.evaluations.find(
    (e) => e.id === evaluationId,
  );
  const ongoing =
    selectedEvaluation &&
    ["pending", "running", "paused", "stopped"].includes(
      selectedEvaluation.timer_status,
    );
  const selectEvaluation = useCallback(
    (id) => {
      setParams(id ? { id: competitionId, evaluation: id } : { id: competitionId });
      setTab("evaluate");
    },
    [competitionId, setParams],
  );
  const selectContest = (id) => {
    setParams(id ? { id } : {});
    setTab(admin ? "dashboard" : "mine");
    setError("");
    setNotice("");
  };
  const loadContests = useCallback(async () => {
    try {
      const all = await readAll(
        "competitions",
        userRole === "superadmin" ? {} : { store_id: userData.storeId },
        "created_at",
      );
      all.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setContests(all);
      if (!competitionId && all.length)
        setParams(
          { id: all.find((c) => c.status === "active")?.id || all[0].id },
          { replace: true },
        );
    } catch (e) {
      setError(e.message);
    }
  }, [competitionId, setParams, userData.storeId, userRole]);
  useEffect(() => {
    void loadContests();
  }, [loadContests]);
  useEffect(() => {
    let alive = true;
    readAll("stores", {}, "name")
      .then((s) => {
        if (alive) setStores(s);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!admin || !contest?.store_id) return;
    let alive = true;
    // Narrow projection: management needs names and UUID, never DNI or account details.
    import("../../lib/supabase/client")
      .then(async ({ supabase }) => {
        const { data: rows, error } = await supabase
          .from("staff_profiles")
          .select("id,first_name,last_name,status,cessation_date")
          .eq("store_id", contest.store_id)
          .order("first_name");
        if (error) throw error;
        if (alive) setStaff(rows || []);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [admin, contest?.store_id, contest?.updated_at]);
  useEffect(() => {
    if (!ongoing) return;
    const unload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const currentIndex = window.history.state?.idx;
    let restoring = false;
    const back = (event) => {
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      const nextIndex = event.state?.idx;
      if (typeof currentIndex !== "number" || typeof nextIndex !== "number")
        return;
      const delta = currentIndex - nextIndex;
      if (!delta) return;
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go(delta);
      setLeave(() => () => navigate(-delta));
    };
    window.addEventListener("beforeunload", unload);
    const removeGuard = registerCompetitionNavigationGuard(back);
    return () => {
      window.removeEventListener("beforeunload", unload);
      removeGuard();
    };
  }, [ongoing, competitionId, evaluationId, navigate, admin]);
  const guard = (action, targetEvaluation) => {
    if (ongoing && targetEvaluation !== evaluationId) {
      setLeave(() => action);
      return;
    }
    action();
  };
  const execute = async (action, payload = {}) => {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await competitionCommand(competitionId, action, payload);
      await refresh();
      setNotice("Operación confirmada por el servidor.");
      return result;
    } catch (e) {
      setError(
        e.message ||
          "La operación no fue confirmada. Actualice antes de reintentar.",
      );
      await refresh();
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const create = async (e) => {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const created = await competitionCommand(null, "create", {
        store_id: storeId,
        name: form.get("name"),
      });
      setParams({ id: created.id });
      setTab("teams");
      await loadContests();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const tabs = admin
    ? [
        ["dashboard", "Dashboard"],
        ["teams", "Equipos"],
        ["participants", "Participantes"],
        ["areas", "Áreas"],
        ["fixture", "Fixture"],
        ["evaluate", "Evaluar"],
        ["ranking", "Ranking"],
        ["history", "Historial"],
        ["config", "Configuración"],
      ]
    : [
        ["mine", "Mi concurso"],
        ["registration", "Inscripción"],
        ["fixture", "Fixture"],
        ["ranking", "Ranking"],
      ];
  return (
    <main className="competition">
      <div className="shell">
        <header className="hero">
          <div>
            <div className="eyebrow">Little Caesars · Concurso interno</div>
            <h1>
              VELOCIDAD
              <br />& CALIDAD
            </h1>
            <p>Precisión en cada paso. Calidad hasta el final.</p>
          </div>
          <button
            className="ghost"
            onClick={() => guard(() => navigate(admin ? "/admin" : "/staff"))}
          >
            Volver a mi panel
          </button>
        </header>
        <div className="toolbar">
          <label>
            Concurso
            <select
              value={competitionId}
              onChange={(e) => {
                const id = e.target.value;
                guard(() => selectContest(id));
              }}
            >
              <option value="">Seleccionar concurso</option>
              {contests.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </option>
              ))}
            </select>
          </label>
          {contest && (
            <span className="badge">
              {stores.find((s) => s.id === contest.store_id)?.name || "Tienda"}{" "}
              ·{" "}
              {contest.status === "draft"
                ? "Borrador"
                : contest.status === "active"
                  ? "Activo"
                  : "Finalizado"}
            </span>
          )}
          <button
            disabled={busy}
            onClick={() => {
              void refresh();
              void loadContests();
            }}
          >
            Actualizar
          </button>
        </div>
        {(error || readError) && (
          <div role="alert" className="notice error">
            {error || readError}
          </div>
        )}
        {notice && (
          <p role="status" className="notice success">
            {notice}
          </p>
        )}
        {admin && (
          <details className="card">
            <summary>Crear concurso</summary>
            <form className="form" onSubmit={create}>
              <label>
                Nombre
                <input
                  name="name"
                  required
                  defaultValue="CONCURSO DE VELOCIDAD Y CALIDAD"
                  maxLength={160}
                />
              </label>
              <label>
                Tienda
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  required
                >
                  <option value="">Seleccionar…</option>
                  {stores
                    .filter(
                      (s) =>
                        s.is_active &&
                        (userRole === "superadmin" ||
                          s.id === userData.storeId),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <button className="primary" disabled={busy || Boolean(ongoing)}>
                Crear en borrador
              </button>
            </form>
          </details>
        )}
        {loading && <p role="status">Cargando concurso…</p>}
        {!competitionId && !loading && (
          <section className="card">
            <h2>No hay concursos disponibles</h2>
            <p>
              {admin
                ? "Cree el primer concurso para configurar equipos y áreas."
                : "Tu tienda todavía no ha publicado un concurso."}
            </p>
          </section>
        )}
        {contest && data && (
          <>
            <nav aria-label="Secciones del concurso">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? "active" : ""}
                  aria-current={tab === key ? "page" : undefined}
                  onClick={() => {
                    if (key !== tab) guard(() => setTab(key));
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="actions">
              <small className="muted">
                {connection === "SUBSCRIBED"
                  ? "● Actualización en vivo"
                  : "○ Conectando actualización en vivo · respaldo cada 15 s"}
              </small>
              {busy && <span role="status">Guardando…</span>}
            </div>
            <fieldset disabled={busy || Boolean(readError)}>
              {tab === "dashboard" && admin && <Statistics data={data} />}
              {tab === "teams" && admin && (
                <Teams
                  key={contest.id + staff.length}
                  {...{ data, contest, staff, execute }}
                />
              )}
              {tab === "participants" && admin && (
                <Participants {...{ data, contest, execute }} />
              )}
              {tab === "areas" && admin && (
                <Areas {...{ data, contest, execute }} />
              )}
              {tab === "config" && admin && (
                <Configuration
                  key={contest.updated_at}
                  {...{ data, contest, execute }}
                />
              )}
              {tab === "evaluate" && admin && (
                <CompetitionEvaluation
                  {...{
                    data,
                    contest,
                    clock,
                    execute,
                    evaluationId,
                    selectEvaluation,
                    guard,
                  }}
                  stale={Boolean(readError)}
                />
              )}
              {tab === "fixture" && (
                <Fixture
                  key={contest.id}
                  {...{ data, admin, contest, execute }}
                />
              )}
              {tab === "ranking" && <Rankings data={data} />}
              {tab === "mine" && (
                <MyCompetition data={data} staffId={userData.staffProfileId} />
              )}
              {tab === "registration" && !admin && (
                <CompetitionRegistration {...{ data, contest, execute }} staffId={userData.staffProfileId} />
              )}
              {tab === "history" && admin && (
                <History {...{ data, execute, contest }} />
              )}
            </fieldset>
          </>
        )}
        {leave && (
          <div
            className="overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Evaluación en curso"
          >
            <div className="modal">
              <h2>Hay una evaluación en curso.</h2>
              <p>
                El intento permanece guardado en el servidor. Para cambiar de
                pantalla, vuelva a la evaluación o cancele con un motivo.
              </p>
              <div className="actions">
                <button
                  className="primary"
                  onClick={() => {
                    setLeave(null);
                    setTab("evaluate");
                  }}
                >
                  VOLVER A EVALUACIÓN
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    const reason = window.prompt(
                      "Motivo obligatorio de cancelación:",
                    );
                    if (!reason?.trim()) return;
                    const action = leave;
                    if (
                      await execute("cancel", {
                        evaluation_id: evaluationId,
                        reason,
                      })
                    ) {
                      setLeave(null);
                      action();
                    }
                  }}
                >
                  CANCELAR EVALUACIÓN
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
