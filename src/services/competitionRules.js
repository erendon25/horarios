export function formatCompetitionTime(ms) {
  const value = Math.max(0, Math.floor(Number(ms) || 0));
  return `${String(Math.floor(value / 60000)).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}.${String(Math.floor(value / 10) % 100).padStart(2, "0")}`;
}
export function timerElapsed(evaluation, clock, monotonicNow) {
  if (!evaluation) return 0;
  if (evaluation.duration_ms != null) return Number(evaluation.duration_ms);
  if (!evaluation.started_at || !clock) return 0;
  const end =
    evaluation.timer_status === "paused"
      ? Date.parse(evaluation.paused_at)
      : clock.serverMs + monotonicNow - clock.monotonicMs;
  return Math.max(
    0,
    end -
      Date.parse(evaluation.started_at) -
      Number(evaluation.paused_duration_ms),
  );
}
export function evaluationOutcome(
  quality,
  duration,
  minimum,
  maximum,
  critical,
) {
  if (!Number.isFinite(quality) || quality < 0 || quality > 100)
    return { approved: false, reason: "Calidad inválida" };
  if (
    duration == null ||
    !Number.isFinite(Number(duration)) ||
    Number(duration) < 0
  )
    return { approved: false, reason: "Cronómetro pendiente" };
  const reasons = [];
  if (critical) reasons.push("Error crítico");
  if (quality < minimum) reasons.push("Calidad insuficiente");
  if (duration > maximum) reasons.push("Tiempo excedido");
  return {
    approved: reasons.length === 0,
    reason: reasons.join(" · ") || "Cumple calidad y tiempo",
  };
}
export const normalizeCompetitionName = (name) =>
  String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
export const competitionStaffName = (staff) =>
  [staff.first_name, staff.last_name].filter(Boolean).join(" ").trim();
export function competitionLimaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function competitionStaffUnavailable(staff, today = competitionLimaDate()) {
  if (staff.status && !["active", "pending"].includes(staff.status))
    return "Perfil inactivo";
  if (staff.cessation_date && staff.cessation_date < today)
    return `Cese efectivo ${staff.cessation_date}`;
  return "";
}
export function matchCompetitionStaff(name, staff) {
  const matches = staff.filter(
    (s) =>
      !competitionStaffUnavailable(s) &&
      normalizeCompetitionName(competitionStaffName(s)) ===
      normalizeCompetitionName(name),
  );
  return matches.length === 1 ? matches[0].id : "";
}
export const INITIAL_TEAMS = [
  {
    name: "Equipo 1",
    trainer: "BRITANY CCALLE PUMA",
    members: [
      "Grace Malena Ramirez Paredes",
      "Kiara Mialy Nuñez Torres",
      "Rubi Britney Del Carpio Fernandez",
      "Sheyka Valeria Peña Cuno",
      "Roberto Nahuel Quispe Garate",
      "Fabrizio Andre Atencio Ancori",
    ],
  },
  {
    name: "Equipo 2",
    trainer: "CHRISTOPHER ALDAIR ZETA ESPINOZA",
    members: [
      "Jeremy Adrian Choque Paredes",
      "Jhan Pierr Banda Guillen",
      "Nahomy Nickoll Cutipa Apaza",
      "Rodrigo Alfredo Cornejo Pampa",
      "Edeshanye Mashiel Ccanahuiri Ccanahuiri",
      "Jorge Enrique Laos Pinto",
    ],
  },
  {
    name: "Equipo 3",
    trainer: "JOSE ANTONIO BAUTISTA URDAY",
    members: [
      "Edison Gabriel Choque Ccarita",
      "Rodrigo Raphael Chambi Callata",
      "Emanuel Eduardo Perez Carbajal",
      "Solange Magda Rosales Cayo",
      "Ingrid Marina Ballesteros Ramos",
      "Dayana Araceli Bonilla Flores",
    ],
  },
  {
    name: "Equipo 4",
    trainer: "MARIAFERNANDA GABRIELA MARQUEZ MEZA",
    members: [
      "Marisela Nashira Sanca Incio",
      "Miguel Sebastian Mascaraqui Monroy",
      "Fabiola Gutierrez Gutierrez",
      "Yesenia Raquel Isidro Vargas",
      "Margiori Mildret Cusirimay Torres",
      "Remy Khamir Chavez Carbajal",
    ],
  },
];
