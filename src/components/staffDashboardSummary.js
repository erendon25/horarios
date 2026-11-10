import { isStaffActive } from './Training/staffStatus.js';

const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const getModality = (person) => normalize(person.modality).replace(/[-_\s]/g, '');

export const getStaffDashboardGroup = (person) => {
    if (person.isTrainee) return 'training';

    const position = normalize(person.position || person.cargo || person.jobTitle || person.role);
    if (/\basistente\b|\bassistant\b/.test(position)) return 'assistant';
    if (/\bgerente\b|\bjef[ea] de tienda\b|\bstore manager\b/.test(position)) return 'manager';

    const modality = getModality(person);
    if (['fulltime', 'ft'].includes(modality)) return 'fullTime';
    if (['parttime', 'pt'].includes(modality)) return 'partTime';
    return 'unassigned';
};

export const summarizeStaffDashboard = (staff, referenceDate = new Date()) => staff.reduce((summary, person) => {
    if (!isStaffActive(person, referenceDate)) return summary;

    const group = getStaffDashboardGroup(person);
    summary.total += 1;
    summary[group] += 1;
    if (group === 'training') {
        const modality = getModality(person);
        if (['fulltime', 'ft'].includes(modality)) summary.trainingFullTime += 1;
        if (['parttime', 'pt'].includes(modality)) summary.trainingPartTime += 1;
    }
    return summary;
}, {
    total: 0, manager: 0, assistant: 0, fullTime: 0, partTime: 0,
    training: 0, trainingFullTime: 0, trainingPartTime: 0, unassigned: 0,
});

export const sortStaffBySanitaryCard = (staff, direction) => {
    if (!['asc', 'desc'].includes(direction)) return staff;

    const expiryTime = (person) => {
        const value = person.sanitaryCardDate;
        if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const time = Date.parse(`${value}T00:00:00`);
        return Number.isFinite(time) ? time : null;
    };

    return [...staff].sort((left, right) => {
        const leftDate = expiryTime(left);
        const rightDate = expiryTime(right);
        // Las fechas pendientes siempre quedan al final, en ambos sentidos.
        if (leftDate === null && rightDate !== null) return 1;
        if (rightDate === null && leftDate !== null) return -1;
        if (leftDate !== rightDate) return (leftDate - rightDate) * (direction === 'asc' ? 1 : -1);
        return `${left.name || ''} ${left.lastName || ''}`.localeCompare(`${right.name || ''} ${right.lastName || ''}`, 'es');
    });
};
