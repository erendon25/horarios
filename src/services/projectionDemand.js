const normalizePositionName = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

const isMissing = (value) => value === undefined || value === null
  || (typeof value === 'string' && value.trim() === '');

const nonnegativeNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

// Discover legacy data once. A stored identity remains authoritative after a
// rename; deleting or explicitly clearing it must never select another area.
export const resolveVestidoPositionId = (positions = [], storedId) => {
  if (storedId !== undefined) {
    return typeof storedId === 'string' && storedId !== ''
      && positions.some((position) => position.id === storedId) ? storedId : '';
  }

  const legacy = positions.find((position) => position.id === 'cocina');
  const named = positions.filter((position) => normalizePositionName(position.name) === 'vestido');
  if (named.length > 1 || (legacy && named.length === 1 && named[0].id !== legacy.id)) return '';
  const discovered = legacy ?? named[0];
  return typeof discovered?.id === 'string' ? discovered.id : '';
};

const salesReferenceFactor = (position) => {
  const identity = normalizePositionName(`${position.id ?? ''} ${position.name ?? ''}`);
  if (identity.includes('sheetout')) return 0.7;
  if (identity.includes('masa')) return 0.55;
  if (identity.includes('landing')) return 0.5;
  return 1;
};

// Vestido itself is allocated by sale/VHL in projectionVhl. Only dependent
// production areas use its final count; service, drivers and fixed staff retain
// their own formulas and do not depend on the existence of a Vestido area.
export const getProjectionPositionDemand = (position, { sale = 0, vestidoStaff = 0 } = {}) => {
  const normalizedSale = nonnegativeNumber(sale);
  const factor = isMissing(position.factor)
    ? position.logic === 'sales' ? salesReferenceFactor(position) : 0
    : nonnegativeNumber(position.factor);

  if (position.logic === 'fixed') return nonnegativeNumber(position.fixedStaff);

  if (position.logic === 'service') {
    const ticket = nonnegativeNumber(position.ticketAverage);
    const transactions = nonnegativeNumber(position.transactionsPerCollaborator);
    return ticket > 0 && transactions > 0
      ? nonnegativeNumber(((normalizedSale / ticket) / transactions) * factor) : 0;
  }

  if (position.logic === 'driver') {
    const ticket = nonnegativeNumber(position.ticketAverage);
    const productsPerDriverHour = 9 * (60 / 12);
    return ticket > 0
      ? nonnegativeNumber((normalizedSale / ticket / productsPerDriverHour) * factor) : 0;
  }

  if (position.logic === 'sales') {
    return nonnegativeNumber(nonnegativeNumber(vestidoStaff) * factor);
  }
  return 0;
};
