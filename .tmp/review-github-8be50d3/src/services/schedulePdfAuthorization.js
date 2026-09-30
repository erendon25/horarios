const PDF_DOWNLOAD_POSITIONS = new Set(['ENTRENADOR', 'ASISTENTE', 'GERENTE']);

const normalizePosition = (value) => String(value || '')
  .trim()
  .toUpperCase();

export const canDownloadSchedulePdf = ({ staffPosition } = {}) => (
  PDF_DOWNLOAD_POSITIONS.has(normalizePosition(staffPosition))
);
