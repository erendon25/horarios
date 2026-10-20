// These are the only channels that can receive suggestive-sales evaluations.
// Other report channels remain distinct so they still contribute to total sales.
export const SUGGESTIVE_EVALUATION_CHANNELS = Object.freeze(['SALÓN', 'DRIVE THRU', 'SERV. FILA', 'SERV. AUTO']);
export const DEFAULT_SUGGESTIVE_CHANNELS = Object.freeze(['SALÓN', 'SERV. FILA']);

const normalizedLabel = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().replace(/\s+/g, ' ').toUpperCase();
const aliases = new Map([
  ['SALON', 'SALÓN'], ['EN LOCAL', 'SALÓN'], ['LOCAL', 'SALÓN'],
  ['SERVICIO', 'SALÓN'], ['SERVICIO AL CLIENTE', 'SALÓN'],
  ['DRIVE THRU', 'DRIVE THRU'], ['DRIVE-THRU', 'DRIVE THRU'], ['DRIVETHRU', 'DRIVE THRU'], ['DRIVE', 'DRIVE THRU'],
  ['SERV FILA', 'SERV. FILA'], ['SERVICIO FILA', 'SERV. FILA'], ['SERVICIO EN FILA', 'SERV. FILA'], ['MODULO', 'SERV. FILA'],
  ['SERV AUTO', 'SERV. AUTO'], ['SERVICIO AUTO', 'SERV. AUTO'], ['SERVICIO AL AUTO', 'SERV. AUTO'], ['AUTO', 'SERV. AUTO'],
]);

export function normalizeReportChannel(value) {
  const label = normalizedLabel(value);
  return aliases.get(label.replace(/\./g, ' ').replace(/\s+/g, ' ').trim()) || label;
}

export function suggestiveChannelLabel(value) {
  const channel = normalizeReportChannel(value);
  return channel === 'SERV. FILA' ? 'Módulo (Serv. Fila)' : channel;
}

export const isEvaluableSuggestiveChannel = value => SUGGESTIVE_EVALUATION_CHANNELS.includes(normalizeReportChannel(value));

// Schedule exports can repeat a station as Salón#2. Those suffixes and spelling
// variants refer to the same station; they do not create additional channels.
export function suggestiveChannelForPosition(value) {
  const position = normalizedLabel(value).replace(/\s*#?\s*\d+$/, '').trim();
  const channel = normalizeReportChannel(position);
  if (SUGGESTIVE_EVALUATION_CHANNELS.includes(channel)) return channel;
  // Preserve the register aliases already used by the revenue planner.
  if (['PUNTO DE VENTA', 'CAJA', 'DESPACHADOR', 'PROMISE'].includes(position)) return 'SALÓN';
  return null;
}

// Keep all four choices visible, even when the uploaded reports have none of them.
// Old MÓDULO selections become SERV. FILA; unsupported selections are discarded.
// Position overrides are obsolete: each channel follows its own schedule station.
export function suggestiveChannelSettings(configured = []) {
  const selections = new Map();
  for (const value of Array.isArray(configured) ? configured : []) {
    const setting = typeof value === 'string' ? { id: value, enabled: true } : value;
    if (!setting || typeof setting !== 'object') continue;
    const id = normalizeReportChannel(setting.id);
    if (!SUGGESTIVE_EVALUATION_CHANNELS.includes(id)) continue;
    const previous = selections.get(id);
    selections.set(id, { id, enabled: Boolean(previous?.enabled || setting.enabled !== false) });
  }
  const hasConfiguration = Array.isArray(configured) && configured.length > 0;
  return SUGGESTIVE_EVALUATION_CHANNELS.map(id => selections.get(id)
    || { id, enabled: !hasConfiguration && DEFAULT_SUGGESTIVE_CHANNELS.includes(id) });
}
