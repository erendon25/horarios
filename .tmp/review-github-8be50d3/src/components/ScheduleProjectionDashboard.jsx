import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, Calculator, CheckCircle, RefreshCw, Settings, Users } from 'lucide-react';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where } from '../lib/supabase/firestoreCompat';
import { db } from '../supabase';
import {
  buildProjectionSalesByDay,
  selectLatestCompleteSalesWeek,
} from '../services/salesProjectionHistory';
import {
  calculatePositionStaffByGeneralVhl,
  calculateHistoricalGeneralVhl,
} from '../services/projectionVhl';

const DEFAULT_TOTAL_CAPACITY = 780;
const DEFAULT_TICKET_AVERAGE = 35;
const DEFAULT_TRANSACTIONS_PER_COLLABORATOR = 23;
const DEFAULT_DRIVER_PRODUCTS_PER_TRIP = 9;
const DEFAULT_DRIVER_ROUND_TRIP_MINUTES = 12;

const DAYS = [
  { key: 'lunes', label: 'Lunes' },
  { key: 'martes', label: 'Martes' },
  { key: 'miercoles', label: 'Miercoles' },
  { key: 'jueves', label: 'Jueves' },
  { key: 'viernes', label: 'Viernes' },
  { key: 'sabado', label: 'Sabado' },
  { key: 'domingo', label: 'Domingo' },
];

const DAY_TO_WEEKDAY = {
  lunes: 'monday',
  martes: 'tuesday',
  miercoles: 'wednesday',
  jueves: 'thursday',
  viernes: 'friday',
  sabado: 'saturday',
  domingo: 'sunday',
};

const DEFAULT_POSITIONS = [
  { id: 'cocina', name: 'Cocina', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 1, minStaff: 1 },
  { id: 'sheetout', name: 'Sheetout', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 0.7, minStaff: 1 },
  { id: 'masa', name: 'Masa', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 0.55, maxStaff: 2 },
  { id: 'landing', name: 'Landing', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 0.5, minStaff: 1 },
  {
    id: 'salon',
    name: 'Salón',
    logic: 'service',
    ticketAverage: DEFAULT_TICKET_AVERAGE,
    transactionsPerCollaborator: DEFAULT_TRANSACTIONS_PER_COLLABORATOR,
    factor: 1,
    minStaff: 1,
  },
  {
    id: 'punto_venta',
    name: 'Módulo',
    logic: 'service',
    ticketAverage: DEFAULT_TICKET_AVERAGE,
    transactionsPerCollaborator: DEFAULT_TRANSACTIONS_PER_COLLABORATOR,
    factor: 1,
    minStaff: 1,
  },
  {
    id: 'drivethru',
    name: 'Drivethru',
    logic: 'service',
    ticketAverage: DEFAULT_TICKET_AVERAGE,
    transactionsPerCollaborator: DEFAULT_TRANSACTIONS_PER_COLLABORATOR,
    factor: 1,
    minStaff: 1,
  },
  {
    id: 'driver_modulo',
    name: 'Driver',
    logic: 'driver',
    ticketAverage: DEFAULT_TICKET_AVERAGE,
    factor: 1,
  },
  { id: 'limpieza', name: 'Limpieza', logic: 'fixed', fixedStaff: 1 },
  { id: 'horno', name: 'Horno', logic: 'fixed', fixedStaff: 1 },
  { id: 'lavado', name: 'Lavado', logic: 'fixed', fixedStaff: 1 },
  { id: 'do_sheet', name: 'Do Sheet', logic: 'fixed', fixedStaff: 1 },
];

const FULL_HOURS_RANGE = Array.from({ length: 21 }, (_, i) => {
  const h = (8 + i) % 24;
  return `${h.toString().padStart(2, '0')}:00`;
});

// Rango máximo permitido (referencia excel VHL: 8am → 1am del día siguiente = 17h)
const MAX_ALLOWED_HOURS = FULL_HOURS_RANGE.slice(0, 17);

// Rango por defecto cuando aún no hay histórico cargado
const DEFAULT_OPERATIVE_RANGE = FULL_HOURS_RANGE.slice(2, 17); // 10am → 12am

const detectOperativeHours = (salesByDay) => {
  if (!salesByDay || typeof salesByDay !== 'object') return DEFAULT_OPERATIVE_RANGE;
  const activeHours = new Set();
  Object.values(salesByDay).forEach((hourMap) => {
    if (!hourMap) return;
    Object.entries(hourMap).forEach(([hour, value]) => {
      if (Number(value) > 0) activeHours.add(hour);
    });
  });
  if (activeHours.size === 0) return DEFAULT_OPERATIVE_RANGE;
  const firstIndex = MAX_ALLOWED_HOURS.findIndex((h) => activeHours.has(h));
  let lastIndex = -1;
  for (let i = MAX_ALLOWED_HOURS.length - 1; i >= 0; i--) {
    if (activeHours.has(MAX_ALLOWED_HOURS[i])) { lastIndex = i; break; }
  }
  if (firstIndex === -1 || lastIndex === -1) return DEFAULT_OPERATIVE_RANGE;
  // Buffer: 1 hora antes para prep y 1 después para cierre (dentro del máximo permitido)
  const start = Math.max(0, firstIndex - 1);
  const end = Math.min(MAX_ALLOWED_HOURS.length - 1, lastIndex + 1);
  return MAX_ALLOWED_HOURS.slice(start, end + 1);
};

const LOGIC_LABELS = {
  sales: 'VHL × factor',
  service: 'Servicio / punto de venta',
  driver: 'Driver modulo',
  fixed: 'Fijo / no venta',
};

const createEmptyHourlySales = (hourKeys = MAX_ALLOWED_HOURS) =>
  hourKeys.reduce((acc, h) => ({ ...acc, [h]: 0 }), {});

const createEmptySalesByDay = (hourKeys = MAX_ALLOWED_HOURS) =>
  DAYS.reduce((acc, day) => ({ ...acc, [day.key]: createEmptyHourlySales(hourKeys) }), {});

const getNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const makeStoredPosition = (position) => ({
  ...position,
  capacity: position.capacity ?? '',
  ticketAverage: position.ticketAverage ?? '',
  transactionsPerCollaborator: position.transactionsPerCollaborator ?? '',
  factor: position.factor ?? '',
  fixedStaff: position.fixedStaff ?? '',
  maxStaff: position.maxStaff ?? '',
  minStaff: position.minStaff ?? '',
});

const normalizeName = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

const mergeDefaultFixedPositions = (storedPositions = []) => {
  const stored = storedPositions.map(makeStoredPosition);
  const existingIds = new Set(stored.map((position) => position.id));
  const existingNames = new Set(stored.map((position) => normalizeName(position.name)));
  const missingDefaults = DEFAULT_POSITIONS
    .filter((position) => {
      const isFixed = position.logic === 'fixed';
      const isServiceDefault = ['salon', 'drivethru', 'punto_venta'].includes(position.id);
      if (!isFixed && !isServiceDefault) return false;
      if (existingIds.has(position.id)) return false;
      if (existingNames.has(normalizeName(position.name))) return false;
      return true;
    })
    .map(makeStoredPosition);

  return [...stored, ...missingDefaults];
};

const compressRows = (rows) =>
  Object.fromEntries(
    rows.map((row, rowIndex) => [
      rowIndex,
      Object.fromEntries(row.map((value, columnIndex) => [columnIndex, value])),
    ])
  );

const formatDate = (isoDate) => {
  if (!isoDate) return '-';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};

export default function ScheduleProjectionDashboard({ staffList = [], storeId, refreshToken = 0 }) {
  const [salesByDay, setSalesByDay] = useState(createEmptySalesByDay);
  const [projectedSalesByDay, setProjectedSalesByDay] = useState(
    () => DAYS.reduce((acc, day) => ({ ...acc, [day.key]: 0 }), {})
  );
  const [selectedDay, setSelectedDay] = useState('lunes');
  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [manualStaffByDay, setManualStaffByDay] = useState({});
  const [isPositionsModalOpen, setIsPositionsModalOpen] = useState(false);
  const [isHoursBreakdownOpen, setIsHoursBreakdownOpen] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [salesHistoryLoaded, setSalesHistoryLoaded] = useState(false);
  const [salesHistoryLoading, setSalesHistoryLoading] = useState(false);
  const [salesHistoryError, setSalesHistoryError] = useState('');
  const [salesSource, setSalesSource] = useState(null);
  const [latestAvailableWeek, setLatestAvailableWeek] = useState(null);
  const [generalVhl, setGeneralVhl] = useState(null);
  const [historicalGeneralVhl, setHistoricalGeneralVhl] = useState(null);
  const [historicalLaborHours, setHistoricalLaborHours] = useState(0);
  const [isGeneralVhlManual, setIsGeneralVhlManual] = useState(false);
  const [vhlLoaded, setVhlLoaded] = useState(false);
  const [vhlLoading, setVhlLoading] = useState(false);
  const [vhlError, setVhlError] = useState('');
  const [dataRefreshVersion, setDataRefreshVersion] = useState(0);
  const saveTimerRef = useRef(null);
  const [newPosition, setNewPosition] = useState({
    name: '',
    logic: 'sales',
    capacity: DEFAULT_TOTAL_CAPACITY,
    ticketAverage: DEFAULT_TICKET_AVERAGE,
    transactionsPerCollaborator: DEFAULT_TRANSACTIONS_PER_COLLABORATOR,
    factor: 1,
    fixedStaff: 1,
    maxStaff: '',
    minStaff: '',
  });

  useEffect(() => {
    if (!storeId) return;

    let cancelled = false;
    const loadProjectionConfig = async () => {
      setConfigLoaded(false);
      try {
        const ref = doc(db, 'stores', storeId, 'config', 'schedule_projection');
        const snap = await getDoc(ref);
        if (cancelled) return;

        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.positions)) {
            setPositions(mergeDefaultFixedPositions(data.positions));
          }
          if (data.manualStaffByDay) {
            setManualStaffByDay(data.manualStaffByDay);
          }
          if (Number(data.generalVhl) > 0) {
            setGeneralVhl(Number(data.generalVhl));
          }
          setIsGeneralVhlManual(data.generalVhlMode === 'manual');
        }
      } catch (error) {
        console.error('Error al cargar configuracion de proyeccion:', error);
      } finally {
        if (!cancelled) setConfigLoaded(true);
      }
    };

    loadProjectionConfig();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;

    let cancelled = false;
    const loadLatestCompleteSalesWeek = async () => {
      setSalesHistoryLoaded(false);
      setSalesHistoryLoading(true);
      setSalesHistoryError('');

      try {
        const historyQuery = query(
          collection(db, 'stores', storeId, 'sales_history'),
          orderBy('__name__', 'desc')
        );
        const snapshot = await getDocs(historyQuery);
        const records = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));
        const result = selectLatestCompleteSalesWeek(records);

        if (cancelled) return;
        setLatestAvailableWeek(result.latestAvailableWeek);

        if (!result.selectedWeek) {
          setSalesByDay(createEmptySalesByDay());
          setSalesSource(null);
          setSalesHistoryError('No existe una semana de ventas con los 7 dias cargados.');
          return;
        }

        setSalesByDay(buildProjectionSalesByDay(result.selectedWeek, MAX_ALLOWED_HOURS));
        setSalesSource(result.selectedWeek);
      } catch (error) {
        if (cancelled) return;
        console.error('Error al cargar el historico completo de ventas:', error);
        setSalesHistoryError('No se pudo cargar la semana completa desde Analisis de Ventas.');
      } finally {
        if (!cancelled) {
          setSalesHistoryLoading(false);
          setSalesHistoryLoaded(true);
        }
      }
    };

    loadLatestCompleteSalesWeek();
    return () => {
      cancelled = true;
    };
  }, [storeId, refreshToken, dataRefreshVersion]);

  useEffect(() => {
    if (!storeId || !salesSource || !configLoaded) return;

    let cancelled = false;
    const loadHistoricalGeneralVhl = async () => {
      setVhlLoaded(false);
      setVhlLoading(true);
      setVhlError('');

      try {
        const weekKey = `${salesSource.weekStart}_to_${salesSource.weekEnd}`;
        const scheduleQuery = query(
          collection(db, 'schedules'),
          where('storeId', '==', storeId),
          where('weekKey', '==', weekKey)
        );
        const snapshot = await getDocs(scheduleQuery);
        const schedules = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));
        const metrics = calculateHistoricalGeneralVhl({
          totalSales: salesSource.totalSales,
          schedules,
          staff: staffList,
        });

        if (cancelled) return;
        setHistoricalLaborHours(metrics.totalHours);
        setHistoricalGeneralVhl(metrics.generalVhl || null);

        if (metrics.generalVhl > 0 && !isGeneralVhlManual) {
          setGeneralVhl(metrics.generalVhl);
        }

        if (!(metrics.generalVhl > 0)) {
          setVhlError('No se encontraron horas programadas para calcular el VHL general historico.');
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Error al calcular el VHL general historico:', error);
        setVhlError('No se pudo calcular el VHL general de la semana historica.');
      } finally {
        if (!cancelled) {
          setVhlLoading(false);
          setVhlLoaded(true);
        }
      }
    };

    loadHistoricalGeneralVhl();
    return () => {
      cancelled = true;
    };
  }, [
    storeId,
    salesSource,
    configLoaded,
    staffList,
    isGeneralVhlManual,
    refreshToken,
    dataRefreshVersion,
  ]);

  useEffect(() => {
    if (!storeId) return;

    let cancelled = false;
    const loadProjectedSales = async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const monday = new Date(today);
        monday.setDate(today.getDate() + (today.getDay() === 0 ? -6 : 1 - today.getDay()));

        const dates = DAYS.map((day, index) => {
          const date = new Date(monday);
          date.setDate(monday.getDate() + index);
          return { ...day, date };
        });
        const months = [...new Set(dates.map(({ date }) =>
          `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        ))];
        const snapshots = await Promise.all(
          months.map((month) => getDoc(doc(db, 'stores', storeId, 'sales_config', month)))
        );
        const configs = Object.fromEntries(
          months.map((month, index) => [month, snapshots[index].exists() ? snapshots[index].data() : {}])
        );

        const projected = dates.reduce((acc, { key, date }) => {
          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          const rawValue = configs[month]?.monthlyData?.[date.getDate()]?.vta;
          const normalized = String(rawValue ?? '').replace(/[^\d.,-]/g, '');
          let value = Number(normalized);
          if (!Number.isFinite(value)) {
            const lastSeparator = Math.max(normalized.lastIndexOf(','), normalized.lastIndexOf('.'));
            const integerPart = normalized.slice(0, lastSeparator).replace(/[.,]/g, '');
            const decimalPart = normalized.slice(lastSeparator + 1);
            value = Number(`${integerPart}.${decimalPart}`);
          }
          acc[key] = Number.isFinite(value) ? value : 0;
          return acc;
        }, {});

        if (!cancelled) setProjectedSalesByDay(projected);
      } catch (error) {
        console.error('Error al cargar ventas proyectadas:', error);
      }
    };

    loadProjectedSales();
    return () => {
      cancelled = true;
    };
  }, [storeId, refreshToken, dataRefreshVersion]);

  const availableHoursBreakdown = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isTraineeFlag = (member) =>
      member?.isTrainee === true || member?.isTrainee === 'true' || member?.isTrainee === 1;
    const isFullTime = (member) =>
      member.modality === 'Full Time' ||
      member.modality === 'Full-Time' ||
      member.contractType?.includes?.('Full');
    const isPartTime = (member) =>
      member.modality === 'Part Time' ||
      member.modality === 'Part-Time' ||
      member.contractType?.includes?.('Part');

    const buckets = {
      fullTime: [],
      partTime: [],
      traineeVencido: [],
      cesados: [],
      inactivos: [],
      sinModalidad: [],
    };

    staffList.forEach((member) => {
      const normalizedName = `${member.name || ''} ${member.lastName || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
      const displayName = normalizedName || member.email || member.id || 's/nombre';
      const isTrainee = isTraineeFlag(member);
      const entry = {
        id: member.id,
        name: displayName,
        modality: member.modality || member.contractType || '\u2014',
        isTrainee,
      };

      if (
        member.status === 'inactive' ||
        member.reconstructed_from_history === true ||
        displayName.toLowerCase().startsWith('historico ')
      ) {
        buckets.inactivos.push(entry);
        return;
      }
      if (member.cessationDate) {
        const cess = new Date(member.cessationDate + 'T00:00:00');
        if (cess < today) {
          buckets.cesados.push({ ...entry, cessationDate: member.cessationDate });
          return;
        }
      }
      if (isTrainee && member.trainingEndDate) {
        const end = new Date(member.trainingEndDate + 'T00:00:00');
        if (end < today) {
          buckets.traineeVencido.push({ ...entry, trainingEndDate: member.trainingEndDate });
          return;
        }
      }
      if (isFullTime(member)) {
        buckets.fullTime.push({ ...entry, hours: 48 });
        return;
      }
      if (isPartTime(member)) {
        buckets.partTime.push({ ...entry, hours: 24 });
        return;
      }
      buckets.sinModalidad.push(entry);
    });

    const totalHours =
      buckets.fullTime.length * 48 + buckets.partTime.length * 24;

    return { ...buckets, totalHours };
  }, [staffList]);

  const totalAvailableHours = availableHoursBreakdown.totalHours;

  const historicalDailyTotals = useMemo(() => {
    return DAYS.reduce((totals, day) => {
      const hourlySales = salesByDay[day.key] || {};
      totals[day.key] = Object.values(hourlySales).reduce(
        (sum, value) => sum + (Number(value) || 0),
        0
      );
      return totals;
    }, {});
  }, [salesByDay]);

  const operativeHours = useMemo(() => detectOperativeHours(salesByDay), [salesByDay]);
  const operativeHoursSet = useMemo(() => new Set(operativeHours), [operativeHours]);

  const calculationSalesByDay = useMemo(() => {
    return DAYS.reduce((result, day) => {
      const historicalHours = salesByDay[day.key] || createEmptyHourlySales(operativeHours);
      const historicalTotal = historicalDailyTotals[day.key] || 0;
      const projectedTotal = Number(projectedSalesByDay[day.key]) || 0;
      const calculationTotal = projectedTotal > 0 ? projectedTotal : historicalTotal;
      const scale = historicalTotal > 0 ? calculationTotal / historicalTotal : 0;

      result[day.key] = Object.fromEntries(
        operativeHours.map((hour) => [hour, (Number(historicalHours[hour]) || 0) * scale])
      );
      return result;
    }, {});
  }, [historicalDailyTotals, projectedSalesByDay, salesByDay, operativeHours]);

  const calculateRequiredStaff = (sale, position) => {
    if (!sale && position.logic !== 'fixed') return 0;

    if (position.logic === 'service') {
      const ticketAverage = getNumber(position.ticketAverage);
      const transactionsPerCollaborator = getNumber(position.transactionsPerCollaborator);
      const factor = getNumber(position.factor);
      if (!ticketAverage || !transactionsPerCollaborator || factor === null) return 0;
      return ((sale / ticketAverage) / transactionsPerCollaborator) * factor;
    }

    if (position.logic === 'driver') {
      const ticketAverage = getNumber(position.ticketAverage);
      const factor = getNumber(position.factor);
      if (!ticketAverage || factor === null) return 0;

      const estimatedProducts = sale / ticketAverage;
      const tripsPerHour = 60 / DEFAULT_DRIVER_ROUND_TRIP_MINUTES;
      const productsPerDriverHour = DEFAULT_DRIVER_PRODUCTS_PER_TRIP * tripsPerHour;
      return (estimatedProducts / productsPerDriverHour) * factor;
    }

    if (position.logic === 'fixed') {
      return getNumber(position.fixedStaff) || 0;
    }

    const vhl = getNumber(generalVhl);
    const normalizedPosition = `${position.id || ''} ${position.name || ''}`.toLowerCase();
    const configuredFactor = getNumber(position.factor);
    const referenceFactor = normalizedPosition.includes('sheetout')
      ? 0.7
      : normalizedPosition.includes('masa')
        ? 0.55
        : normalizedPosition.includes('landing')
          ? 0.5
          : 1;
    const factor = configuredFactor ?? referenceFactor;
    if (!vhl) return 0;

    const demand = (sale / vhl) * factor;
    const configuredMaximum = getNumber(position.maxStaff);
    const maximum = configuredMaximum ?? (normalizedPosition.includes('masa') ? 2 : null);
    return maximum === null ? demand : Math.min(demand, maximum);
  };

  const buildScheduleMatrix = (hourlySales, dayKey) => {
    let totalRequiredHours = 0;

    const columns = operativeHours.map((hour) => {
      const sale = hourlySales[hour] || 0;
      const manualByPosition = Object.fromEntries(
        positions
          .map((position) => [position.id, manualStaffByDay?.[dayKey]?.[position.id]?.[hour]])
          .filter(([, value]) => value !== undefined)
      );
      const allocation = calculatePositionStaffByGeneralVhl({
        sale,
        generalVhl,
        positions,
        manualByPosition,
        getPositionDemand: (position) => calculateRequiredStaff(sale, position),
        isOperativeHour: operativeHoursSet.has(hour),
      });
      const { generalRequiredStaff, requiredByPosition, totalStaffAtHour } = allocation;

      totalRequiredHours += totalStaffAtHour;

      return {
        hour,
        sale,
        generalRequiredStaff,
        requiredByPosition,
        totalStaffAtHour,
      };
    });

    return { columns, totalRequiredHours };
  };

  const buildProjectionRequirements = () => {
    return DAYS.reduce((acc, day) => {
      const hourlySales = calculationSalesByDay[day.key] || createEmptyHourlySales(operativeHours);
      const matrix = buildScheduleMatrix(hourlySales, day.key);
      const rows = positions.map((position) =>
        operativeHours.map((hour) => {
          const column = matrix.columns.find((col) => col.hour === hour);
          return column?.requiredByPosition[position.id] || 0;
        })
      );

      acc[DAY_TO_WEEKDAY[day.key]] = {
        positions: positions.map((position) => position.name),
        matrix: compressRows(rows),
      };

      return acc;
    }, {});
  };

  useEffect(() => {
    if (
      !storeId ||
      !configLoaded ||
      !salesHistoryLoaded ||
      !salesSource ||
      !vhlLoaded ||
      !(Number(generalVhl) > 0)
    ) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    setSaveState('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        const ref = doc(db, 'stores', storeId, 'config', 'schedule_projection');
        await setDoc(
          ref,
          {
            positions,
            requirements: buildProjectionRequirements(),
            salesByDay,
            generalVhl: Number(generalVhl),
            generalVhlMode: isGeneralVhlManual ? 'manual' : 'historical',
            historicalGeneralVhl,
            historicalLaborHours,
            salesSource: {
              weekStart: salesSource.weekStart,
              weekEnd: salesSource.weekEnd,
              storedDays: salesSource.storedDays,
            },
            manualStaffByDay,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        setSaveState('saved');
      } catch (error) {
        console.error('Error al guardar configuracion de proyeccion:', error);
        setSaveState('error');
      }
    }, 700);

    return () => clearTimeout(saveTimerRef.current);
  }, [
    positions,
    salesByDay,
    calculationSalesByDay,
    manualStaffByDay,
    storeId,
    configLoaded,
    salesHistoryLoaded,
    salesSource,
    generalVhl,
    historicalGeneralVhl,
    historicalLaborHours,
    isGeneralVhlManual,
    vhlLoaded,
  ]);

  const scheduleMatrix = useMemo(
    () => buildScheduleMatrix(calculationSalesByDay[selectedDay] || createEmptyHourlySales(), selectedDay),
    [calculationSalesByDay, selectedDay, positions, manualStaffByDay, generalVhl]
  );

  const calculationDailyTotals = useMemo(() => {
    return DAYS.reduce((acc, day) => {
      const hourlySales = calculationSalesByDay[day.key] || {};
      acc[day.key] = Object.values(hourlySales).reduce((sum, value) => sum + (Number(value) || 0), 0);
      return acc;
    }, {});
  }, [calculationSalesByDay]);

  const selectedDaySales = historicalDailyTotals[selectedDay] || 0;
  const selectedDayProjectedSales = projectedSalesByDay[selectedDay] || 0;
  const selectedDayCalculationSales = calculationDailyTotals[selectedDay] || 0;
  const weeklyCalculationSales = Object.values(calculationDailyTotals).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0
  );
  const selectedDayRequiredHours = scheduleMatrix.totalRequiredHours;
  const selectedDayPeakStaff = Math.max(
    ...scheduleMatrix.columns.map((column) => column.totalStaffAtHour),
    0
  );

  const weeklyRequiredHours = useMemo(() => {
    return DAYS.reduce((sum, day) => {
      const matrix = buildScheduleMatrix(
        calculationSalesByDay[day.key] || createEmptyHourlySales(),
        day.key
      );
      return sum + matrix.totalRequiredHours;
    }, 0);
  }, [calculationSalesByDay, positions, manualStaffByDay, generalVhl]);

  const resultingGeneralVhl = weeklyRequiredHours > 0
    ? weeklyCalculationSales / weeklyRequiredHours
    : 0;

  const availableHourBalance = totalAvailableHours - weeklyRequiredHours;
  const hasHourDeficit = availableHourBalance < 0;

  const updatePosition = (id, changes) => {
    setPositions((prev) =>
      prev.map((position) => (position.id === id ? { ...position, ...changes } : position))
    );
  };

  const handleStaffCellClick = (event, positionId, hour, currentValue) => {
    const change = event.ctrlKey || event.metaKey ? -1 : 1;
    const nextValue = Math.max(0, currentValue + change);

    setManualStaffByDay((prev) => ({
      ...prev,
      [selectedDay]: {
        ...(prev[selectedDay] || {}),
        [positionId]: {
          ...(prev[selectedDay]?.[positionId] || {}),
          [hour]: nextValue,
        },
      },
    }));
  };

  const handleAddPosition = () => {
    if (!newPosition.name.trim()) return;
    setPositions((prev) => [
      ...prev,
      {
        ...newPosition,
        id: `custom_${Date.now()}`,
        name: newPosition.name.trim(),
      },
    ]);
    setNewPosition((prev) => ({ ...prev, name: '' }));
  };

  const handleRemovePosition = (id) => {
    setPositions((prev) => prev.filter((position) => position.id !== id));
  };

  return (
    <div className="p-6 bg-slate-50 min-h-screen text-slate-800 font-sans">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Calculator className="text-orange-500 w-7 h-7" />
            Matriz de Proyeccion Horaria (THL MISTI)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Calcula la dotacion total con el VHL general y la distribuye por hora, dia, area y tipo de operacion.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setIsPositionsModalOpen(true)}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-sm transition flex items-center gap-2 border border-slate-300"
          >
            <Settings className="w-4 h-4" />
            Configurar Posiciones
          </button>
          <span className={`px-3 py-2 rounded-lg text-xs font-bold border ${
            saveState === 'error'
              ? 'bg-red-50 text-red-700 border-red-200'
              : saveState === 'saving'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {saveState === 'saving' ? 'Guardando...' : saveState === 'error' ? 'Error al guardar' : 'Guardado'}
          </span>

          <button
            type="button"
            onClick={() => setDataRefreshVersion((current) => current + 1)}
            disabled={salesHistoryLoading}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-medium rounded-lg text-sm transition flex items-center gap-2 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${salesHistoryLoading ? 'animate-spin' : ''}`} />
            Actualizar ventas
          </button>
        </div>
      </div>

      <div className={`mb-6 rounded-xl border px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 ${
        salesHistoryError
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-blue-200 bg-blue-50 text-blue-900'
      }`}>
        <div className="flex items-start gap-3">
          <CalendarRange className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-black">
              {salesHistoryLoading
                ? 'Buscando la semana completa mas reciente...'
                : salesHistoryError
                  ? salesHistoryError
                  : `Historico aplicado: ${formatDate(salesSource?.weekStart)} - ${formatDate(salesSource?.weekEnd)}`}
            </p>
            {!salesHistoryLoading && salesSource ? (
              <p className="text-xs mt-1 opacity-80">
                7 dias consolidados · Venta S/. {salesSource.totalSales.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {' · '}{salesSource.totalTransactions.toLocaleString('es-PE')} transacciones
                {historicalGeneralVhl > 0 ? ` · VHL general S/. ${historicalGeneralVhl.toFixed(2)}` : ''}
                {historicalLaborHours > 0 ? ` · ${historicalLaborHours.toFixed(2)} HH` : ''}
                {operativeHours.length > 0 ? ` · Rango operativo: ${operativeHours[0]} – ${operativeHours[operativeHours.length - 1]}` : ''}
              </p>
            ) : null}
            {!vhlLoading && vhlError ? (
              <p className="text-xs mt-1 font-bold text-red-700">{vhlError}</p>
            ) : null}
          </div>
        </div>

        {!salesHistoryLoading && latestAvailableWeek && !latestAvailableWeek.isComplete && latestAvailableWeek.weekStart > (salesSource?.weekStart ?? '') ? (
          <span className="inline-flex rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            Semana {formatDate(latestAvailableWeek.weekStart)} - {formatDate(latestAvailableWeek.weekEnd)} pendiente: {latestAvailableWeek.storedDays}/7 dias
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-6 mb-6">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-lg">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <span className="text-sm text-slate-500 block font-medium">Venta Real del Dia</span>
            <span className="text-2xl font-bold text-slate-900">S/. {selectedDaySales.toFixed(2)}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-emerald-200 flex items-center gap-4">
          <div className="p-3 bg-emerald-100 text-emerald-600 rounded-lg">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <span className="text-sm text-slate-500 block font-medium">Venta Base del Dia</span>
            <span className="text-2xl font-bold text-emerald-700">S/. {selectedDayCalculationSales.toFixed(2)}</span>
            <span className="text-xs text-slate-400 block mt-0.5">
              {selectedDayProjectedSales > 0 ? 'Proyeccion configurada' : 'Distribucion historica aplicada'}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-amber-100 text-amber-600 rounded-lg">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <span className="text-sm text-slate-500 block font-medium">Venta Semanal de Calculo</span>
            <span className="text-2xl font-bold text-slate-900">S/. {weeklyCalculationSales.toFixed(2)}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-violet-200 flex items-center gap-4">
          <div className="p-3 bg-violet-100 text-violet-600 rounded-lg">
            <Calculator className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="general-vhl" className="text-sm text-slate-500 block font-medium">
                VHL General (S/.)
              </label>
              <span className="text-[10px] font-black uppercase tracking-wide text-violet-600">
                {isGeneralVhlManual ? 'Manual' : 'Historico'}
              </span>
            </div>
            <input
              id="general-vhl"
              type="number"
              min="0.01"
              step="0.01"
              value={generalVhl ?? ''}
              disabled={vhlLoading}
              onChange={(event) => {
                setIsGeneralVhlManual(true);
                setGeneralVhl(event.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xl font-bold text-violet-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 disabled:opacity-60"
              aria-describedby="general-vhl-help"
            />
            <div id="general-vhl-help" className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
              <span>{vhlLoading ? 'Calculando...' : 'Base = venta/hora ÷ VHL'}</span>
              {isGeneralVhlManual && historicalGeneralVhl > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsGeneralVhlManual(false);
                    setGeneralVhl(historicalGeneralVhl);
                  }}
                  className="font-bold text-violet-600 hover:text-violet-800"
                >
                  Usar S/. {historicalGeneralVhl.toFixed(2)}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
            <Users className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-sm text-slate-500 block font-medium">Bolsa de Horas Disponibles</span>
            <span className="text-2xl font-bold text-slate-900">
              {totalAvailableHours} hrs <span className="text-xs text-slate-400 font-normal">/semana</span>
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded bg-blue-100 text-blue-800 px-1.5 py-0.5 font-bold">
                {availableHoursBreakdown.fullTime.length} FT × 48
              </span>
              <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 font-bold">
                {availableHoursBreakdown.partTime.length} PT × 24
              </span>
              <button
                type="button"
                onClick={() => setIsHoursBreakdownOpen(true)}
                className="text-blue-700 hover:text-blue-900 underline text-[11px] font-bold"
              >
                Ver desglose
              </button>
            </div>
          </div>
        </div>

        <div className={`p-5 rounded-xl shadow-sm border flex items-center gap-4 ${
          hasHourDeficit
            ? 'bg-red-50 border-red-200 text-red-900'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
        }`}>
          <div className={`p-3 rounded-lg ${
            hasHourDeficit ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'
          }`}>
            {hasHourDeficit ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle className="w-6 h-6" />}
          </div>
          <div>
            <span className="text-sm opacity-80 block font-medium">Horas Teoricas Requeridas</span>
            <span className="text-2xl font-bold">{weeklyRequiredHours.toFixed(0)} hrs</span>
            <span className="text-xs block mt-0.5 font-bold opacity-80">
              VHL resultante S/. {resultingGeneralVhl.toFixed(2)}
            </span>
            <span className="text-xs block mt-0.5 opacity-70">
              {hasHourDeficit
                ? `Faltan ${Math.abs(availableHourBalance).toFixed(0)} hrs: reasigna personal o programa horas extras.`
                : availableHourBalance > 0
                  ? `Quedan ${availableHourBalance.toFixed(0)} hrs para asignar tareas adicionales.`
                  : 'Las horas disponibles cubren exactamente el requerimiento.'}
            </span>
          </div>
        </div>
      </div>

      <div className={`mb-6 rounded-xl border px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 ${
        hasHourDeficit
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}>
        <div className="flex items-center gap-2 font-bold">
          {hasHourDeficit ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
          Balance semanal de horas
        </div>
        <div className="text-sm font-black">
          {totalAvailableHours.toFixed(0)} hrs disponibles − {weeklyRequiredHours.toFixed(0)} hrs requeridas ={' '}
          <span className="text-lg">
            {availableHourBalance > 0 ? '+' : ''}{availableHourBalance.toFixed(0)} hrs
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 p-2 flex flex-wrap gap-2">
        {DAYS.map((day) => (
          <button
            key={day.key}
            type="button"
            onClick={() => setSelectedDay(day.key)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
              selectedDay === day.key
                ? 'bg-orange-600 text-white shadow-sm'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>{day.label}</span>
            <span className="ml-2 text-xs opacity-80">
              Real S/. {(historicalDailyTotals[day.key] || 0).toFixed(0)}
            </span>
            <span className="ml-2 text-xs opacity-80">
              Base S/. {(calculationDailyTotals[day.key] || 0).toFixed(0)}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-semibold text-slate-900">Distribucion de Personal e Ingresos por Hora</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            La base por hora es venta / VHL. Cada posicion aplica su propio factor sobre esa base y se redondea a personas completas.
            Las posiciones fijas y los ajustes manuales se conservan.
            Haz clic para sumar una persona y Ctrl + clic para restarla.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 uppercase text-[11px] font-bold tracking-wider border-b border-slate-200">
                <th className="p-4 min-w-[220px] bg-slate-100 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Area / Posicion / Parametro</th>
                <th className="p-4 text-center bg-slate-200/60 font-bold text-slate-900">Logica</th>
                {scheduleMatrix.columns.map((col) => (
                  <th key={col.hour} className="p-3 text-center min-w-[95px]">{col.hour}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              <tr className="bg-orange-50/60 font-semibold text-orange-950">
                <td className="p-4 sticky left-0 bg-orange-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                  Venta base por Hora (S/.)
                </td>
                <td className="p-4 text-center bg-orange-100/40">-</td>
                {scheduleMatrix.columns.map((col) => (
                  <td key={col.hour} className="p-3 text-center text-orange-700 font-bold">
                    S/. {col.sale.toFixed(0)}
                  </td>
                ))}
              </tr>

              {positions.map((position) => (
                <tr key={position.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-4 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 font-medium text-slate-700">
                    {position.name}
                  </td>
                  <td className="p-3 text-center bg-slate-50 text-xs font-bold text-slate-600">
                    {LOGIC_LABELS[position.logic]}
                  </td>
                  {scheduleMatrix.columns.map((col) => {
                    const requiredStaff = col.requiredByPosition[position.id] || 0;
                    return (
                      <td
                        key={col.hour}
                        onClick={(event) =>
                          handleStaffCellClick(event, position.id, col.hour, requiredStaff)
                        }
                        title="Asignacion de esta posicion. Clic: sumar | Ctrl + clic: restar"
                        className={`p-3 text-center font-bold transition-all cursor-pointer select-none hover:ring-2 hover:ring-inset hover:ring-orange-400 ${
                          requiredStaff > 2
                            ? 'bg-red-100 text-red-700'
                            : requiredStaff > 0
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-slate-300 font-normal'
                        }`}
                      >
                        {requiredStaff}
                      </td>
                    );
                  })}
                </tr>
              ))}

              <tr className="bg-slate-800 text-white font-semibold">
                <td className="p-4 sticky left-0 bg-slate-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.2)] z-10">
                  Total Colaboradores Requeridos
                </td>
                <td className="p-4 text-center bg-slate-900">-</td>
                {scheduleMatrix.columns.map((col) => (
                  <td
                    key={col.hour}
                    title={`Base venta ÷ VHL: ${col.generalRequiredStaff.toFixed(2)} · Total asignado: ${col.totalStaffAtHour}`}
                    className={`p-3 text-center font-extrabold ${
                      col.totalStaffAtHour > 5 ? 'text-amber-400' : 'text-white'
                    }`}
                  >
                    {col.totalStaffAtHour}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {isHoursBreakdownOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h4 className="font-bold text-slate-900">Desglose de Bolsa de Horas</h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Total: {totalAvailableHours} hrs · {availableHoursBreakdown.fullTime.length} FT + {availableHoursBreakdown.partTime.length} PT
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsHoursBreakdownOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                x
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              {[
                { key: 'fullTime', label: 'Full Time', color: 'bg-blue-50 text-blue-800 border-blue-200', bucket: availableHoursBreakdown.fullTime },
                { key: 'partTime', label: 'Part Time', color: 'bg-emerald-50 text-emerald-800 border-emerald-200', bucket: availableHoursBreakdown.partTime },
                { key: 'traineeVencido', label: 'Trainees vencidos (excluidos)', color: 'bg-purple-50 text-purple-800 border-purple-200', bucket: availableHoursBreakdown.traineeVencido },
                { key: 'sinModalidad', label: 'Sin modalidad (excluidos)', color: 'bg-amber-50 text-amber-800 border-amber-200', bucket: availableHoursBreakdown.sinModalidad },
                { key: 'cesados', label: 'Cesados (excluidos)', color: 'bg-red-50 text-red-800 border-red-200', bucket: availableHoursBreakdown.cesados },
                { key: 'inactivos', label: 'Inactivos / históricos (excluidos)', color: 'bg-slate-50 text-slate-500 border-slate-200', bucket: availableHoursBreakdown.inactivos },
              ].map(({ key, label, color, bucket }) => (
                <div key={key} className={`border rounded-lg ${color}`}>
                  <div className="px-3 py-2 font-bold text-sm border-b border-current/10 flex justify-between">
                    <span>{label}</span>
                    <span>{bucket.length}</span>
                  </div>
                  {bucket.length > 0 ? (
                    <ul className="px-3 py-2 text-xs space-y-1 max-h-52 overflow-y-auto">
                      {bucket.map((entry) => (
                        <li key={entry.id} className="flex justify-between gap-3">
                          <span className="truncate">
                            {entry.name}
                            {entry.isTrainee ? <span className="ml-1 text-[9px] uppercase px-1 py-0.5 rounded bg-amber-200 text-amber-900 font-bold">trainee</span> : null}
                          </span>
                          <span className="text-[10px] uppercase opacity-75 shrink-0">
                            {entry.modality}{entry.hours ? ` · ${entry.hours}h` : ''}{entry.cessationDate ? ` · cese ${entry.cessationDate}` : ''}{entry.trainingEndDate ? ` · fin trainee ${entry.trainingEndDate}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-3 py-2 text-[11px] italic opacity-70">Sin registros</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isPositionsModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-5xl w-full max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h4 className="font-bold text-slate-900">Configurar Posiciones de la Tienda</h4>
              <button
                type="button"
                onClick={() => setIsPositionsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                x
              </button>
            </div>

            <div className="p-5 space-y-5 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-[11px] uppercase font-bold text-slate-400">Dia seleccionado</span>
                  <p className="text-lg font-black text-slate-900">{DAYS.find((day) => day.key === selectedDay)?.label}</p>
                </div>
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                  <span className="text-[11px] uppercase font-bold text-orange-500">Horas requeridas</span>
                  <p className="text-lg font-black text-orange-700">{selectedDayRequiredHours.toFixed(0)} hrs</p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <span className="text-[11px] uppercase font-bold text-blue-500">Pico de personal</span>
                  <p className="text-lg font-black text-blue-700">{selectedDayPeakStaff} colab.</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1180px] text-sm">
                  <colgroup>
                    <col className="w-[20%]" />
                    <col className="w-[16%]" />
                    <col className="w-[7%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[11%]" />
                    <col className="w-[8%]" />
                    <col className="w-[7%]" />
                    <col className="w-[6%]" />
                    <col className="w-[5%]" />
                  </colgroup>
                  <thead className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-black">Posicion</th>
                      <th className="px-3 py-2 text-left font-black">Logica</th>
                      <th className="px-3 py-2 text-left font-black" title="Mínimo por hora operativa">Mín</th>
                      <th className="px-3 py-2 text-left font-black">Tope / Fijo</th>
                      <th className="px-3 py-2 text-left font-black">Ticket</th>
                      <th className="px-3 py-2 text-left font-black">Trx/colab</th>
                      <th className="px-3 py-2 text-left font-black">Factor</th>
                      <th className="px-3 py-2 text-center font-black">Hrs dia</th>
                      <th className="px-3 py-2 text-center font-black">Pico</th>
                      <th className="px-3 py-2 text-left font-black"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {positions.map((position) => {
                      const liveValues = scheduleMatrix.columns.map((col) => col.requiredByPosition[position.id] || 0);
                      const liveHours = liveValues.reduce((sum, value) => sum + value, 0);
                      const livePeak = Math.max(0, ...liveValues);

                      return (
                        <tr key={position.id} className="align-middle">
                          <td className="p-2">
                            <input
                              type="text"
                              value={position.name}
                              onChange={(e) => updatePosition(position.id, { name: e.target.value })}
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold"
                            />
                          </td>
                          <td className="p-2">
                            <select
                              value={position.logic}
                              onChange={(e) => updatePosition(position.id, { logic: e.target.value })}
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                            >
                            <option value="sales">VHL general × factor</option>
                            <option value="service">Servicio / punto de venta</option>
                            <option value="driver">Driver modulo</option>
                            <option value="fixed">Fijo / no venta</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={position.minStaff ?? ''}
                              onChange={(e) => updatePosition(position.id, { minStaff: e.target.value })}
                              disabled={position.logic === 'fixed'}
                              placeholder="0"
                              title="Mínimo por hora operativa"
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="0"
                              value={position.logic === 'fixed' ? position.fixedStaff ?? '' : position.maxStaff ?? ''}
                              onChange={(e) =>
                                updatePosition(
                                  position.id,
                                  position.logic === 'fixed'
                                    ? { fixedStaff: e.target.value }
                                    : { maxStaff: e.target.value }
                                )
                              }
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="1"
                              value={position.ticketAverage ?? ''}
                              onChange={(e) => updatePosition(position.id, { ticketAverage: e.target.value })}
                              disabled={position.logic !== 'service' && position.logic !== 'driver'}
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="1"
                              value={position.transactionsPerCollaborator ?? ''}
                              onChange={(e) => updatePosition(position.id, { transactionsPerCollaborator: e.target.value })}
                              disabled={position.logic !== 'service'}
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              value={position.factor ?? ''}
                              onChange={(e) => updatePosition(position.id, { factor: e.target.value })}
                              disabled={position.logic === 'fixed'}
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="p-2 text-center">
                            <span className="inline-flex min-w-12 justify-center rounded-lg bg-orange-50 px-2 py-1.5 text-xs font-black text-orange-700">
                              {liveHours}
                            </span>
                          </td>
                          <td className="p-2 text-center">
                            <span className="inline-flex min-w-10 justify-center rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-black text-blue-700">
                              {livePeak}
                            </span>
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => handleRemovePosition(position.id)}
                              className="w-full text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg font-bold"
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <h5 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Anadir Nueva Posicion</h5>
                <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_0.55fr_0.7fr_0.7fr_0.8fr_0.7fr_auto] gap-2">
                  <input
                    type="text"
                    placeholder="Ej. Drivethru o Modulo"
                    value={newPosition.name}
                    onChange={(e) => setNewPosition((prev) => ({ ...prev, name: e.target.value }))}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                  />
                  <select
                    value={newPosition.logic}
                    onChange={(e) => setNewPosition((prev) => ({ ...prev, logic: e.target.value }))}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="sales">VHL general × factor</option>
                    <option value="service">Servicio / punto de venta</option>
                    <option value="driver">Driver modulo</option>
                    <option value="fixed">Fijo / no venta</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Mín"
                    title="Mínimo por hora operativa"
                    value={newPosition.minStaff}
                    onChange={(e) => setNewPosition((prev) => ({ ...prev, minStaff: e.target.value }))}
                    disabled={newPosition.logic === 'fixed'}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100"
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder={newPosition.logic === 'sales' ? 'Tope' : 'Fijo'}
                    value={newPosition.logic === 'fixed' ? newPosition.fixedStaff : newPosition.maxStaff}
                    onChange={(e) =>
                      setNewPosition((prev) =>
                        prev.logic === 'fixed'
                          ? { ...prev, fixedStaff: e.target.value }
                          : { ...prev, maxStaff: e.target.value }
                      )
                    }
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                  />
                  <input
                    type="number"
                    min="1"
                    value={newPosition.ticketAverage}
                    onChange={(e) => setNewPosition((prev) => ({ ...prev, ticketAverage: e.target.value }))}
                    disabled={newPosition.logic !== 'service' && newPosition.logic !== 'driver'}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100"
                  />
                  <input
                    type="number"
                    min="1"
                    value={newPosition.transactionsPerCollaborator}
                    onChange={(e) => setNewPosition((prev) => ({ ...prev, transactionsPerCollaborator: e.target.value }))}
                    disabled={newPosition.logic !== 'service'}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100"
                  />
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    value={newPosition.factor}
                    onChange={(e) => setNewPosition((prev) => ({ ...prev, factor: e.target.value }))}
                    disabled={newPosition.logic === 'fixed'}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddPosition}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium text-sm rounded-lg transition shadow-sm"
                  >
                    Agregar
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Usa Fijo / no venta para areas como Limpieza, Horno, Lavado o Do Sheet. Estas posiciones mantienen una dotacion fija por hora y no dependen de la venta.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
