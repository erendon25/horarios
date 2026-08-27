const normalizeState = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const limaToday = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(new Date());

export const isCurrentGeoVictoriaEpisode = (person, today = limaToday()) => {
    if (person?.cessationDate && person.cessationDate < today) return false;
    if (person?.isTrainee && person?.trainingEndDate && person.trainingEndDate < today) return false;
    return true;
};

export const isImportableGeoVictoriaState = (value) => {
    const state = normalizeState(value);
    if (!state) return true;
    return /^(?:activ[oa]|active|activad[oa])(?:$|[\s(/_-])/.test(state);
};
