const parseLocalDate = (value) => {
    if (!value || typeof value !== 'string') return null;

    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
};

export const isStaffActive = (staff, referenceDate = new Date()) => {
    if (!staff) return false;

    const status = String(staff.status || '').trim().toLowerCase();
    if (status === 'inactive') return false;

    const normalizedName = `${staff.name || ''} ${staff.lastName || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    if (
        staff.reconstructed_from_history === true
        || staff.reconstructedFromHistory === true
        || normalizedName.startsWith('historico ')
    ) {
        return false;
    }

    const endDateValue = staff?.isTrainee
        ? staff.trainingEndDate
        : (staff?.cessationDate || staff?.terminationDate);

    if (!endDateValue) return true;

    const endDate = parseLocalDate(endDateValue);
    if (!endDate) return true;

    const today = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        referenceDate.getDate()
    );

    // El colaborador permanece activo durante su ultimo dia registrado.
    return endDate >= today;
};
