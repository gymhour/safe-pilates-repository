import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import prismaC from '../models/Cuota.js'; // Ajusta la ruta según tu proyecto
import prisma from '../models/Prisma.js';
import prismaU from '../models/User.js';

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

// 1. Crear cuota
const createCuota = async (req: Request, res: Response): Promise<void> => {
  try {
    const idUsuarioParam = req.params.idUsuario;
    const { ID_Usuario, mes, importe, vence } = req.body;
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
        plan: { select: { nombre: true, precio: true } }
      }
    });
    if (!usuario) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    const nuevaCuota = await prismaC.create({
      data: {
        ID_Usuario: usuarioId,
        mes,
        importe: Number(importe),
        vence: venceDate,
        pagada: false,
        vencida: false,
        fechaPago: null,
        formaPago: null
      },
      include: {
        User: true
      }
    });

    res.status(201).json({ message: 'Cuota creada exitosamente', cuota: nuevaCuota });
  } catch (error: any) {
    console.error('Error al crear cuota:', error);
    res.status(500).json({ message: 'Error al crear cuota', error: error.message });
  }
};

// 2. Generar cuotas mensuales
export const generateMonthlyCuotas = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mes, vence, formaPago } = req.body;
    if (!mes || !vence) {
      res.status(400).json({ message: 'Faltan parámetros obligatorios: mes, vence' });
      return;
    }
    const venceDate = new Date(vence);
    if (isNaN(venceDate.getTime())) {
      res.status(400).json({ message: "'vence' no es una fecha válida" });
      return;
    }

    const usuarios = await prisma.user.findMany({
      where: { estado: true, plan: { isNot: null } },
      select: { ID_Usuario: true, plan: { select: { precio: true } } }
    });

    if (usuarios.length === 0) {
      res.status(404).json({ message: 'No hay usuarios activos con plan asignado' });
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
        inserted: 0
      });
      return;
    }

    const nuevasCuotas = pendientes.map(u => ({
      ID_Usuario: u.ID_Usuario,
      mes,
      importe: u.plan!.precio,
      vence: venceDate,
      pagada: false,
      vencida: false,
      formaPago: formaPago || null,
      fechaPago: null
    }));

    const { count } = await prisma.cuota.createMany({ data: nuevasCuotas });

    res.status(201).json({
      message: `Se generaron ${count} nuevas cuotas para el mes ${mes}`,
      totalUsuarios: usuarios.length,
      inserted: count
    });
  } catch (error: any) {
    console.error('Error generando cuotas masivas:', error);
    res.status(500).json({ message: 'Error al generar cuotas', error: error.message });
  }
};

export const getAllCuotas = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      page = '1',
      email,
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

    // 4) Construir de forma segura el filtro sobre User (plan + email)
    const existingUserIs = (where.User as any)?.is ?? {};
    let userIs: any = { ...existingUserIs };

    if (plan && typeof plan === 'string') {
      userIs.plan = { is: { nombre: { contains: plan } as Prisma.StringFilter } };
    }

    if (email && typeof email === 'string') {
      userIs.email = { contains: email } as Prisma.StringFilter;
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
              plan: { select: { ID_Plan: true, nombre: true, precio: true } }
            }
          }
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
            plan: { select: { ID_Plan: true, nombre: true, precio: true } }
          }
        }
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
    await prismaC.delete({ where: { ID_Cuota: id } });
    res.status(200).json({ message: `Cuota ${id} eliminada exitosamente` });
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
      include: { User: true }
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
      include: { User: true }
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
  getAllCuotas,
  getAllCuotasByUsuario,
  deleteCuota,
  updateCuota,
  payCuota,
  getCuotasVencenPronto
};
