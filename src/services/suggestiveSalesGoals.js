export const DIRECT_SALES_CHANNELS = ['SALÓN', 'DRIVE THRU', 'SERV. FILA'];
export const SUGGESTIVE_GOAL_CHANNELS = ['SALÓN'];
export const SUGGESTIVE_TRX_RULES = Object.freeze({ salonShare: 0.60, participation: 0.30 });
export const SUGGESTIVE_PRODUCT_SET = 'cheese-hazlo-v3';

export const SUGGESTIVE_PRODUCTS = [
  { id: 'cheeseBorder', label: 'Borde de queso', importName: 'VS Borde de queso', defaultTarget: 1147 },
  { id: 'hazloCanelitasV3', label: 'Hazlo CMB V3 Canelitas', importName: 'VS HAZLO CMB V3 CANELITAS', defaultTarget: 800 },
  { id: 'hazloCrazyV3', label: 'Hazlo CMB V3 Crazy', importName: 'VS HAZLO CMB V3 CRAZY', defaultTarget: 900 },
];

export const DEFAULT_SUGGESTIVE_TARGETS = Object.fromEntries(
  SUGGESTIVE_PRODUCTS.map((product) => [product.id, product.defaultTarget]),
);

export const DEFAULT_SUGGESTIVE_CHANNEL_RULES = Object.freeze({
  serviceWeightUplift: 0.30,
  moduleShare: 0.10,
});

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const BUSINESS_HOURS = [...Array.from({ length: 18 }, (_, index) => index + 6), 0, 1, 2, 3, 4, 5];

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export const normalizeLabel = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toUpperCase();

export function classifySuggestiveProduct(value) {
  const normalized = normalizeLabel(value);
  if (normalized === 'VS BORDE DE QUESO') return 'cheeseBorder';
  if (normalized === 'VS HAZLO CMB V3 CANELITAS') return 'hazloCanelitasV3';
  if (normalized === 'VS HAZLO CMB V3 CRAZY') return 'hazloCrazyV3';
  return null;
}

export function hasCurrentSuggestiveProducts(products) {
  return SUGGESTIVE_PRODUCTS.every(({ id }) => Object.hasOwn(object(products), id));
}

export function normalizeDirectSalesChannel(value) {
  const normalized = normalizeLabel(value);
  if (
    normalized.includes('DRIVER')
    || normalized.includes('REPARTIDOR')
    || normalized.includes('DELIVERY')
    || normalized.includes('MOTORIZADO')
  ) return null;
  if (normalized.includes('DRIVE') || normalized.includes('AUTO')) return 'DRIVE THRU';
  if (normalized.includes('FILA') || normalized.includes('MODULO')) return 'SERV. FILA';
  if (normalized.includes('LOCAL') || normalized.includes('SALON') || normalized.includes('SERVICIO')) return 'SALÓN';
  return null;
}

export function channelForPosition(value) {
  const normalized = normalizeLabel(value);
  if (
    normalized.includes('DRIVER')
    || normalized.includes('REPARTIDOR')
    || normalized.includes('DELIVERY')
    || normalized.includes('MOTORIZADO')
  ) return null;
  if (normalized.includes('DRIVE')) return 'DRIVE THRU';
  if (normalized.includes('MODULO')) return 'SERV. FILA';
  if (
    normalized.includes('SERVICIO')
    || normalized.includes('SALON')
    || normalized.includes('PUNTO DE VENTA')
    || normalized.includes('CAJA')
    || normalized.includes('DESPACHADOR')
    || normalized.includes('PROMISE')
  ) return 'SALÓN';
  return null;
}

export function channelDisplayName(channel) {
  if (channel === 'SALÓN') return 'Servicio';
  if (channel === 'SERV. FILA') return 'Módulo';
  return 'Drive Thru';
}

function isoDateParts(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  return { year, month, day };
}

function dateAtNoon(date) {
  const { year, month, day } = isoDateParts(date);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const value = dateAtNoon(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return isoDate(value);
}

function monthDates(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0, 12)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function mondayFor(date) {
  const value = dateAtNoon(date);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  const monday = isoDate(value);
  return `${monday}_to_${addDays(monday, 6)}`;
}

function numericHour(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null;
}

function numericQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function clockMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function overlapMinutes(start, end, hour) {
  const startMinutes = clockMinutes(start);
  const endMinutes = clockMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return 0;
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  if (endMinutes > startMinutes) {
    return Math.max(0, Math.min(hourEnd, endMinutes) - Math.max(hourStart, startMinutes));
  }
  if (hourStart >= startMinutes) return Math.max(0, Math.min(hourEnd, 1440) - Math.max(hourStart, startMinutes));
  if (hourStart < endMinutes) return Math.max(0, Math.min(hourEnd, endMinutes) - hourStart);
  return 0;
}

function scheduleCoverageMinutes(shift, hour) {
  if (!shift || shift.off || shift.feriado || shift.holiday) return 0;
  const first = overlapMinutes(shift.start, shift.end, hour);
  const second = shift.splitShift ? overlapMinutes(shift.start2, shift.end2, hour) : 0;
  return Math.min(60, first + second);
}

function scheduleLabel(shift) {
  const first = shift?.start && shift?.end ? `${shift.start}–${shift.end}` : '';
  const second = shift?.splitShift && shift?.start2 && shift?.end2 ? ` / ${shift.start2}–${shift.end2}` : '';
  return `${first}${second}` || 'Horario no disponible';
}

function staffName(person) {
  const name = [person?.name, person?.lastName].filter(Boolean).join(' ').trim();
  return name || person?.email || 'Colaborador sin nombre';
}

function historicalKey(weekday, hour, channel) {
  return `${weekday}|${hour}|${channel}`;
}

function buildHistoricalWeights(history) {
  const productWeights = Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, new Map()]));
  const productChannelTotals = Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [
    id,
    Object.fromEntries(DIRECT_SALES_CHANNELS.map((channel) => [channel, 0])),
  ]));
  const fallbackWeights = new Map();
  const fallbackTimeWeights = new Map();
  const fallbackChannelTotals = Object.fromEntries(DIRECT_SALES_CHANNELS.map((channel) => [channel, 0]));
  const totals = Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0]));
  const monthlyActual = {};
  const weekdayObservations = Object.fromEntries(Array.from({ length: 7 }, (_, weekday) => [weekday, 0]));
  let coveredDays = 0;

  for (const day of history || []) {
    const date = day.date || day.sales_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) continue;
    const weekday = dateAtNoon(date).getUTCDay();
    weekdayObservations[weekday] += 1;
    const products = object(day.suggestiveProducts || day.suggestive_products);
    if (SUGGESTIVE_PRODUCTS.some(({ id }) => Object.prototype.hasOwnProperty.call(products, id))) coveredDays += 1;

    for (const product of SUGGESTIVE_PRODUCTS) {
      const hourly = object(products[product.id]);
      for (const [hourKey, channels] of Object.entries(hourly)) {
        const hour = numericHour(hourKey);
        if (hour === null) continue;
        for (const [rawChannel, rawQuantity] of Object.entries(object(channels))) {
          const channel = normalizeDirectSalesChannel(rawChannel);
          const quantity = numericQuantity(rawQuantity);
          if (!channel || !quantity) continue;
          const key = historicalKey(weekday, hour, channel);
          productWeights[product.id].set(key, (productWeights[product.id].get(key) || 0) + quantity);
          productChannelTotals[product.id][channel] += quantity;
          totals[product.id] += quantity;
          monthlyActual[date.slice(0, 7)] ||= Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0]));
          monthlyActual[date.slice(0, 7)][product.id] += quantity;
        }
      }
    }

    const hourlyTransactions = object(day.hourlyTxs || day.hourly_transactions || object(day.source_data).hourlyTxs);
    for (const [hourKey, channels] of Object.entries(hourlyTransactions)) {
      const hour = numericHour(hourKey);
      if (hour === null) continue;
      for (const [rawChannel, rawCount] of Object.entries(object(channels))) {
        const channel = normalizeDirectSalesChannel(rawChannel);
        const count = numericQuantity(rawCount);
        if (!channel || !count) continue;
        const key = historicalKey(weekday, hour, channel);
        fallbackWeights.set(key, (fallbackWeights.get(key) || 0) + count);
        const timeKey = `${weekday}|${hour}`;
        fallbackTimeWeights.set(timeKey, (fallbackTimeWeights.get(timeKey) || 0) + count);
        fallbackChannelTotals[channel] += count;
      }
    }
  }

  for (const weights of [...Object.values(productWeights), fallbackWeights]) {
    for (const [key, value] of weights.entries()) {
      const weekday = Number(key.split('|', 1)[0]);
      const observations = weekdayObservations[weekday] || 1;
      weights.set(key, value / observations);
    }
  }

  for (const [key, value] of fallbackTimeWeights.entries()) {
    const weekday = Number(key.split('|', 1)[0]);
    fallbackTimeWeights.set(key, value / (weekdayObservations[weekday] || 1));
  }

  return {
    productWeights,
    productChannelTotals,
    fallbackWeights,
    fallbackTimeWeights,
    fallbackChannelTotals,
    totals,
    monthlyActual,
    coveredDays,
  };
}

function largestRemainder(total, weightedRows) {
  const target = Math.max(0, Math.round(Number(total) || 0));
  if (!weightedRows.length || !target) return weightedRows.map(() => 0);
  let weightTotal = weightedRows.reduce((sum, row) => sum + Math.max(0, row.weight), 0);
  const weights = weightTotal > 0 ? weightedRows.map((row) => Math.max(0, row.weight)) : weightedRows.map(() => 1);
  if (weightTotal <= 0) weightTotal = weights.length;
  const exact = weights.map((weight) => (target * weight) / weightTotal);
  const result = exact.map(Math.floor);
  let remaining = target - result.reduce((sum, value) => sum + value, 0);
  exact
    .map((value, index) => ({ index, remainder: value - result[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .slice(0, remaining)
    .forEach(({ index }) => { result[index] += 1; });
  return result;
}

function isOperationalStaff(person, date) {
  const status = normalizeLabel(person?.status);
  if (status === 'INACTIVE' || status === 'INACTIVO') return false;
  const normalizedName = normalizeLabel(`${person?.name || ''} ${person?.lastName || ''}`);
  if (person?.reconstructed_from_history === true || normalizedName.startsWith('HISTORICO ')) return false;
  const cessationDate = person?.cessationDate || person?.terminationDate;
  if (cessationDate && String(cessationDate).slice(0, 10) < date) return false;
  const joinDate = person?.joinDate;
  if (joinDate && String(joinDate).slice(0, 10) > date) return false;
  return true;
}

function slotAssignments({ date, hour, channel, schedulesByStaffWeek, staff }) {
  const weekKey = mondayFor(date);
  const weekday = WEEKDAYS[dateAtNoon(date).getUTCDay()];
  const assigned = [];
  for (const person of staff) {
    if (!isOperationalStaff(person, date)) continue;
    const shift = schedulesByStaffWeek.get(`${person.id}|${weekKey}`)?.[weekday];
    const coverageMinutes = scheduleCoverageMinutes(shift, hour);
    if (channelForPosition(shift?.position) !== channel || coverageMinutes <= 0) continue;
    assigned.push({
      assigneeId: person.id,
      assignee: staffName(person),
      schedule: scheduleLabel(shift),
      missingStaff: false,
      coverageMinutes,
    });
  }
  return assigned.length ? assigned : [{
    assigneeId: `unassigned:${date}:${hour}:${channel}`,
    assignee: 'Sin colaborador asignado',
    schedule: `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
    missingStaff: true,
    coverageMinutes: 60,
  }];
}

function combineAssignedRows(hourlyRows) {
  const grouped = new Map();
  for (const row of hourlyRows.filter((entry) => !entry.missingStaff)) {
    const key = `${row.date}|${row.assigneeId}|${row.channel}|${row.schedule}`;
    if (!grouped.has(key)) grouped.set(key, {
      ...row,
      goals: Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0])),
      hourlyGoals: {},
    });
    const target = grouped.get(key);
    for (const product of SUGGESTIVE_PRODUCTS) target.goals[product.id] += row.goals[product.id] || 0;
    target.hourlyGoals[row.hour] = Object.fromEntries(
      SUGGESTIVE_PRODUCTS.map(({ id }) => [id, row.goals[id] || 0]),
    );
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    coveredHours: Object.keys(row.hourlyGoals)
      .map(Number)
      .sort((left, right) => BUSINESS_HOURS.indexOf(left) - BUSINESS_HOURS.indexOf(right)),
  }));
}

function combineUnassignedRows(hourlyRows) {
  const byDateChannel = new Map();
  for (const row of hourlyRows.filter((entry) => entry.missingStaff)) {
    const key = `${row.date}|${row.channel}`;
    if (!byDateChannel.has(key)) byDateChannel.set(key, []);
    byDateChannel.get(key).push(row);
  }

  const result = [];
  for (const rows of byDateChannel.values()) {
    rows.sort((left, right) => BUSINESS_HOURS.indexOf(left.hour) - BUSINESS_HOURS.indexOf(right.hour));
    let current = null;
    for (const row of rows) {
      const position = BUSINESS_HOURS.indexOf(row.hour);
      const isContiguous = current && position === current.lastPosition + 1;
      if (!isContiguous) {
        if (current) result.push(current);
        current = {
          ...row,
          startHour: row.hour,
          endHour: (row.hour + 1) % 24,
          lastPosition: position,
          goals: { ...row.goals },
          hourlyGoals: {
            [row.hour]: Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, row.goals[id] || 0])),
          },
        };
      } else {
        current.endHour = (row.hour + 1) % 24;
        current.lastPosition = position;
        for (const product of SUGGESTIVE_PRODUCTS) current.goals[product.id] += row.goals[product.id] || 0;
        current.hourlyGoals[row.hour] = Object.fromEntries(
          SUGGESTIVE_PRODUCTS.map(({ id }) => [id, row.goals[id] || 0]),
        );
      }
    }
    if (current) result.push(current);
  }

  return result.map((row) => ({
    ...row,
    schedule: `${String(row.startHour).padStart(2, '0')}:00–${String(row.endHour).padStart(2, '0')}:00`,
    coveredHours: Object.keys(row.hourlyGoals)
      .map(Number)
      .sort((left, right) => BUSINESS_HOURS.indexOf(left) - BUSINESS_HOURS.indexOf(right)),
  }));
}

export function buildSuggestiveSalesPlan({
  history = [],
  schedules = [],
  staff = [],
  month,
  targets = DEFAULT_SUGGESTIVE_TARGETS,
  channelRules = DEFAULT_SUGGESTIVE_CHANNEL_RULES,
}) {
  const dates = monthDates(month);
  const historical = buildHistoricalWeights(history);
  const schedulesByStaffWeek = new Map();
  for (const schedule of schedules || []) {
    const staffId = schedule.staffId || schedule.staff_id;
    const weekKey = schedule.weekKey || schedule.week_key;
    if (staffId && weekKey) schedulesByStaffWeek.set(`${staffId}|${weekKey}`, schedule);
  }

  const hourlyRows = [];
  for (const date of dates) {
    const weekday = dateAtNoon(date).getUTCDay();
    for (const hour of BUSINESS_HOURS) {
      for (const channel of SUGGESTIVE_GOAL_CHANNELS) {
        const key = historicalKey(weekday, hour, channel);
        const productSlotWeights = Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, historical.productWeights[id].get(key) || 0]));
        const fallbackWeight = historical.fallbackWeights.get(key) || 0;
        const crossChannelFallbackWeight = historical.fallbackTimeWeights.get(`${weekday}|${hour}`) || 0;
        const hasHistoricalDemand = fallbackWeight > 0 || crossChannelFallbackWeight > 0 || Object.values(productSlotWeights).some((weight) => weight > 0);
        const assigned = slotAssignments({ date, hour, channel, schedulesByStaffWeek, staff });
        if (!hasHistoricalDemand && assigned.every((entry) => entry.missingStaff)) continue;
        const totalCoverage = assigned.reduce((sum, owner) => sum + owner.coverageMinutes, 0) || 60;
        for (const owner of assigned) {
          hourlyRows.push({
            ...owner,
            date,
            weekday,
            hour,
            channel,
            channelLabel: channelDisplayName(channel),
            weightShare: owner.coverageMinutes / totalCoverage,
            productSlotWeights,
            fallbackWeight,
            crossChannelFallbackWeight,
            goals: Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0])),
          });
        }
      }
    }
  }

  const channelTargets = {};
  const channelShares = {};
  for (const product of SUGGESTIVE_PRODUCTS) {
    const target = Math.max(0, Math.round(Number(targets[product.id]) || 0));
    channelShares[product.id] = { 'SALÓN': 1 };
    channelTargets[product.id] = { 'SALÓN': target };

    for (const channel of SUGGESTIVE_GOAL_CHANNELS) {
      const indices = hourlyRows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.channel === channel);
      const hasProductChannelHistory = historical.productChannelTotals[product.id][channel] > 0;
      const hasChannelTransactions = historical.fallbackChannelTotals[channel] > 0;
      const allocations = largestRemainder(channelTargets[product.id][channel], indices.map(({ row }) => ({
        weight: (
          hasProductChannelHistory
            ? row.productSlotWeights[product.id]
            : hasChannelTransactions ? row.fallbackWeight : row.crossChannelFallbackWeight
        ) * row.weightShare,
      })));
      allocations.forEach((value, index) => {
        hourlyRows[indices[index].index].goals[product.id] = value;
      });
    }
  }

  const rows = [...combineAssignedRows(hourlyRows), ...combineUnassignedRows(hourlyRows)]
    .filter((row) => Object.values(row.goals).some((value) => value > 0))
    .sort((left, right) => left.date.localeCompare(right.date)
      || BUSINESS_HOURS.indexOf(left.hour) - BUSINESS_HOURS.indexOf(right.hour)
      || left.channel.localeCompare(right.channel)
      || left.assignee.localeCompare(right.assignee));

  const monthDayCount = dates.length;
  const actual = historical.monthlyActual[month] || Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0]));
  const summaries = SUGGESTIVE_PRODUCTS.map((product) => {
    const target = Math.max(0, Math.round(Number(targets[product.id]) || 0));
    const baseline = historical.coveredDays > 0 ? (historical.totals[product.id] / historical.coveredDays) * monthDayCount : 0;
    return {
      ...product,
      target,
      actual: actual[product.id] || 0,
      gap: Math.max(0, target - (actual[product.id] || 0)),
      baseline,
      uplift: baseline > 0 ? ((target / baseline) - 1) * 100 : null,
      hasHistory: historical.totals[product.id] > 0,
    };
  });

  const unassignedGoals = Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0]));
  rows.filter((row) => row.missingStaff).forEach((row) => {
    SUGGESTIVE_PRODUCTS.forEach(({ id }) => { unassignedGoals[id] += row.goals[id] || 0; });
  });

  return {
    month,
    coveredDays: historical.coveredDays,
    rows,
    summaries,
    channelRules: {
      serviceWeightUplift: Number(channelRules?.serviceWeightUplift ?? DEFAULT_SUGGESTIVE_CHANNEL_RULES.serviceWeightUplift),
      moduleShare: Number(channelRules?.moduleShare ?? DEFAULT_SUGGESTIVE_CHANNEL_RULES.moduleShare),
    },
    channelShares,
    channelTargets,
    unassignedRows: rows.filter((row) => row.missingStaff).length,
    unassignedGoals,
    totals: Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, rows.reduce((sum, row) => sum + (row.goals[id] || 0), 0)])),
  };
}

const emptyGoals = () => Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, 0]));
const validCount = (value) => value !== '' && value !== null && value !== undefined
  && Number.isFinite(Number(value)) && Number(value) >= 0;
const totalOf = (values) => Object.values(values).reduce((sum, value) => sum + value, 0);

function transactionHours(day, salonOnly = false) {
  const result = {};
  const hours = object(day?.hourlyTxs || day?.hourly_transactions || day?.source_data?.hourlyTxs);
  for (const [key, channels] of Object.entries(hours)) {
    const hour = numericHour(key);
    if (hour === null) continue;
    result[hour] = Object.entries(object(channels)).reduce((sum, [channel, count]) => (
      sum + ((!salonOnly || normalizeDirectSalesChannel(channel) === 'SALÓN') ? numericQuantity(count) : 0)
    ), 0);
  }
  return result;
}

function salonProducts(day) {
  const result = emptyGoals();
  const products = object(day?.suggestiveProducts || day?.suggestive_products);
  for (const { id } of SUGGESTIVE_PRODUCTS) {
    for (const channels of Object.values(object(products[id]))) {
      for (const [channel, quantity] of Object.entries(object(channels))) {
        if (normalizeDirectSalesChannel(channel) === 'SALÓN') result[id] += numericQuantity(quantity);
      }
    }
  }
  return result;
}

// Share each minute among the people actually covering it. A 15-minute shift
// cannot inherit the entire hourly target; the uncovered part stays unassigned.
function transactionOwners({ date, hour, staff, schedulesByStaffWeek }) {
  const weekday = WEEKDAYS[dateAtNoon(date).getUTCDay()];
  const candidates = staff.flatMap((person) => {
    const shift = schedulesByStaffWeek.get(`${person.id}|${mondayFor(date)}`)?.[weekday];
    if (!isOperationalStaff(person, date) || channelForPosition(shift?.position) !== 'SALÓN'
      || scheduleCoverageMinutes(shift, hour) <= 0) return [];
    return [{ assigneeId: person.id, assignee: staffName(person), schedule: scheduleLabel(shift),
      shift, missingStaff: false, weight: 0 }];
  });
  const covers = (start, end, minute) => {
    const a = clockMinutes(start);
    const b = clockMinutes(end);
    if (a === null || b === null || a === b) return false;
    return b > a ? minute >= a && minute < b : minute >= a || minute < b;
  };
  let missingMinutes = 0;
  for (let minute = hour * 60; minute < (hour + 1) * 60; minute += 1) {
    const active = candidates.filter(({ shift }) => covers(shift.start, shift.end, minute)
      || (shift.splitShift && covers(shift.start2, shift.end2, minute)));
    if (!active.length) missingMinutes += 1;
    else active.forEach((owner) => { owner.weight += 1 / active.length; });
  }
  const result = candidates.map(({ shift, ...owner }) => owner);
  if (missingMinutes) result.push({
    assigneeId: `unassigned:${date}:${hour}:SALÓN`, assignee: 'Sin colaborador asignado',
    schedule: `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
    missingStaff: true, weight: missingMinutes,
  });
  return result;
}

/** 30 combined suggestive units per 100 estimated SALÓN transactions. */
export function buildTransactionSuggestiveSalesPlan({
  history = [], schedules = [], staff = [], monthlyData = {}, month,
  salonShare = SUGGESTIVE_TRX_RULES.salonShare,
  participation = SUGGESTIVE_TRX_RULES.participation,
}) {
  if (![salonShare, participation].every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 1)) {
    throw new Error('Los porcentajes deben estar entre 0% y 100%.');
  }
  const dates = monthDates(month);
  const records = [...new Map(history.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date || day.sales_date))
    .map((day) => [day.date || day.sales_date, { ...day, date: day.date || day.sales_date }])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
  const schedulesByStaffWeek = new Map(schedules.map((schedule) => [
    `${schedule.staffId || schedule.staff_id}|${schedule.weekKey || schedule.week_key}`, schedule,
  ]));
  const byDate = new Map(records.map((day) => [day.date, day]));
  const targets = emptyGoals();
  const actual = emptyGoals();
  const daily = [];
  const hourlyRows = [];
  const untimedRows = [];
  let measuredSalonTrx = 0;
  let skuDays = 0;

  for (const date of dates) {
    const weekday = dateAtNoon(date).getUTCDay();
    const recorded = byDate.get(date);
    const configured = monthlyData[date]?.txs ?? monthlyData[Number(date.slice(-2))]?.txs;
    const past = records.filter((day) => day.date < date).slice(-56);
    const sameWeekday = past.filter((day) => dateAtNoon(day.date).getUTCDay() === weekday);
    const samples = (sameWeekday.length ? sameWeekday : past)
      .filter((day) => validCount(day.totalTxs ?? day.transactions));
    let transactions = null;
    let transactionSource = 'missing';
    if (validCount(recorded?.totalTxs ?? recorded?.transactions)) {
      transactions = Number(recorded.totalTxs ?? recorded.transactions);
      transactionSource = 'recorded';
    } else if (validCount(configured)) {
      transactions = Number(configured);
      transactionSource = 'configured';
    } else if (samples.length) {
      transactions = samples.reduce((sum, day) => sum + Number(day.totalTxs ?? day.transactions), 0) / samples.length;
      transactionSource = 'estimated';
    }
    const salonTransactions = transactions === null ? null : transactions * salonShare;
    const totalGoal = salonTransactions === null ? 0 : Math.max(0, Math.ceil(salonTransactions * participation - 1e-9));

    // Product mix only selects how the combined goal is split; it never sets
    // the combined volume. Exclude other channels and future observations.
    const completeHistory = past.filter((day) => hasCurrentSuggestiveProducts(day.suggestiveProducts || day.suggestive_products));
    const productHistory = completeHistory.length ? completeHistory
      : recorded && hasCurrentSuggestiveProducts(recorded.suggestiveProducts || recorded.suggestive_products) ? [recorded] : [];
    const productWeights = emptyGoals();
    productHistory.forEach((day) => {
      const quantities = salonProducts(day);
      SUGGESTIVE_PRODUCTS.forEach(({ id }) => { productWeights[id] += quantities[id]; });
    });
    const mixSource = totalOf(productWeights) > 0 ? 'salon-history' : 'equal';
    const productQuotas = largestRemainder(totalGoal, SUGGESTIVE_PRODUCTS.map(({ id }) => ({ weight: productWeights[id] })));
    const goals = Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }, index) => [id, productQuotas[index]]));
    SUGGESTIVE_PRODUCTS.forEach(({ id }) => { targets[id] += goals[id]; });

    const recordedProducts = object(recorded?.suggestiveProducts || recorded?.suggestive_products);
    const hasSkuData = hasCurrentSuggestiveProducts(recordedProducts);
    if (hasSkuData && transactionSource === 'recorded') {
      const quantities = salonProducts(recorded);
      SUGGESTIVE_PRODUCTS.forEach(({ id }) => { actual[id] += quantities[id]; });
      measuredSalonTrx += salonTransactions;
      skuDays += 1;
    }

    let hours = transactionHours(recorded, true);
    let hourSource = 'recorded-salon';
    if (totalOf(hours) <= 0) {
      hours = {};
      const hourSamples = sameWeekday.length ? sameWeekday : past;
      hourSamples.forEach((day) => Object.entries(transactionHours(day, true)).forEach(([hour, count]) => {
        hours[hour] = (hours[hour] || 0) + count;
      }));
      hourSource = 'historical-salon';
    }
    if (totalOf(hours) <= 0) {
      hours = transactionHours(recorded);
      if (totalOf(hours) <= 0) {
        (sameWeekday.length ? sameWeekday : past).forEach((day) => {
          Object.entries(transactionHours(day)).forEach(([hour, count]) => {
            hours[hour] = (hours[hour] || 0) + count;
          });
        });
      }
      hourSource = totalOf(hours) > 0 ? 'store-fallback' : 'missing';
    }
    daily.push({ date, transactions, salonTransactions, totalGoal, goals, transactionSource, mixSource, hourSource });
    if (!totalGoal) continue;
    const hourKeys = BUSINESS_HOURS.filter((hour) => hours[hour] > 0);
    if (!hourKeys.length) {
      untimedRows.push({ date, weekday, hour: 6, channel: 'SALÓN', channelLabel: 'Salón',
        assigneeId: `unassigned:${date}`, assignee: 'Sin colaborador asignado', missingStaff: true,
        schedule: 'Sin detalle de TRX por hora', goals, hourlyGoals: {}, coveredHours: [] });
      continue;
    }
    const hourTotals = largestRemainder(totalGoal, hourKeys.map((hour) => ({ weight: hours[hour] })));
    // Respect both the daily SKU quotas and the hourly combined quota.
    const remaining = { ...goals };
    hourKeys.forEach((hour, hourIndex) => {
      const hourProducts = largestRemainder(hourTotals[hourIndex], SUGGESTIVE_PRODUCTS.map(({ id }) => ({ weight: remaining[id] })));
      SUGGESTIVE_PRODUCTS.forEach(({ id }, index) => { remaining[id] -= hourProducts[index]; });
      const owners = transactionOwners({ date, hour, staff, schedulesByStaffWeek });
      const ownerTotals = largestRemainder(hourTotals[hourIndex], owners);
      const remainingHour = [...hourProducts];
      owners.forEach((owner, ownerIndex) => {
        const quotas = largestRemainder(ownerTotals[ownerIndex], remainingHour.map((weight) => ({ weight })));
        quotas.forEach((count, index) => { remainingHour[index] -= count; });
        hourlyRows.push({ ...owner, date, weekday, hour, channel: 'SALÓN', channelLabel: 'Salón',
          goals: Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }, index) => [id, quotas[index]])) });
      });
    });
  }
  const rows = [...combineAssignedRows(hourlyRows), ...combineUnassignedRows(hourlyRows), ...untimedRows]
    .filter((row) => totalOf(row.goals) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || BUSINESS_HOURS.indexOf(a.hour) - BUSINESS_HOURS.indexOf(b.hour));
  const unassignedGoals = emptyGoals();
  rows.filter((row) => row.missingStaff).forEach((row) => {
    SUGGESTIVE_PRODUCTS.forEach(({ id }) => { unassignedGoals[id] += row.goals[id]; });
  });
  const totalGoal = totalOf(targets);
  return {
    month, rows, daily, targets, totals: targets, coveredDays: skuDays,
    channelTargets: Object.fromEntries(SUGGESTIVE_PRODUCTS.map(({ id }) => [id, { 'SALÓN': targets[id] }])),
    unassignedGoals, unassignedRows: rows.filter((row) => row.missingStaff).length,
    summaries: SUGGESTIVE_PRODUCTS.map((product) => ({ ...product, target: targets[product.id],
      actual: actual[product.id], gap: Math.max(0, targets[product.id] - actual[product.id]),
      hasHistory: skuDays > 0, mixShare: totalGoal > 0 ? targets[product.id] / totalGoal : 0 })),
    metrics: {
      salonShare, participation, totalGoal,
      totalTransactions: daily.reduce((sum, day) => sum + (day.transactions || 0), 0),
      salonTransactions: daily.reduce((sum, day) => sum + (day.salonTransactions || 0), 0),
      actualUnits: totalOf(actual), measuredSalonTrx,
      actualParticipation: measuredSalonTrx > 0 ? totalOf(actual) / measuredSalonTrx : null,
      estimatedDays: daily.filter((day) => day.transactionSource === 'estimated').length,
      missingDays: daily.filter((day) => day.transactionSource === 'missing').length,
      untimedDays: untimedRows.length,
      equalMixDays: daily.filter((day) => day.totalGoal > 0 && day.mixSource === 'equal').length,
    },
  };
}
