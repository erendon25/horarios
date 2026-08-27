export const UNCLASSIFIED_SALES_CHANNEL = "SIN CLASIFICAR";

export const SALES_CHANNELS = ["SALÓN", "DELIVERY", "DRIVE THRU", "SERV. FILA", UNCLASSIFIED_SALES_CHANNEL] as const;

export function normalizeSalesChannel(value: unknown) {
  const channel = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es")
    .trim();

  if (/DELIVERY|RAPPI|PEDIDOS\s*YA|DIDI|UBER|CALL\s*CENTER/.test(channel)) return "DELIVERY";
  if (/DRIVE|AUTO/.test(channel)) return "DRIVE THRU";
  if (/FILA|MODULO/.test(channel)) return "SERV. FILA";
  if (/SALON|LOCAL|MESA|RESTAURANTE/.test(channel)) return "SALÓN";
  return UNCLASSIFIED_SALES_CHANNEL;
}
