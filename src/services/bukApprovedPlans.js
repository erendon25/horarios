import source from '../data/bukApprovedShifts.js';

// The two-rest-day plan credits 4:45 per day, including a paid 45-minute break.
// Keep the imported BUK ranges/codes unchanged. Other plans retain their rules.
export default source.map(shift => shift.group === 'PT2'
  ? { ...shift, breakMinutes: 45, breakIncludedInHours: true }
  : shift);
