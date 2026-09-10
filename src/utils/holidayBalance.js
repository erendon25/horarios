// The profile stores the opening balance; earned/compensated days are movements.
export function getHolidayBalance(profile, movements = []) {
  const opening = Number(profile?.holidayBalance ?? profile?.feriados ?? 0);
  const pending = Array.isArray(profile?.pendingHolidays) ? profile.pendingHolidays.length : 0;
  return (Number.isFinite(opening) ? opening : 0) + pending + movements.reduce(
    (total, movement) => total + (movement.type === 'compensado' ? -1 : movement.type === 'ganado' ? 1 : 0), 0,
  );
}
