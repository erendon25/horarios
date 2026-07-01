import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle, Settings, Upload, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

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
  { id: 'cocina', name: 'Cocina', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 1 },
  { id: 'sheetout', name: 'Sheetout', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 0.7 },
  { id: 'masa', name: 'Masa', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 0.55 },
  { id: 'landing', name: 'Landing', logic: 'sales', capacity: DEFAULT_TOTAL_CAPACITY, factor: 0.5 },
  {
    id: 'punto_venta',
    name: 'Punto de Venta',
    logic: 'service',
    ticketAverage: DEFAULT_TICKET_AVERAGE,
    transactionsPerCollaborator: DEFAULT_TRANSACTIONS_PER_COLLABORATOR,
    factor: 1,
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

const HOURS_RANGE = Array.from({ length: 15 }, (_, i) => {
  const h = i + 9;
  return `${h.toString().padStart(2, '0')}:00`;
});

const REQUIREMENT_HOURS = Array.from({ length: 21 }, (_, i) => {
  const h = (8 + i) % 24;
  return `${h.toString().padStart(2, '0')}:00`;
});

const LOGIC_LABELS = {
  sales: 'Venta / capacidad',
  service: 'Servicio / punto de venta',
  driver: 'Driver modulo',
  fixed: 'Fijo / no venta',
};

const createEmptyHourlySales = () =>
  HOURS_RANGE.reduce((acc, h) => ({ ...acc, [h]: 0 }), {});

const createEmptySalesByDay = () =>
  DAYS.reduce((acc, day) => ({ ...acc, [day.key]: createEmptyHourlySales() }), {});

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const excelSerialToDate = (serial) => {
  if (typeof serial !== 'number' || serial < 1) return null;
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  return new Date(utcValue * 1000);
};

const getDayKey = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return DAYS[(value.getDay() + 6) % 7].key;
  }

  if (typeof value === 'number') {
    const date = excelSerialToDate(value);
    if (date) return DAYS[(date.getDay() + 6) % 7].key;
  }

  const text = normalize(value);
  if (!text) return null;
  if (text.startsWith('lun')) return 'lunes';
  if (text.startsWith('mar')) return 'martes';
  if (text.startsWith('mie') || text.startsWith('mié')) return 'miercoles';
  if (text.startsWith('jue')) return 'jueves';
  if (text.startsWith('vie')) return 'viernes';
  if (text.startsWith('sab')) return 'sabado';
  if (text.startsWith('dom')) return 'domingo';

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return DAYS[(parsed.getDay() + 6) % 7].key;
  }

  return null;
};

const getHourKey = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getHours().toString().padStart(2, '0')}:00`;
  }

  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:00`;
};

const findHeaderIndexes = (data) => {
  for (let rowIndex = 0; rowIndex < Math.min(data.length, 20); rowIndex += 1) {
    const row = data[rowIndex] || [];
    const normalized = Array.from({ length: row.length }, (_, index) => normalize(row[index]));
    const dateIndex = normalized.findIndex((cell) => cell === 'dia' || cell === 'fecha');
    const scheduleIndex = normalized.findIndex((cell) => cell.includes('horario'));
    const saleIndex = normalized.findIndex((cell) => cell === 'venta' || cell.includes('venta'));

    if (dateIndex >= 0 && scheduleIndex >= 0 && saleIndex >= 0) {
      return { rowIndex, dateIndex, scheduleIndex, saleIndex };
    }
  }

  return null;
};

const findDetailedOrderHeaderIndexes = (data) => {
  for (let rowIndex = 0; rowIndex < Math.min(data.length, 30); rowIndex += 1) {
    const row = data[rowIndex] || [];
    const normalized = Array.from({ length: row.length }, (_, index) => normalize(row[index]));
    const orderIndex = normalized.findIndex((cell) => cell === 'pedido');
    const dateTimeIndex = normalized.findIndex(
      (cell) => cell.includes('fecha') && cell.includes('hora')
    );
    const statusIndex = normalized.findIndex((cell) => cell === 'estado');

    if (orderIndex >= 0 && dateTimeIndex >= 0) {
      return { rowIndex, orderIndex, dateTimeIndex, statusIndex };
    }
  }

  return null;
};

const parseDetailedOrderSales = (data, header) => {
  const updatedSalesByDay = createEmptySalesByDay();
  let currentOrder = null;

  data.slice(header.rowIndex + 1).forEach((row) => {
    if (!row || row.length === 0) return;

    const orderNumber = row[header.orderIndex];
    const orderDateTime = row[header.dateTimeIndex];

    if (orderNumber && orderDateTime) {
      currentOrder = {
        dateTime: orderDateTime,
        status: header.statusIndex >= 0 ? normalize(row[header.statusIndex]) : '',
      };
    }

    const totalLabelIndex = row.findIndex((cell) => normalize(cell).includes('total pedido'));
    if (totalLabelIndex < 0 || !currentOrder) return;
    if (currentOrder.status.includes('anulado')) return;

    const total = row
      .slice(totalLabelIndex + 1)
      .find((cell) => typeof cell === 'number' && Number.isFinite(cell));
    const dayKey = getDayKey(currentOrder.dateTime);
    const hourKey = getHourKey(currentOrder.dateTime);

    if (dayKey && hourKey && updatedSalesByDay[dayKey]?.[hourKey] !== undefined && total) {
      updatedSalesByDay[dayKey][hourKey] += total;
    }
  });

  return updatedSalesByDay;
};

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
});

const mergeDefaultFixedPositions = (storedPositions = []) => {
  const stored = storedPositions.map(makeStoredPosition);
  const existingIds = new Set(stored.map((position) => position.id));
  const fixedDefaults = DEFAULT_POSITIONS
    .filter((position) => position.logic === 'fixed' && !existingIds.has(position.id))
    .map(makeStoredPosition);

  return [...stored, ...fixedDefaults];
};

const compressRows = (rows) =>
  Object.fromEntries(
    rows.map((row, rowIndex) => [
      rowIndex,
      Object.fromEntries(row.map((value, columnIndex) => [columnIndex, value])),
    ])
  );

export default function ScheduleProjectionDashboard({ staffList = [], storeId }) {
  const [salesByDay, setSalesByDay] = useState(createEmptySalesByDay);
  const [projectedSalesByDay, setProjectedSalesByDay] = useState(
    () => DAYS.reduce((acc, day) => ({ ...acc, [day.key]: 0 }), {})
  );
  const [selectedDay, setSelectedDay] = useState('lunes');
  const [positions, setPositions] = useState(DEFAULT_POSITIONS);
  const [isPositionsModalOpen, setIsPositionsModalOpen] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const saveTimerRef = useRef(null);
  const [newPosition, setNewPosition] = useState({
    name: '',
    logic: 'sales',
    capacity: DEFAULT_TOTAL_CAPACITY,
    ticketAverage: DEFAULT_TICKET_AVERAGE,
    transactionsPerCollaborator: DEFAULT_TRANSACTIONS_PER_COLLABORATOR,
    factor: 1,
    fixedStaff: 1,
  });

  useEffect(() => {
    if (!storeId) return;

    let cancelled = false;
    const loadProjectionConfig = async () => {
      try {
        const ref = doc(db, 'stores', storeId, 'config', 'schedule_projection');
        const snap = await getDoc(ref);
        if (cancelled) return;

        if (snap.exists() && Array.isArray(snap.data().positions)) {
          const data = snap.data();
          setPositions(mergeDefaultFixedPositions(data.positions));
          if (data.salesByDay) {
            setSalesByDay({
              ...createEmptySalesByDay(),
              ...data.salesByDay,
            });
          }
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
  }, [storeId]);

  const totalAvailableHours = useMemo(() => {
    return staffList.reduce((acc, member) => {
      if (member.cessationDate) {
        const today = new Date();
        if (new Date(member.cessationDate + 'T00:00:00') < today) return acc;
      }

      if (
        member.modality === 'Full Time' ||
        member.modality === 'Full-Time' ||
        member.contractType?.includes('Full')
      ) {
        return acc + 48;
      }

      if (
        member.modality === 'Part Time' ||
        member.modality === 'Part-Time' ||
        member.contractType?.includes('Part')
      ) {
        return acc + 24;
      }

      return acc;
    }, 0);
  }, [staffList]);

  const calculateRequiredStaff = (sale, position) => {
    if (!sale && position.logic !== 'fixed') return 0;

    if (position.logic === 'service') {
      const ticketAverage = getNumber(position.ticketAverage);
      const transactionsPerCollaborator = getNumber(position.transactionsPerCollaborator);
      const factor = getNumber(position.factor);
      if (!ticketAverage || !transactionsPerCollaborator || factor === null) return 0;
      return Math.ceil(((sale / ticketAverage) / transactionsPerCollaborator) * factor);
    }

    if (position.logic === 'driver') {
      const ticketAverage = getNumber(position.ticketAverage);
      const factor = getNumber(position.factor);
      if (!ticketAverage || factor === null) return 0;

      const estimatedProducts = sale / ticketAverage;
      const tripsPerHour = 60 / DEFAULT_DRIVER_ROUND_TRIP_MINUTES;
      const productsPerDriverHour = DEFAULT_DRIVER_PRODUCTS_PER_TRIP * tripsPerHour;
      return Math.ceil((estimatedProducts / productsPerDriverHour) * factor);
    }

    if (position.logic === 'fixed') {
      return getNumber(position.fixedStaff) || 0;
    }

    const capacity = getNumber(position.capacity);
    const factor = getNumber(position.factor);
    if (!capacity || factor === null) return 0;
    return Math.ceil((sale / capacity) * factor);
  };

  const buildScheduleMatrix = (hourlySales) => {
    let totalRequiredHours = 0;

    const columns = HOURS_RANGE.map((hour) => {
      const sale = hourlySales[hour] || 0;
      const requiredByPosition = {};
      let totalStaffAtHour = 0;

      positions.forEach((position) => {
        const requiredStaff = calculateRequiredStaff(sale, position);
        requiredByPosition[position.id] = requiredStaff;
        totalStaffAtHour += requiredStaff;
      });

      totalRequiredHours += totalStaffAtHour;

      return {
        hour,
        sale,
        requiredByPosition,
        totalStaffAtHour,
      };
    });

    return { columns, totalRequiredHours };
  };

  const buildProjectionRequirements = () => {
    return DAYS.reduce((acc, day) => {
      const hourlySales = salesByDay[day.key] || createEmptyHourlySales();
      const matrix = buildScheduleMatrix(hourlySales);
      const rows = positions.map((position) =>
        REQUIREMENT_HOURS.map((hour) => {
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
    if (!storeId || !configLoaded) return;
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
  }, [positions, salesByDay, storeId, configLoaded]);

  const handleInforestUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      let updatedSalesByDay = createEmptySalesByDay();
      const detailedHeader = findDetailedOrderHeaderIndexes(data);
      const header = findHeaderIndexes(data);

      if (detailedHeader) {
        updatedSalesByDay = parseDetailedOrderSales(data, detailedHeader);
      } else if (header) {
        data.slice(header.rowIndex + 1).forEach((row) => {
          if (!row || row.length === 0) return;

          const dayKey = getDayKey(row[header.dateIndex]);
          const hourKey = getHourKey(row[header.scheduleIndex]);
          const sale = Number(row[header.saleIndex]) || 0;

          if (dayKey && updatedSalesByDay[dayKey] && updatedSalesByDay[dayKey][hourKey] !== undefined) {
            updatedSalesByDay[dayKey][hourKey] += sale;
          }
        });
      } else {
        data.forEach((row) => {
          if (!row || row.length === 0) return;

          const rowString = row.join(' ');
          const hourKey = getHourKey(rowString);
          const sale = row.find((cell) => typeof cell === 'number' && cell > 0);

          if (hourKey && updatedSalesByDay[selectedDay][hourKey] !== undefined && sale) {
            updatedSalesByDay[selectedDay][hourKey] += sale;
          }
        });
      }

      setSalesByDay(updatedSalesByDay);
    };
    reader.readAsBinaryString(file);
  };

  const scheduleMatrix = useMemo(
    () => buildScheduleMatrix(salesByDay[selectedDay] || createEmptyHourlySales()),
    [salesByDay, selectedDay, positions]
  );

  const dailyTotals = useMemo(() => {
    return DAYS.reduce((acc, day) => {
      const hourlySales = salesByDay[day.key] || {};
      acc[day.key] = Object.values(hourlySales).reduce((sum, value) => sum + (Number(value) || 0), 0);
      return acc;
    }, {});
  }, [salesByDay]);

  const selectedDaySales = dailyTotals[selectedDay] || 0;
  const selectedDayProjectedSales = projectedSalesByDay[selectedDay] || 0;
  const weeklyProjectedSales = Object.values(projectedSalesByDay).reduce(
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
      const matrix = buildScheduleMatrix(salesByDay[day.key] || createEmptyHourlySales());
      return sum + matrix.totalRequiredHours;
    }, 0);
  }, [salesByDay, positions]);

  const isOverCapacity = weeklyRequiredHours > totalAvailableHours;

  const updatePosition = (id, changes) => {
    setPositions((prev) =>
      prev.map((position) => (position.id === id ? { ...position, ...changes } : position))
    );
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
            Carga el reporte Inforest para calcular personal por hora, dia, area y tipo de operacion.
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

          <label className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg text-sm transition flex items-center gap-2 cursor-pointer shadow-sm">
            <Upload className="w-4 h-4" />
            Subir Reporte Inforest (f901)
            <input
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={handleInforestUpload}
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-6">
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
            <span className="text-sm text-slate-500 block font-medium">Venta Proyectada del Dia</span>
            <span className="text-2xl font-bold text-emerald-700">S/. {selectedDayProjectedSales.toFixed(2)}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-amber-100 text-amber-600 rounded-lg">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <span className="text-sm text-slate-500 block font-medium">Venta Semanal Proyectada</span>
            <span className="text-2xl font-bold text-slate-900">S/. {weeklyProjectedSales.toFixed(2)}</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-sm text-slate-500 block font-medium">Bolsa de Horas Disponibles</span>
            <span className="text-2xl font-bold text-slate-900">
              {totalAvailableHours} hrs <span className="text-xs text-slate-400 font-normal">/semana</span>
            </span>
          </div>
        </div>

        <div className={`p-5 rounded-xl shadow-sm border flex items-center gap-4 ${
          isOverCapacity
            ? 'bg-red-50 border-red-200 text-red-900'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
        }`}>
          <div className={`p-3 rounded-lg ${
            isOverCapacity ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'
          }`}>
            {isOverCapacity ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle className="w-6 h-6" />}
          </div>
          <div>
            <span className="text-sm opacity-80 block font-medium">Horas Teoricas Requeridas</span>
            <span className="text-2xl font-bold">{weeklyRequiredHours.toFixed(0)} hrs</span>
            <span className="text-xs block mt-0.5 opacity-70">
              {isOverCapacity
                ? 'Alerta: estas sobrepasando la capacidad contractual.'
                : 'Dotacion optima dentro del limite contractual.'}
            </span>
          </div>
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
              Real S/. {(dailyTotals[day.key] || 0).toFixed(0)}
            </span>
            <span className="ml-2 text-xs opacity-80">
              Proy. S/. {(projectedSalesByDay[day.key] || 0).toFixed(0)}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="font-semibold text-slate-900">Distribucion de Personal e Ingresos por Hora</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Produccion usa venta/capacidad. Servicio usa venta/ticket promedio/transacciones por colaborador. Las areas fijas no dependen de venta.
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
                  Venta por Hora (S/.)
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
                        className={`p-3 text-center font-bold transition-all ${
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
                <table className="w-full min-w-[1100px] text-sm">
                  <colgroup>
                    <col className="w-[22%]" />
                    <col className="w-[18%]" />
                    <col className="w-[11%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                    <col className="w-[9%]" />
                    <col className="w-[7%]" />
                    <col className="w-[6%]" />
                    <col className="w-[4%]" />
                  </colgroup>
                  <thead className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-black">Posicion</th>
                      <th className="px-3 py-2 text-left font-black">Logica</th>
                      <th className="px-3 py-2 text-left font-black">Capacidad</th>
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
                            <option value="sales">Venta / capacidad</option>
                            <option value="service">Servicio / punto de venta</option>
                            <option value="driver">Driver modulo</option>
                            <option value="fixed">Fijo / no venta</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              min="1"
                              value={position.logic === 'fixed' ? position.fixedStaff ?? '' : position.capacity ?? ''}
                              onChange={(e) =>
                                updatePosition(
                                  position.id,
                                  position.logic === 'fixed'
                                    ? { fixedStaff: e.target.value }
                                    : { capacity: e.target.value }
                                )
                              }
                              disabled={position.logic === 'service' || position.logic === 'driver'}
                              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
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
                <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr_0.7fr_0.7fr_0.8fr_0.7fr_auto] gap-2">
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
                    <option value="sales">Venta / capacidad</option>
                    <option value="service">Servicio / punto de venta</option>
                    <option value="driver">Driver modulo</option>
                    <option value="fixed">Fijo / no venta</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={newPosition.logic === 'fixed' ? newPosition.fixedStaff : newPosition.capacity}
                    onChange={(e) =>
                      setNewPosition((prev) =>
                        prev.logic === 'fixed'
                          ? { ...prev, fixedStaff: e.target.value }
                          : { ...prev, capacity: e.target.value }
                      )
                    }
                    disabled={newPosition.logic === 'service' || newPosition.logic === 'driver'}
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm disabled:bg-slate-100"
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
