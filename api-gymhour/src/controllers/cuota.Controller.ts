import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import prismaC from '../models/Cuota.js'; // Ajusta la ruta según tu proyecto
import prisma from '../models/Prisma.js';
import prismaU from '../models/User.js';
import {
  buildCuotaPlanSnapshot,
  calculatePeriodEnd,
  findActiveCuota,
  generateFixedTurnosForCuota,
  getArgentinaDate,
  inferPeriodStart,
  normalizePlanDuration,
} from '../services/accessRules.service.js';

type CuotaReturn = {
  ID_Cuota: number;
  mes: string;
  importe: number;
  vence: Date;
  plan?: string;
  pagada: boolean;
  vencida: boolean;
  formaPago: string | null;
  fechaPago: Date | null;
  ID_Usuario: number;
  User: {
    ID_Usuario: number;
    email: string;
    nombre: string | null;
    apellido: string | null;
    // … otros campos de usuario que quieras incluir
  };
};

type TurnoCandidato = {
  ID_Usuario: number;
  usuario: string;
  ID_HorarioClase: number;
  fecha: Date;
  cupos: number;
  nombreClase: string | null;
  diaSemana: string;
};

const ACTIVE_TURNO_STATES = ["ACTIVO", "ASISTIDO", "AUSENTE"];
const CREATE_MANY_CHUNK_SIZE = 500;

const normalizeDayKey = (value: unknown): string => (
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00c3\u00a9/g, "e")
    .replace(/\u00c3\u00a1/g, "a")
);

const DAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const getWallClockTimeParts = (date: Date): { hours: number; minutes: number } => {
  const iso = date.toISOString();
  return {
    hours: Number(iso.slice(11, 13)),
    minutes: Number(iso.slice(14, 16)),
  };
};

const buildUsuarioNombre = (user: { ID_Usuario: number; nombre: string | null; apellido: string | null }) => (
  `${user.nombre || ""} ${user.apellido || ""}`.trim() || `ID ${user.ID_Usuario}`
);

const buildTurnoKey = (ID_Usuario: number, ID_HorarioClase: number, fecha: Date): string => (
  `${ID_Usuario}:${ID_HorarioClase}:${fecha.getTime()}`
);

const buildHorarioFechaKey = (ID_HorarioClase: number, fecha: Date): string => (
  `${ID_HorarioClase}:${fecha.getTime()}`
);

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

// Select compartido por toda la generación masiva: solo alumnos (tipo cliente) activos con plan.
const USUARIO_PLAN_SELECT = {
  ID_Usuario: true,
  nombre: true,
  apellido: true,
  ID_Plan: true,
  usaTurnosFijos: true,
  plan: true,
} satisfies Prisma.UserSelect;

type UsuarioConPlan = Prisma.UserGetPayload<{ select: typeof USUARIO_PLAN_SELECT }>;

type ConflictoCupo = {
  ID_HorarioClase: number;
  fecha: string;
  clase: string | null;
  diaSemana: string;
  cupos: number;
  turnosExistentes: number;
  turnosSolicitados: number;
  exceso: number;
  usuariosAfectados: Array<{ ID_Usuario: number; nombre: string }>;
};

type PlanMasivoResult = {
  cuotasData: Prisma.CuotaCreateManyInput[];
  turnosACrear: TurnoCandidato[];
  conflictosCupo: ConflictoCupo[];
  turnosOmitidosPorExistentes: number;
};

/**
 * Construye las cuotas + los candidatos de turnos fijos de un conjunto de alumnos y valida los cupos
 * de cada horario/fecha. NO crea nada: lo usan tanto la validación previa (preparar) como cada lote.
 * Saltea turnos en fechas/horarios ya pasados y respeta el tope de sesiones totales del plan.
 */
const construirPlanMasivo = async (
  usuarios: UsuarioConPlan[],
  mes: string,
  venceDate: Date,
  formaPago: string | null,
): Promise<PlanMasivoResult> => {
  const usuariosConTurnos = usuarios.filter(u => u.usaTurnosFijos);
  const turnosFijos = usuariosConTurnos.length > 0
    ? await prisma.turnoFijo.findMany({
        where: {
          ID_Usuario: { in: usuariosConTurnos.map(u => u.ID_Usuario) },
          activo: true,
        },
        include: {
          HorarioClase: {
            include: { Clase: { select: { nombre: true } } },
          },
        },
      })
    : [];

  const turnosFijosByUser = new Map<number, typeof turnosFijos>();
  for (const tf of turnosFijos) {
    const arr = turnosFijosByUser.get(tf.ID_Usuario);
    if (arr) arr.push(tf);
    else turnosFijosByUser.set(tf.ID_Usuario, [tf]);
  }

  const periodStart = inferPeriodStart(mes);
  const cuotasData: Prisma.CuotaCreateManyInput[] = [];
  const candidatos: TurnoCandidato[] = [];
  // No generar turnos en fechas/horarios ya pasados (mismo marco wall-clock que fechaTurno).
  const nowArg = getArgentinaDate();

  for (const u of usuarios) {
    if (!u.plan) continue;

    const duration = normalizePlanDuration(u.plan.duracion);
    const periodEnd = calculatePeriodEnd(periodStart, duration);

    cuotasData.push({
      ID_Usuario: u.ID_Usuario,
      ID_Plan: u.ID_Plan,
      mes,
      importe: u.plan.precio,
      vence: venceDate,
      fechaInicio: periodStart,
      fechaFin: periodEnd,
      pagada: false,
      vencida: false,
      formaPago: formaPago || null,
      fechaPago: null,
      ...buildCuotaPlanSnapshot(u.plan)
    });

    const userTurnos = turnosFijosByUser.get(u.ID_Usuario) ?? [];
    if (userTurnos.length === 0) continue;

    // Tope: no generar más turnos que las sesiones totales del plan.
    const totalLimit = Number(u.plan.sesionesTotales || 0);
    let userCreated = 0;
    const cursor = new Date(periodStart);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(periodEnd);
    end.setHours(23, 59, 59, 999);

    while (cursor <= end) {
      if (totalLimit > 0 && userCreated >= totalLimit) break;
      for (const fixed of userTurnos) {
        if (totalLimit > 0 && userCreated >= totalLimit) break;
        const horario = fixed.HorarioClase;
        const expectedDay = DAY_INDEX[normalizeDayKey(horario.diaSemana)];

        if (expectedDay === undefined || cursor.getDay() !== expectedDay) {
          continue;
        }

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

        // Turno en fecha/horario ya pasado: no se genera (tampoco consume el tope de sesiones).
        if (fechaTurno <= nowArg) continue;

        candidatos.push({
          ID_Usuario: u.ID_Usuario,
          usuario: buildUsuarioNombre(u),
          ID_HorarioClase: horario.ID_HorarioClase,
          fecha: fechaTurno,
          cupos: horario.cupos,
          nombreClase: horario.Clase?.nombre ?? null,
          diaSemana: horario.diaSemana,
        });
        userCreated += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const horarioIds = Array.from(new Set(candidatos.map(c => c.ID_HorarioClase)));
  const minFecha = candidatos.length
    ? new Date(Math.min(...candidatos.map(c => c.fecha.getTime())))
    : null;
  const maxFecha = candidatos.length
    ? new Date(Math.max(...candidatos.map(c => c.fecha.getTime())))
    : null;

  const turnosExistentes = horarioIds.length && minFecha && maxFecha
    ? await prisma.turno.findMany({
      where: {
        ID_HorarioClase: { in: horarioIds },
        fecha: { gte: minFecha, lte: maxFecha },
      },
      select: {
        ID_Usuario: true,
        ID_HorarioClase: true,
        fecha: true,
        estado: true,
      }
    })
    : [];

  const existingTurnoKeys = new Set<string>();
  const existingActiveByHorarioFecha = new Map<string, number>();

  for (const turno of turnosExistentes) {
    const fechaTurno = new Date(turno.fecha);

    if (turno.estado !== "CANCELADO") {
      existingTurnoKeys.add(buildTurnoKey(turno.ID_Usuario, turno.ID_HorarioClase, fechaTurno));
    }

    if (ACTIVE_TURNO_STATES.includes(turno.estado)) {
      const groupKey = buildHorarioFechaKey(turno.ID_HorarioClase, fechaTurno);
      existingActiveByHorarioFecha.set(groupKey, (existingActiveByHorarioFecha.get(groupKey) || 0) + 1);
    }
  }

  const turnosACrear = candidatos.filter(c => (
    !existingTurnoKeys.has(buildTurnoKey(c.ID_Usuario, c.ID_HorarioClase, c.fecha))
  ));
  const turnosOmitidosPorExistentes = candidatos.length - turnosACrear.length;

  const candidatosPorHorarioFecha = new Map<string, {
    ID_HorarioClase: number;
    fecha: Date;
    cupos: number;
    nombreClase: string | null;
    diaSemana: string;
    candidatos: TurnoCandidato[];
  }>();

  for (const candidato of turnosACrear) {
    const key = buildHorarioFechaKey(candidato.ID_HorarioClase, candidato.fecha);
    const group = candidatosPorHorarioFecha.get(key);

    if (group) {
      group.candidatos.push(candidato);
    } else {
      candidatosPorHorarioFecha.set(key, {
        ID_HorarioClase: candidato.ID_HorarioClase,
        fecha: candidato.fecha,
        cupos: candidato.cupos,
        nombreClase: candidato.nombreClase,
        diaSemana: candidato.diaSemana,
        candidatos: [candidato],
      });
    }
  }

  const conflictosCupo: ConflictoCupo[] = Array.from(candidatosPorHorarioFecha.values())
    .map(group => {
      const turnosExistentesActivos = existingActiveByHorarioFecha.get(buildHorarioFechaKey(group.ID_HorarioClase, group.fecha)) || 0;
      const turnosSolicitados = group.candidatos.length;
      const total = turnosExistentesActivos + turnosSolicitados;

      return {
        ID_HorarioClase: group.ID_HorarioClase,
        fecha: group.fecha.toISOString(),
        clase: group.nombreClase,
        diaSemana: group.diaSemana,
        cupos: group.cupos,
        turnosExistentes: turnosExistentesActivos,
        turnosSolicitados,
        exceso: total - group.cupos,
        usuariosAfectados: group.candidatos.map(c => ({
          ID_Usuario: c.ID_Usuario,
          nombre: c.usuario,
        })),
      };
    })
    .filter(conflict => conflict.exceso > 0);

  return { cuotasData, turnosACrear, conflictosCupo, turnosOmitidosPorExistentes };
};

/**
 * Persiste las cuotas y sus turnos dentro de una transacción (tx). Reutilizado por la generación
 * de una sola request y por cada lote. `ids` = IDs de los alumnos pendientes que se están creando.
 */
const persistirCuotasYTurnos = async (
  tx: Prisma.TransactionClient,
  mes: string,
  ids: number[],
  cuotasData: Prisma.CuotaCreateManyInput[],
  turnosACrear: TurnoCandidato[],
): Promise<{ cuotasCreadas: number; turnosGenerados: number }> => {
  const cuotasCreadas = await tx.cuota.createMany({ data: cuotasData });

  const cuotas = await tx.cuota.findMany({
    where: { mes, ID_Usuario: { in: ids } },
    select: { ID_Cuota: true, ID_Usuario: true }
  });

  const cuotaByUsuario = new Map(cuotas.map(c => [c.ID_Usuario, c.ID_Cuota]));

  if (cuotaByUsuario.size < ids.length) {
    throw new Error("No se pudieron recuperar todas las cuotas creadas para generar turnos");
  }

  const fechaCreacion = getArgentinaDate();
  const turnosData: Prisma.TurnoCreateManyInput[] = turnosACrear.map(candidato => {
    const ID_Cuota = cuotaByUsuario.get(candidato.ID_Usuario);
    if (!ID_Cuota) {
      throw new Error(`No se encontro cuota creada para el usuario ${candidato.ID_Usuario}`);
    }

    return {
      fecha: candidato.fecha,
      estado: "ACTIVO",
      origen: "FIJO",
      fechaCreacion,
      ID_HorarioClase: candidato.ID_HorarioClase,
      ID_Usuario: candidato.ID_Usuario,
      ID_Cuota,
    };
  });

  let turnosGenerados = 0;
  for (const chunk of chunkArray(turnosData, CREATE_MANY_CHUNK_SIZE)) {
    const result = await tx.turno.createMany({ data: chunk });
    turnosGenerados += result.count;
  }

  return { cuotasCreadas: cuotasCreadas.count, turnosGenerados };
};

// 1. Crear cuota
const createCuota = async (req: Request, res: Response): Promise<void> => {
  try {
    const idUsuarioParam = req.params.idUsuario;
    const { ID_Usuario, mes, importe, vence, fechaInicio, fechaFin } = req.body;
    const usuarioId = idUsuarioParam ? Number(idUsuarioParam) : Number(ID_Usuario);

    if (!usuarioId || !mes || !importe || !vence) {
      res.status(400).json({ message: 'Faltan datos obligatorios' });
      return;
    }
    const venceDate = new Date(vence);
    if (isNaN(venceDate.getTime())) {
      res.status(400).json({ message: "'vence' no es una fecha válida" });
      return;
    }

    const usuario = await prismaU.findUnique({
      where: { ID_Usuario: usuarioId },
      select: {
        ID_Usuario: true,
        ID_Plan: true,
        plan: true
      }
    });
    if (!usuario) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    const periodStart = fechaInicio ? new Date(fechaInicio) : inferPeriodStart(mes);
    const duration = normalizePlanDuration(usuario.plan?.duracion);
    const periodEnd = fechaFin ? new Date(fechaFin) : calculatePeriodEnd(periodStart, duration);
    const snapshot = buildCuotaPlanSnapshot(usuario.plan);

    const nuevaCuota = await prismaC.create({
      data: {
        ID_Usuario: usuarioId,
        ID_Plan: usuario.ID_Plan,
        mes,
        importe: Number(importe || usuario.plan?.precio || 0),
        vence: venceDate,
        fechaInicio: periodStart,
        fechaFin: periodEnd,
        pagada: false,
        vencida: false,
        fechaPago: null,
        formaPago: null,
        ...snapshot
      },
      include: {
        User: { select: { ID_Usuario: true, email: true, nombre: true, apellido: true } },
        Plan: true
      }
    });

    const { created: turnosGenerados, errores: turnosNoGenerados } = await generateFixedTurnosForCuota(nuevaCuota);

    res.status(201).json({
      message: 'Cuota creada exitosamente',
      cuota: nuevaCuota,
      turnosGenerados,
      ...(turnosNoGenerados.length > 0 && {
        advertencias: {
          mensaje: `${turnosNoGenerados.length} turno(s) no se pudieron generar por falta de cupo en el horario. Revisá los turnos fijos del alumno.`,
          detalles: turnosNoGenerados
        }
      })
    });
  } catch (error: any) {
    console.error('Error al crear cuota:', error);
    res.status(500).json({ message: 'Error al crear cuota', error: error.message });
  }
};

export const generateMonthlyCuotas = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mes, vence, formaPago } = req.body;
    if (!mes || !vence) {
      res.status(400).json({ message: 'Faltan parametros obligatorios: mes, vence' });
      return;
    }

    const venceDate = new Date(vence);
    if (isNaN(venceDate.getTime())) {
      res.status(400).json({ message: "'vence' no es una fecha valida" });
      return;
    }

    const usuarios = await prisma.user.findMany({
      where: { estado: true, tipo: 'cliente', plan: { isNot: null } },
      select: USUARIO_PLAN_SELECT,
    });

    if (usuarios.length === 0) {
      res.status(404).json({ message: 'No hay alumnos activos con plan asignado' });
      return;
    }

    const existentes = await prisma.cuota.findMany({
      where: { mes },
      select: { ID_Usuario: true }
    });
    const existentesIds = new Set<number>(existentes.map(e => e.ID_Usuario));
    const pendientes = usuarios.filter(u => !existentesIds.has(u.ID_Usuario));

    if (pendientes.length === 0) {
      res.status(200).json({
        message: `Todas las cuotas para el mes ${mes} ya estaban generadas`,
        totalUsuarios: usuarios.length,
        inserted: 0,
        turnosGenerados: 0,
        usuariosOmitidosPorCuotaExistente: usuarios.length
      });
      return;
    }

    const { cuotasData, turnosACrear, conflictosCupo, turnosOmitidosPorExistentes } =
      await construirPlanMasivo(pendientes, mes, venceDate, formaPago || null);

    if (conflictosCupo.length > 0) {
      res.status(409).json({
        message: `No se generaron cuotas. Hay ${conflictosCupo.length} horario(s) sin cupo suficiente para los turnos fijos.`,
        valido: false,
        totalUsuarios: pendientes.length,
        conflictosCupo,
      });
      return;
    }

    const pendientesIds = pendientes.map(u => u.ID_Usuario);
    const transactionResult = await prisma.$transaction(
      (tx) => persistirCuotasYTurnos(tx, mes, pendientesIds, cuotasData, turnosACrear),
      { maxWait: 10000, timeout: 120000 },
    );

    res.status(201).json({
      message: `Se generaron ${transactionResult.cuotasCreadas} cuotas para el mes ${mes} con todos los turnos fijos correctamente.`,
      totalUsuarios: usuarios.length,
      inserted: transactionResult.cuotasCreadas,
      turnosGenerados: transactionResult.turnosGenerados,
      usuariosOmitidosPorCuotaExistente: usuarios.length - pendientes.length,
      turnosOmitidosPorExistentes,
    });
  } catch (error: any) {
    console.error('Error generando cuotas masivas:', error);
    res.status(500).json({ message: 'Error al generar cuotas', error: error.message });
  }
};

/**
 * Paso 1 del flujo por lotes: valida cupos GLOBALES y devuelve los IDs de alumnos pendientes + totales.
 * NO crea nada. Si hay conflicto de cupos responde 409 con el detalle para mostrar al admin.
 */
export const prepararCuotasMasivas = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mes, vence } = req.body;
    if (!mes || !vence) {
      res.status(400).json({ message: 'Faltan parametros obligatorios: mes, vence' });
      return;
    }

    const venceDate = new Date(vence);
    if (isNaN(venceDate.getTime())) {
      res.status(400).json({ message: "'vence' no es una fecha valida" });
      return;
    }

    const usuarios = await prisma.user.findMany({
      where: { estado: true, tipo: 'cliente', plan: { isNot: null } },
      select: USUARIO_PLAN_SELECT,
    });

    const existentes = await prisma.cuota.findMany({
      where: { mes },
      select: { ID_Usuario: true }
    });
    const existentesIds = new Set<number>(existentes.map(e => e.ID_Usuario));
    const pendientes = usuarios.filter(u => !existentesIds.has(u.ID_Usuario));

    if (pendientes.length === 0) {
      res.status(200).json({
        message: usuarios.length === 0
          ? 'No hay alumnos activos con plan asignado.'
          : `Todas las cuotas para el mes ${mes} ya estaban generadas.`,
        total: 0,
        ids: [],
        totalTurnosEstimados: 0,
        usuariosOmitidos: usuarios.length,
      });
      return;
    }

    const { turnosACrear, conflictosCupo } = await construirPlanMasivo(pendientes, mes, venceDate, null);

    if (conflictosCupo.length > 0) {
      res.status(409).json({
        message: `No se pueden generar las cuotas. Hay ${conflictosCupo.length} horario(s) sin cupo suficiente para los turnos fijos.`,
        valido: false,
        conflictosCupo,
      });
      return;
    }

    res.status(200).json({
      message: `Listo para generar ${pendientes.length} cuota(s).`,
      total: pendientes.length,
      ids: pendientes.map(u => u.ID_Usuario),
      totalTurnosEstimados: turnosACrear.length,
      usuariosOmitidos: usuarios.length - pendientes.length,
    });
  } catch (error: any) {
    console.error('Error preparando cuotas masivas:', error);
    res.status(500).json({ message: 'Error al preparar la generación de cuotas', error: error.message });
  }
};

/**
 * Paso 2 del flujo por lotes: procesa un chunk de alumnos (ids). Dedupea por mes (reintento seguro),
 * valida cupos del lote (incluye lo ya creado por lotes previos) y crea en una transacción CORTA.
 * Idempotente: reintentar el mismo lote no duplica.
 */
export const generarCuotasLote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mes, vence, formaPago, ids } = req.body;
    if (!mes || !vence) {
      res.status(400).json({ message: 'Faltan parametros obligatorios: mes, vence' });
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ message: 'Faltan los ids de alumnos del lote' });
      return;
    }

    const venceDate = new Date(vence);
    if (isNaN(venceDate.getTime())) {
      res.status(400).json({ message: "'vence' no es una fecha valida" });
      return;
    }

    const idsNum = Array.from(new Set(
      ids.map((v: unknown) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
    ));
    if (idsNum.length === 0) {
      res.status(400).json({ message: 'Los ids del lote no son válidos' });
      return;
    }

    const usuarios = await prisma.user.findMany({
      where: { ID_Usuario: { in: idsNum }, estado: true, tipo: 'cliente', plan: { isNot: null } },
      select: USUARIO_PLAN_SELECT,
    });

    // Dedupe por mes para que reintentar un lote no genere cuotas duplicadas.
    const existentes = await prisma.cuota.findMany({
      where: { mes, ID_Usuario: { in: idsNum } },
      select: { ID_Usuario: true }
    });
    const existentesIds = new Set<number>(existentes.map(e => e.ID_Usuario));
    const pendientes = usuarios.filter(u => !existentesIds.has(u.ID_Usuario));

    if (pendientes.length === 0) {
      res.status(200).json({
        procesados: 0,
        cuotasCreadas: 0,
        turnosGenerados: 0,
        turnosOmitidosPorExistentes: 0,
      });
      return;
    }

    const { cuotasData, turnosACrear, conflictosCupo, turnosOmitidosPorExistentes } =
      await construirPlanMasivo(pendientes, mes, venceDate, formaPago || null);

    if (conflictosCupo.length > 0) {
      res.status(409).json({
        message: `Hay ${conflictosCupo.length} horario(s) sin cupo suficiente para los turnos fijos.`,
        valido: false,
        conflictosCupo,
      });
      return;
    }

    const pendientesIds = pendientes.map(u => u.ID_Usuario);
    const result = await prisma.$transaction(
      (tx) => persistirCuotasYTurnos(tx, mes, pendientesIds, cuotasData, turnosACrear),
      { maxWait: 10000, timeout: 30000 },
    );

    res.status(200).json({
      procesados: pendientes.length,
      cuotasCreadas: result.cuotasCreadas,
      turnosGenerados: result.turnosGenerados,
      turnosOmitidosPorExistentes,
    });
  } catch (error: any) {
    console.error('Error generando lote de cuotas:', error);
    res.status(500).json({ message: 'Error al generar el lote de cuotas', error: error.message });
  }
};

const regenerateTurnosFijosByUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const usuarioId = Number(req.params.idUsuario);
    if (!usuarioId) {
      res.status(400).json({ message: 'ID de usuario inválido' });
      return;
    }

    const now = getArgentinaDate();
    const cuota = await findActiveCuota(usuarioId, now);
    if (!cuota?.ID_Cuota || !cuota.fechaInicio || !cuota.fechaFin) {
      res.status(400).json({ message: 'El usuario no tiene una cuota vigente para regenerar turnos fijos.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { ID_Usuario: usuarioId },
      select: {
        ID_Usuario: true,
        nombre: true,
        apellido: true,
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

    if (!user) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    if (!user.usaTurnosFijos || user.TurnosFijos.length === 0) {
      res.status(400).json({ message: 'El usuario no tiene turnos fijos activos para regenerar.' });
      return;
    }

    const weeklyLimit = Number(cuota.planSesionesSemanaSnapshot ?? cuota.Plan?.sesionesPorSemana ?? 0);
    if (weeklyLimit > 0 && user.TurnosFijos.length > weeklyLimit) {
      res.status(409).json({
        message: `El alumno tiene ${user.TurnosFijos.length} turno(s) fijo(s) y el plan permite solo ${weeklyLimit} por semana.`,
        valido: false,
      });
      return;
    }

    const candidatos: TurnoCandidato[] = [];
    const cursor = new Date(cuota.fechaInicio);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(cuota.fechaFin);
    end.setHours(23, 59, 59, 999);

    while (cursor <= end) {
      for (const fixed of user.TurnosFijos) {
        const horario = fixed.HorarioClase;
        if (!horario || horario.activo === false) continue;

        const expectedDay = DAY_INDEX[normalizeDayKey(horario.diaSemana)];
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

        if (fechaTurno <= now) continue;

        candidatos.push({
          ID_Usuario: usuarioId,
          usuario: buildUsuarioNombre(user),
          ID_HorarioClase: horario.ID_HorarioClase,
          fecha: fechaTurno,
          cupos: horario.cupos,
          nombreClase: horario.Clase?.nombre ?? null,
          diaSemana: horario.diaSemana,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (candidatos.length === 0) {
      res.status(200).json({
        message: 'No hay turnos fijos futuros para regenerar en la cuota vigente.',
        usuarioId,
        cuotaId: cuota.ID_Cuota,
        turnosGenerados: 0,
        turnosOmitidosPorExistentes: 0,
      });
      return;
    }

    const horarioIds = Array.from(new Set(candidatos.map(c => c.ID_HorarioClase)));
    const minFecha = new Date(Math.min(...candidatos.map(c => c.fecha.getTime())));
    const maxFecha = new Date(Math.max(...candidatos.map(c => c.fecha.getTime())));

    const turnosExistentes = await prisma.turno.findMany({
      where: {
        ID_HorarioClase: { in: horarioIds },
        fecha: { gte: minFecha, lte: maxFecha },
      },
      select: {
        ID_Usuario: true,
        ID_HorarioClase: true,
        fecha: true,
        estado: true,
      },
    });

    const existingUserTurnoKeys = new Set<string>();
    const existingActiveByHorarioFecha = new Map<string, number>();

    for (const turno of turnosExistentes) {
      const fechaTurno = new Date(turno.fecha);

      if (turno.ID_Usuario === usuarioId && turno.estado !== 'CANCELADO') {
        existingUserTurnoKeys.add(buildTurnoKey(turno.ID_Usuario, turno.ID_HorarioClase, fechaTurno));
      }

      if (ACTIVE_TURNO_STATES.includes(turno.estado)) {
        const groupKey = buildHorarioFechaKey(turno.ID_HorarioClase, fechaTurno);
        existingActiveByHorarioFecha.set(groupKey, (existingActiveByHorarioFecha.get(groupKey) || 0) + 1);
      }
    }

    const sinDuplicados = candidatos.filter(c => (
      !existingUserTurnoKeys.has(buildTurnoKey(c.ID_Usuario, c.ID_HorarioClase, c.fecha))
    ));
    const turnosOmitidosPorExistentes = candidatos.length - sinDuplicados.length;
    const turnosACrear: TurnoCandidato[] = [];
    const errores: Array<{
      ID_HorarioClase: number;
      fecha: string;
      motivo: string;
      clase: string | null;
      diaSemana: string;
      cupos: number;
      turnosExistentes: number;
    }> = [];
    const requestedByHorarioFecha = new Map<string, number>();

    for (const candidato of sinDuplicados) {
      const groupKey = buildHorarioFechaKey(candidato.ID_HorarioClase, candidato.fecha);
      const existingCount = existingActiveByHorarioFecha.get(groupKey) || 0;
      const requestedCount = requestedByHorarioFecha.get(groupKey) || 0;

      if (existingCount + requestedCount >= candidato.cupos) {
        errores.push({
          ID_HorarioClase: candidato.ID_HorarioClase,
          fecha: candidato.fecha.toISOString(),
          motivo: 'sin_cupo',
          clase: candidato.nombreClase,
          diaSemana: candidato.diaSemana,
          cupos: candidato.cupos,
          turnosExistentes: existingCount,
        });
        continue;
      }

      requestedByHorarioFecha.set(groupKey, requestedCount + 1);
      turnosACrear.push(candidato);
    }

    const fechaCreacion = getArgentinaDate();
    const turnosData: Prisma.TurnoCreateManyInput[] = turnosACrear.map(candidato => ({
      fecha: candidato.fecha,
      estado: 'ACTIVO',
      origen: 'FIJO',
      fechaCreacion,
      ID_HorarioClase: candidato.ID_HorarioClase,
      ID_Usuario: candidato.ID_Usuario,
      ID_Cuota: cuota.ID_Cuota,
    }));

    let turnosGenerados = 0;
    for (const chunk of chunkArray(turnosData, CREATE_MANY_CHUNK_SIZE)) {
      const result = await prisma.turno.createMany({ data: chunk });
      turnosGenerados += result.count;
    }

    res.status(200).json({
      message: errores.length > 0
        ? `Se regeneraron ${turnosGenerados} turno(s). ${errores.length} turno(s) no se pudieron generar por falta de cupo.`
        : `Se regeneraron ${turnosGenerados} turno(s) fijo(s).`,
      usuarioId,
      cuotaId: cuota.ID_Cuota,
      fechaInicio: cuota.fechaInicio,
      fechaFin: cuota.fechaFin,
      turnosGenerados,
      turnosOmitidosPorExistentes,
      ...(errores.length > 0 && {
        advertencias: {
          mensaje: `${errores.length} turno(s) no se pudieron generar por falta de cupo.`,
          detalles: errores,
        },
      }),
    });
  } catch (error: any) {
    console.error('Error regenerando turnos fijos:', error);
    res.status(500).json({ message: 'Error al regenerar turnos fijos', error: error.message });
  }
};

export const getAllCuotas = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      page = '1',
      email,
      dni,
      estado,
      mes,
      plan,
      vencida // "true" | "false"
    } = req.query;

    const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
    const take = 15;
    const skip = (pageNumber - 1) * take;
    const where: Prisma.CuotaWhereInput = {};

    // 1) filtro por 'vencida' si viene explícito (tiene prioridad)
    if (typeof vencida === 'string') {
      where.vencida = vencida.toLowerCase() === 'true';
    }

    // 2) filtro por 'estado'
    if (typeof estado === 'string') {
      const est = estado.toLowerCase();

      // caso especial: 'pendiente' => pagada = false AND vencida = false
      if (est === 'pendiente' || est === 'pending') {
        where.pagada = false;
        // Sólo setear vencida=false si no vino explícito por query
        if (typeof vencida !== 'string') {
          where.vencida = false;
        }
      } else if (est === 'pagada' || est === 'true') {
        where.pagada = true;
      } else if (est === 'false') {
        // mantiene backward compatibility: pagada=false (pero puede incluir vencidas salvo que 'vencida' también se setee)
        where.pagada = false;
      }
    }

    // 3) mes (contains)
    if (mes && typeof mes === 'string') {
      where.mes = { contains: mes } as Prisma.StringFilter;
    }

    // 4) Construir de forma segura el filtro sobre User (plan + email + dni)
    const existingUserIs = (where.User as any)?.is ?? {};
    let userIs: any = { ...existingUserIs };

    if (plan && typeof plan === 'string') {
      userIs.plan = { is: { nombre: { contains: plan } as Prisma.StringFilter } };
    }

    if (email && typeof email === 'string') {
      userIs.email = { contains: email } as Prisma.StringFilter;
    }

    if (dni && typeof dni === 'string') {
      userIs.dni = { contains: dni } as Prisma.StringFilter;
    }

    if (Object.keys(userIs).length > 0) {
      where.User = { is: userIs } as any;
    }

    const [totalCuotas, cuotas] = await prisma.$transaction([
      prisma.cuota.count({ where }),
      prisma.cuota.findMany({
        where,
        skip,
        take,
        orderBy: { vence: 'desc' },
        select: {
          ID_Cuota: true,
          mes: true,
          importe: true,
          vence: true,
          pagada: true,
          vencida: true,
          formaPago: true,
          fechaPago: true,
          ID_Usuario: true,
          User: {
            select: {
              ID_Usuario: true,
              email: true,
              nombre: true,
              apellido: true,
              plan: { select: { ID_Plan: true, nombre: true, precio: true, duracion: true, sesionesPorSemana: true, sesionesGracia: true, requiereTurno: true } }
            }
          },
          Plan: true,
          fechaInicio: true,
          fechaFin: true,
          planNombreSnapshot: true,
          planDuracionSnapshot: true,
          planSesionesSemanaSnapshot: true,
          planSesionesGraciaSnapshot: true,
          planRequiereTurnoSnapshot: true
        }
      })
    ]);

    const totalPages = Math.ceil(totalCuotas / take);

    res.status(200).json({
      meta: { totalItems: totalCuotas, take, page: pageNumber, totalPages },
      data: cuotas
    });
  } catch (error: any) {
    console.error('Error al obtener las cuotas paginadas:', error);
    res.status(500).json({ message: 'Error al obtener las cuotas', error: error.message });
  }
};


// 4. Obtener todas las cuotas por usuario
export const getAllCuotasByUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const idUsuario = parseInt(req.params.idUsuario, 10);
    if (isNaN(idUsuario)) {
      res.status(400).json({ message: 'ID de usuario inválido' });
      return;
    }

    const cuotas = await prisma.cuota.findMany({
      where: { ID_Usuario: idUsuario },
      orderBy: { vence: 'desc' }, // <-- orden descendente por fecha de vencimiento
      select: {
        ID_Cuota: true,
        mes: true,
        importe: true,
        vence: true,
        pagada: true,
        vencida: true,
        formaPago: true,
        fechaPago: true,
        ID_Usuario: true,
        User: {
          select: {
            ID_Usuario: true,
            email: true,
            nombre: true,
            apellido: true,
            plan: { select: { ID_Plan: true, nombre: true, precio: true, duracion: true, sesionesPorSemana: true, sesionesGracia: true, requiereTurno: true } }
          }
        },
        Plan: true,
        fechaInicio: true,
        fechaFin: true,
        planNombreSnapshot: true,
        planDuracionSnapshot: true,
        planSesionesSemanaSnapshot: true,
        planSesionesGraciaSnapshot: true,
        planRequiereTurnoSnapshot: true
      }
    });

    res.status(200).json(cuotas);
  } catch (error: any) {
    console.error('Error al obtener las cuotas por usuario:', error);
    res.status(500).json({ message: 'Error al obtener las cuotas por usuario', error: error.message });
  }
};

// 5. Eliminar cuota
const deleteCuota = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ message: 'ID de cuota inválido' });
      return;
    }
    const result = await prisma.$transaction(async (tx) => {
      const cuota = await tx.cuota.findUnique({
        where: { ID_Cuota: id },
        select: { ID_Cuota: true }
      });

      if (!cuota) {
        return null;
      }

      const turnosEliminados = await tx.turno.deleteMany({
        where: { ID_Cuota: id }
      });

      await tx.cuota.delete({ where: { ID_Cuota: id } });

      return { turnosEliminados: turnosEliminados.count };
    });

    if (!result) {
      res.status(404).json({ message: 'Cuota no encontrada' });
      return;
    }

    res.status(200).json({
      message: `Cuota ${id} eliminada exitosamente`,
      turnosEliminados: result.turnosEliminados
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: 'Error al eliminar la cuota', error: error.message });
  }
};

// 6. Actualizar cuota
const updateCuota = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ message: 'ID de cuota inválido' });
      return;
    }

    const { mes, importe, vence, plan, pagada, fechaPago } = req.body;
    const dataToUpdate: any = {};

    if (mes) dataToUpdate.mes = mes;
    if (importe) dataToUpdate.importe = Number(importe);
    if (vence) dataToUpdate.vence = new Date(vence);
    if (pagada !== undefined) {
      dataToUpdate.pagada = pagada;
      if (pagada) dataToUpdate.vencida = false;
    }
    if (fechaPago) dataToUpdate.fechaPago = new Date(fechaPago);

    const updatedCuota = await prismaC.update({
      where: { ID_Cuota: id },
      data: dataToUpdate,
      include: { User: { select: { ID_Usuario: true, email: true, nombre: true, apellido: true } } }
    });

    res.status(200).json({ message: 'Cuota actualizada exitosamente', cuota: updatedCuota });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: 'Error al actualizar la cuota', error: error.message });
  }
};

// 7. Pagar cuota
const payCuota = async (req: Request, res: Response): Promise<void> => {
  try {
    const cuotaId = parseInt(req.params.id, 10);
    const { formaPago } = req.body;

    if (isNaN(cuotaId) || !formaPago) {
      res.status(400).json({ message: 'ID de cuota o formaPago inválido' });
      return;
    }

    const updatedCuota = await prismaC.update({
      where: { ID_Cuota: cuotaId },
      data: {
        pagada: true,
        vencida: false,
        fechaPago: new Date(),
        formaPago
      },
      include: { User: { select: { ID_Usuario: true, email: true, nombre: true, apellido: true } } }
    });

    res.status(200).json({ message: 'Cuota pagada exitosamente', cuota: updatedCuota });
  } catch (error: any) {
    console.error('Error al pagar cuota:', error);
    res.status(500).json({ message: 'Error al actualizar la cuota', error: error.message });
  }
};

// recordatorio pago cuota a 3 dias de vencer.
// export const getCuotasVencenPronto = async (req: Request, res: Response): Promise<void> => {
//   const idUsuario = Number(req.params.idUsuario || req.params.id);
//   if (isNaN(idUsuario)) {
//     res.status(400).json({ message: "El parámetro 'idUsuario' debe ser un número válido" });
//     return;
//   }

//   try {
//     // 1) Obtener todas las cuotas pendientes del usuario (no pagadas)
//     const cuotasPendientes = await prisma.cuota.findMany({
//       where: {
//         ID_Usuario: idUsuario,
//         pagada: false
//       },
//       orderBy: { vence: "asc" }
//     });

//     // 2) Calcular "días restantes" respecto a ahora
//     // Ten en cuenta zona horaria: el cálculo usa la hora del servidor.
//     const MS_PER_DAY = 1000 * 60 * 60 * 24;
//     const now = new Date();

//     const proximas: Array<any> = [];
//     for (const c of cuotasPendientes) {
//       // c.vence viene como Date (JS Date) desde prisma
//       const venceDate = new Date(c.vence);
//       // Tomamos diferencia en días (redondeo hacia arriba para contar días parciales como 1 día restante)
//       const diffMs = venceDate.getTime() - now.getTime();
//       const daysLeft = Math.ceil(diffMs / MS_PER_DAY);

//       // Condición: si vence en 0..3 días (incluye hoy si daysLeft === 0)
//       if (daysLeft >= 0 && daysLeft <= 3) {
//         proximas.push({
//           ID_Cuota: c.ID_Cuota,
//           mes: c.mes,
//           importe: c.importe,
//           vence: venceDate.toISOString(),
//           daysLeft,
//           pagada: c.pagada,
//           formaPago: c.formaPago ?? null
//         });
//       }
//     }

//     const message = proximas.length > 0
//       ? `Tienes ${proximas.length} cuota(s) que vencen en menos de 3 días`
//       : "No hay cuotas por vencer en los próximos 3 días";

//     res.status(200).json({
//       message,
//       remindersCount: proximas.length,
//       reminders: proximas
//     });
//   } catch (error: any) {
//     console.error("Error obteniendo recordatorios de cuotas:", error);
//     res.status(500).json({ message: "Error obteniendo recordatorios de cuotas", error: error.message });
//   }
// };
export const getCuotasVencenPronto = async (req: Request, res: Response): Promise<void> => {
  const idUsuario = Number(req.params.idUsuario || req.params.id);
  if (isNaN(idUsuario)) {
    res.status(400).json({ message: "El parámetro 'idUsuario' debe ser un número válido" });
    return;
  }

  try {
    // 1) Obtener todas las cuotas NO pagadas del usuario ordenadas por vencimiento ascendente
    const cuotasPendientes = await prisma.cuota.findMany({
      where: {
        ID_Usuario: idUsuario,
        pagada: false
      },
      orderBy: { vence: "asc" }
    });

    // 2) Preparar cálculo por día (UTC)
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const now = new Date();
    const startOfTodayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    // 3) Buckets
    const vencidas: any[] = [];
    const venceHoy: any[] = [];
    const porVencer: any[] = [];

    for (const c of cuotasPendientes) {
      const venceDate = new Date(c.vence);
      const venceDayUTC = Date.UTC(venceDate.getUTCFullYear(), venceDate.getUTCMonth(), venceDate.getUTCDate());
      const daysLeft = Math.floor((venceDayUTC - startOfTodayUTC) / MS_PER_DAY);

      // Ignorar pagadas (ya filtradas por query), clasificar según daysLeft
      const common = {
        ID_Cuota: c.ID_Cuota,
        mes: c.mes,
        importe: c.importe,
        vence: venceDate.toISOString(),
        daysLeft,
        pagada: c.pagada,
        formaPago: c.formaPago ?? null
      };

      if (daysLeft < 0) {
        // ya vencida
        vencidas.push({ ...common, vencida: true, estado: "Vencida" });
      } else if (daysLeft === 0) {
        // vence hoy
        venceHoy.push({ ...common, vencida: false, estado: "Vence hoy" });
      } else if (daysLeft > 0 && daysLeft <= 3) {
        // por vencer en <= 3 días
        porVencer.push({ ...common, vencida: false, estado: `Vence en ${daysLeft} día(s)` });
      } else {
        // > 3 días => no lo devolvemos en los arrays (pero podrías agregarlos si lo querés)
      }
    }

    // 4) Construir mensajes legibles para el frontend
    const totalVencidas = vencidas.length;
    const totalVenceHoy = venceHoy.length;
    const totalPorVencer = porVencer.length;
    const totalRecordatorios = totalVenceHoy + totalPorVencer;

    let messageParts: string[] = [];
    if (totalRecordatorios > 0) {
      messageParts.push(`Tienes ${totalRecordatorios} cuota(s) que vencen hoy o en los próximos 3 días`);
    } else {
      messageParts.push("No hay cuotas por vencer en los próximos 3 días");
    }

    if (totalVencidas > 0) {
      messageParts.push(`Además tienes ${totalVencidas} cuota(s) vencida(s)`);
    } else {
      messageParts.push("No tienes cuotas vencidas");
    }

    const combinedMessage = messageParts.join(". ") + ".";

    res.status(200).json({
      message: combinedMessage,
      hasVencidas: totalVencidas > 0,
      totals: {
        vencidas: totalVencidas,
        venceHoy: totalVenceHoy,
        porVencer: totalPorVencer,
        recordatorios: totalRecordatorios
      },
      vencidas,
      venceHoy,
      porVencer
    });
  } catch (error: any) {
    console.error("Error obteniendo recordatorios de cuotas:", error);
    res.status(500).json({ message: "Error obteniendo recordatorios de cuotas", error: error.message });
  }
};

export const cuotaMethods = {
  createCuota,
  generateMonthlyCuotas,
  prepararCuotasMasivas,
  generarCuotasLote,
  regenerateTurnosFijosByUsuario,
  getAllCuotas,
  getAllCuotasByUsuario,
  deleteCuota,
  updateCuota,
  payCuota,
  getCuotasVencenPronto,
};
