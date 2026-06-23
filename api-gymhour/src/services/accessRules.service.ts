import prisma from "../models/Prisma.js";

type TurnoOmitido = {
  ID_HorarioClase: number;
  fecha: Date;
  motivo: string;
  nombreClase?: string;
  diaSemana?: string;
};

type PlanLike = {
  nombre?: string | null;
  precio?: number | null;
  duracion?: string | null;
  sesionesPorSemana?: number | null;
  sesionesTotales?: number | null;
  sesionesGracia?: number | null;
  requiereTurno?: boolean | null;
};

const DAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

const getWallClockTimeParts = (date: Date): { hours: number; minutes: number } => {
  const iso = date.toISOString();
  return {
    hours: Number(iso.slice(11, 13)),
    minutes: Number(iso.slice(14, 16)),
  };
};

export const getArgentinaDate = (): Date => new Date(Date.now() - 3 * 60 * 60 * 1000);

export const normalizePlanDuration = (value: unknown): string => {
  const normalized = String(value || "MENSUAL").trim().toUpperCase();
  return ["SEMANAL", "MENSUAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"].includes(normalized)
    ? normalized
    : "MENSUAL";
};

export const getWeekRange = (date: Date): { start: Date; end: Date } => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
};

export const calculatePeriodEnd = (start: Date, duration: string): Date => {
  const end = new Date(start);
  switch (normalizePlanDuration(duration)) {
    case "SEMANAL":
      end.setDate(end.getDate() + 7);
      break;
    case "TRIMESTRAL":
      end.setMonth(end.getMonth() + 3);
      break;
    case "SEMESTRAL":
      end.setMonth(end.getMonth() + 6);
      break;
    case "ANUAL":
      end.setFullYear(end.getFullYear() + 1);
      break;
    case "MENSUAL":
    default:
      end.setMonth(end.getMonth() + 1);
      break;
  }
  end.setMilliseconds(end.getMilliseconds() - 1);
  return end;
};

export const inferPeriodStart = (mes: string, fallback = getArgentinaDate()): Date => {
  const match = String(mes || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return fallback;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1, 0, 0, 0, 0);
};

export const buildCuotaPlanSnapshot = (plan: PlanLike | null | undefined) => ({
  planNombreSnapshot: plan?.nombre ?? null,
  planDuracionSnapshot: normalizePlanDuration(plan?.duracion),
  planSesionesSemanaSnapshot: Number(plan?.sesionesPorSemana || 0),
  planSesionesTotalesSnapshot: Number(plan?.sesionesTotales || 0),
  planSesionesGraciaSnapshot: Number(plan?.sesionesGracia || 0),
  planRequiereTurnoSnapshot: plan?.requiereTurno !== false,
});

export const findActiveCuota = async (ID_Usuario: number, date = getArgentinaDate()) => {
  const cuotaByPeriod = await prisma.cuota.findFirst({
    where: {
      ID_Usuario,
      fechaInicio: { lte: date },
      fechaFin: { gte: date },
    },
    include: { Plan: true },
    orderBy: { fechaInicio: "desc" },
  });

  if (cuotaByPeriod) return cuotaByPeriod;

  const mes = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return prisma.cuota.findFirst({
    where: { ID_Usuario, mes },
    include: { Plan: true },
    orderBy: { vence: "desc" },
  });
};

export const getWeeklySessionLimit = (cuota: any): number => (
  Number(cuota?.planSesionesSemanaSnapshot ?? cuota?.Plan?.sesionesPorSemana ?? 0)
);

export const getGraceSessionLimit = (cuota: any): number => (
  Number(cuota?.planSesionesGraciaSnapshot ?? cuota?.Plan?.sesionesGracia ?? 0)
);

// Tope TOTAL de sesiones del período (reemplaza al semanal).
export const getTotalSessionLimit = (cuota: any): number => (
  Number(cuota?.planSesionesTotalesSnapshot ?? cuota?.Plan?.sesionesTotales ?? 0)
);

// Máximo de sesiones cargables según la duración (1 turno por día como máximo).
export const getMaxSessionsForDuration = (duration: unknown): number => {
  switch (normalizePlanDuration(duration)) {
    case "SEMANAL": return 7;
    case "MENSUAL": return 31;
    case "TRIMESTRAL": return 92;
    case "SEMESTRAL": return 184;
    case "ANUAL": return 366;
    default: return 31;
  }
};

export const requiresTurno = (cuota: any): boolean => (
  cuota?.planRequiereTurnoSnapshot ?? cuota?.Plan?.requiereTurno ?? true
);

export const countWeeklyUsedSessions = async (
  ID_Usuario: number,
  date: Date,
  excludeTurnoId?: number
): Promise<number> => {
  const { start, end } = getWeekRange(date);
  return prisma.turno.count({
    where: {
      ID_Usuario,
      fecha: { gte: start, lt: end },
      estado: { in: ["ACTIVO", "ASISTIDO", "AUSENTE"] },
      ...(excludeTurnoId ? { id_turno: { not: excludeTurnoId } } : {}),
    },
  });
};

export const countUnpaidAllowedAttendances = async (ID_Usuario: number, ID_Cuota: number): Promise<number> => (
  prisma.asistencia.count({
    where: {
      ID_Usuario,
      ID_Cuota,
      permitido: true,
    },
  })
);

export const validateWeeklyAvailability = async (
  ID_Usuario: number,
  fecha: Date,
  cuota: any,
  excludeTurnoId?: number
): Promise<string | null> => {
  const limit = getWeeklySessionLimit(cuota);
  if (limit <= 0) return null;
  const used = await countWeeklyUsedSessions(ID_Usuario, fecha, excludeTurnoId);
  return used >= limit ? `El plan permite hasta ${limit} sesión(es) por semana.` : null;
};

// Cuenta los turnos (sesiones) ya tomados dentro del período de la cuota.
export const countPeriodUsedSessions = async (
  ID_Usuario: number,
  cuota: any,
  excludeTurnoId?: number
): Promise<number> => {
  return prisma.turno.count({
    where: {
      ID_Usuario,
      ...(cuota?.ID_Cuota ? { ID_Cuota: cuota.ID_Cuota } : {}),
      estado: { in: ["ACTIVO", "ASISTIDO", "AUSENTE"] },
      ...(excludeTurnoId ? { id_turno: { not: excludeTurnoId } } : {}),
    },
  });
};

// Tope TOTAL del período: el alumno no puede superar las sesiones totales del plan.
export const validatePeriodAvailability = async (
  ID_Usuario: number,
  cuota: any,
  excludeTurnoId?: number
): Promise<string | null> => {
  const limit = getTotalSessionLimit(cuota);
  if (limit <= 0) return null;
  const used = await countPeriodUsedSessions(ID_Usuario, cuota, excludeTurnoId);
  return used >= limit ? `El plan permite hasta ${limit} sesión(es) en el período.` : null;
};

// El alumno no puede tener dos turnos el mismo día calendario.
// Los turnos se guardan como "hora de pared" en UTC, por eso el rango se calcula en UTC.
export const hasTurnoSameDay = async (
  ID_Usuario: number,
  fecha: Date,
  excludeTurnoId?: number
): Promise<boolean> => {
  const dayStart = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const count = await prisma.turno.count({
    where: {
      ID_Usuario,
      fecha: { gte: dayStart, lt: dayEnd },
      estado: { in: ["ACTIVO", "ASISTIDO", "AUSENTE"] },
      ...(excludeTurnoId ? { id_turno: { not: excludeTurnoId } } : {}),
    },
  });
  return count > 0;
};

export const generateFixedTurnosForCuota = async (cuota: any): Promise<{
  created: number;
  errores: TurnoOmitido[];
}> => {
  if (!cuota?.ID_Cuota || !cuota?.ID_Usuario || !cuota?.fechaInicio || !cuota?.fechaFin) return { created: 0, errores: [] };

  const user = await prisma.user.findUnique({
    where: { ID_Usuario: cuota.ID_Usuario },
    select: {
      usaTurnosFijos: true,
      TurnosFijos: {
        where: { activo: true },
        include: {
          HorarioClase: {
            include: { Clase: { select: { nombre: true } } },
          },
        },
      },
    },
  });

  if (!user?.usaTurnosFijos || user.TurnosFijos.length === 0) return { created: 0, errores: [] };

  // Tope: no se generan más turnos que las sesiones totales del plan.
  const totalLimit = getTotalSessionLimit(cuota);

  let created = 0;
  const errores: TurnoOmitido[] = [];
  const cursor = new Date(cuota.fechaInicio);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(cuota.fechaFin);
  end.setHours(23, 59, 59, 999);
  // No generar turnos en fechas/horarios ya pasados (mismo marco wall-clock que fechaTurno).
  const nowArg = getArgentinaDate();

  while (cursor <= end) {
    if (totalLimit > 0 && created >= totalLimit) break;
    for (const fixed of user.TurnosFijos) {
      if (totalLimit > 0 && created >= totalLimit) break;
      const horario = fixed.HorarioClase;

      if (horario.activo === false) {
        continue;
      }

      const expectedDay = DAY_INDEX[String(horario.diaSemana).trim().toLowerCase()];
      if (expectedDay === undefined || cursor.getDay() !== expectedDay) continue;

      const horaIni = getWallClockTimeParts(new Date(horario.horaIni));
      const fechaTurno = new Date(Date.UTC(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate(),
        horaIni.hours,
        horaIni.minutes,
        0,
        0
      ));

      // Turno en fecha/horario ya pasado: no se crea (nadie va a asistir).
      if (fechaTurno <= nowArg) continue;

      const existing = await prisma.turno.findFirst({
        where: {
          ID_Usuario: cuota.ID_Usuario,
          ID_HorarioClase: horario.ID_HorarioClase,
          fecha: fechaTurno,
        },
        select: { id_turno: true },
      });
      if (existing) continue;

      const cuposOcupados = await prisma.turno.count({
        where: {
          ID_HorarioClase: horario.ID_HorarioClase,
          fecha: fechaTurno,
          estado: { in: ["ACTIVO", "ASISTIDO", "AUSENTE"] },
        },
      });
      if (cuposOcupados >= horario.cupos) {
        errores.push({
          ID_HorarioClase: horario.ID_HorarioClase,
          fecha: fechaTurno,
          motivo: 'sin_cupo',
          nombreClase: horario.Clase?.nombre ?? null,
          diaSemana: horario.diaSemana,
        });
        continue;
      }

      await prisma.turno.create({
        data: {
          fecha: fechaTurno,
          estado: "ACTIVO",
          origen: "FIJO",
          ID_Usuario: cuota.ID_Usuario,
          ID_HorarioClase: horario.ID_HorarioClase,
          ID_Cuota: cuota.ID_Cuota,
          fechaCreacion: getArgentinaDate(),
        },
      });
      created += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return { created, errores };
};
