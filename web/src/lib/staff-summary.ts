export type StaffSummaryRow = {
  status: string;
  cessation_date: string | null;
  modality: string | null;
  position: string | null;
};

export function isCurrentStaff(person: StaffSummaryRow, date: string) {
  if (person.cessation_date) return person.cessation_date > date;
  return person.status !== "inactive";
}

export function summarizeCurrentStaff(staff: StaffSummaryRow[], date: string) {
  const current = staff.filter((person) => isCurrentStaff(person, date));
  const trainers = current.filter((person) => person.position?.trim().toUpperCase() === "ENTRENADOR");
  const collaborators = current.filter((person) => person.position?.trim().toUpperCase() !== "ENTRENADOR");

  return {
    active: current.length,
    fullTime: collaborators.filter((person) => person.modality === "Full-Time").length,
    partTime: collaborators.filter((person) => person.modality === "Part-Time").length,
    trainers: trainers.length,
  };
}
