import { useCallback, useEffect, useRef, useState } from "react";
import {
  readAll,
  readCompetition,
  subscribeCompetition,
  synchronizeCompetitionClock,
} from "../services/competition";

export function useCompetition(id, admin) {
  const [state, setState] = useState({
    data: null,
    contest: null,
    loading: true,
    error: "",
  });
  const [clock, setClock] = useState(null);
  const [connection, setConnection] = useState("CONNECTING");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!id) {
      setState({ data: null, contest: null, loading: false, error: "" });
      return;
    }
    try {
      const [data, contests, synchronized] = await Promise.all([
        readCompetition(id, admin),
        readAll("competitions", { id }),
        synchronizeCompetitionClock(),
      ]);
      if (request !== generation.current) return;
      setState({ data, contest: contests[0], loading: false, error: "" });
      setClock(synchronized);
    } catch (error) {
      if (request === generation.current)
        setState((s) => ({
          ...s,
          loading: false,
          error: error.message || "No se pudo actualizar el concurso",
        }));
    }
  }, [id, admin]);
  useEffect(() => {
    setState({ data: null, contest: null, loading: true, error: "" });
    setClock(null);
    void refresh();
    if (!id) return;
    let timer;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 120);
    };
    const unsubscribe = subscribeCompetition(id, changed, (status) => {
      setConnection(status);
      if (status === "SUBSCRIBED") changed();
    });
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("online", visible);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    const fallback = setInterval(visible, 15000);
    return () => {
      ++generation.current;
      unsubscribe();
      clearTimeout(timer);
      clearInterval(fallback);
      window.removeEventListener("online", visible);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [id, refresh]);
  return { ...state, clock, connection, refresh };
}
