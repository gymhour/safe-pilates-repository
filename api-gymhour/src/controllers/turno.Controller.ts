import { Request, Response } from "express";
import prismaHC from "../models/HorarioClase.js";
import prisma from "../models/Prisma.js";
import prismaTurno from "../models/Turno.js";
import prismaUsu from "../models/User.js";

const getAllTurnos = async (req: Request, res: Response): Promise<void> => {
  try {
    // Obtener todos los turnos
    const turnos = await prisma.turno.findMany({
      include: {
        User: {
          select: {
            ID_Usuario: true,
            email: true,
            nombre: true,
            apellido: true,
          }
        }, // Información del usuario relacionado
        HorarioClase: {
          include: {
            Clase: true, // Información de la clase relacionada
          },
        },
      },
    });

    res.status(200).json(turnos);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener los turnos", error: error.message });
  }
};

const createTurno = async (req: Request, res: Response): Promise<void> => {
  try {
    const { ID_Usuario, ID_HorarioClase, fecha } = req.body;
    const fechaUTC = new Date(); // hora en UTC
    // Restar 3 horas para simular UTC-3 (no maneja horario de verano)
    fechaUTC.setHours(fechaUTC.getHours() - 3);
    // Validar que los datos necesarios estén presentes
    if (!ID_Usuario || !ID_HorarioClase || !fecha) {
      res.status(400).json({ message: "Faltan datos obligatorios" });
      return;
    }

    // Verificar que el usuario exista
    const usuario = await prismaUsu.findUnique({
      where: { ID_Usuario },
    });
    if (!usuario) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }

    // Verificar que el horario exista
    const horario = await prismaHC.findUnique({
      where: { ID_HorarioClase },
      include: {
        Clase: true,
      },
    });

    if (!horario) {
      res.status(404).json({ message: "Horario no encontrado" });
      return;
    }

    // Validación: el mismo usuario no puede sacar más de un turno para el mismo horario en la misma fecha
    const userTurnoCount = await prismaTurno.count({
      where: {
        ID_HorarioClase,
        fecha: new Date(fecha),
        ID_Usuario
      },
    });

    if (userTurnoCount > 0) {
      res.status(400).json({ message: "El usuario ya tiene un turno para este horario en la fecha especificada" });
      return;
    }

    // Contar los turnos ya existentes para ese horario y fecha
    const turnosCount = await prismaTurno.count({
      where: {
        ID_HorarioClase,
        fecha: new Date(fecha),
      },
    });

    if (turnosCount >= horario.cupos) {
      res.status(400).json({ message: "No hay cupos disponibles para este horario" });
      return;
    }

    // Crear el turno
    const nuevoTurno = await prisma.turno.create({
      data: {
        fecha: new Date(fecha),
        estado: "pendiente",
        ID_Usuario,
        ID_HorarioClase,
        fechaCreacion: fechaUTC,
      },
      include: {
        HorarioClase: {
          include: {
            Clase: true,
          },
        },
        User: true,
      },
    });

    res.status(201).json({ message: "Turno creado exitosamente", turno: nuevoTurno });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: "Error al crear el turno", error: error.message });
  }
};


const deleteTurno = async (req: Request, res: Response): Promise<void> => {
  try {
    const id_turno = parseInt(req.params.id);

    // Validar que se haya proporcionado el ID del turno
    if (!id_turno) {
      res.status(400).json({ message: "El ID del turno es obligatorio" });
      return;
    }

    // Verificar que el turno exista
    const turno = await prisma.turno.findUnique({
      where: { id_turno: Number(id_turno) },
    });

    if (!turno) {
      res.status(404).json({ message: "El turno no existe" });
      return;
    }

    // Eliminar el turno
    await prisma.turno.delete({
      where: { id_turno: Number(id_turno) },
    });

    res.status(200).json({ message: "Turno eliminado exitosamente" });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: "Error al eliminar el turno", error: error.message });
  }
};

const getTurnoById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id_turno = parseInt(req.params.id);

    // Validar que se haya proporcionado el ID del turno
    if (!id_turno) {
      res.status(400).json({ message: "El ID del turno es obligatorio" });
      return;
    }

    // Buscar el turno por ID
    const turno = await prisma.turno.findUnique({
      where: { id_turno: Number(id_turno) },
      include: {
        User: {
          select: {
            ID_Usuario: true,
            email: true,
            nombre: true,
            apellido: true,
          }
        }, // Información del usuario relacionado
        HorarioClase: {
          include: {
            Clase: true, // Información de la clase relacionada
          },
        },
      },
    });

    // Verificar si el turno existe
    if (!turno) {
      res.status(404).json({ message: "El turno no existe" });
      return;
    }

    res.status(200).json(turno);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener el turno", error: error.message });
  }
};

const updateTurno = async (req: Request, res: Response): Promise<void> => {
  try {
    const id_turno = parseInt(req.params.id);
    const { fecha, estado, ID_HorarioClase, ID_Usuario } = req.body;

    // Validar si existe el turno
    const turnoExistente = await prisma.turno.findUnique({
      where: { id_turno: Number(id_turno) },
    });

    if (!turnoExistente) {
      res.status(404).json({ message: "El turno no existe" });
      return;
    }

    // Validar si hay cupos disponibles para el nuevo horario
    if (ID_HorarioClase) {
      const cuposOcupados = await prisma.turno.count({
        where: {
          ID_HorarioClase: Number(ID_HorarioClase),
          fecha: fecha || turnoExistente.fecha,
        },
      });

      const horarioClase = await prisma.horarioClase.findUnique({
        where: { ID_HorarioClase: Number(ID_HorarioClase) },
      });

      if (horarioClase && cuposOcupados >= horarioClase.cupos) {
        res
          .status(400)
          .json({ message: "No hay cupos disponibles para este horario" });
        return;
      }
    }

    // Actualizar el turno
    const turnoActualizado = await prisma.turno.update({
      where: { id_turno: Number(id_turno) },
      data: {
        fecha,
        estado,
        ID_HorarioClase: ID_HorarioClase || turnoExistente.ID_HorarioClase,
        ID_Usuario: ID_Usuario || turnoExistente.ID_Usuario,
      },
      include: {
        User: true,
        HorarioClase: {
          include: { Clase: true },
        },
      },
    });

    res.status(200).json({
      message: "Turno actualizado exitosamente",
      turno: turnoActualizado,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      message: "Error al actualizar el turno",
      error: error.message,
    });
  }
};

const getTurnosByUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = parseInt(req.params.idUsuario);

    // Validar que se haya pasado un ID de usuario válido
    if (isNaN(userId)) {
      res.status(400).json({ message: "El ID de usuario es obligatorio y debe ser un número" });
      return;
    }

    // Buscar todos los turnos de ese usuario
    const turnos = await prisma.turno.findMany({
      where: { ID_Usuario: userId },
      include: {
        User: {
          select: {
            ID_Usuario: true,
            email: true,
            nombre: true,
            apellido: true,
          }
        },
        HorarioClase: {
          include: { Clase: true }
        }
      },
      orderBy: { fecha: 'asc' }  // opcional: ordenados por fecha
    });

    res.status(200).json({ turnos });
  } catch (error: any) {
    console.error("Error al obtener turnos por usuario:", error);
    res.status(500).json({ message: "Error al obtener los turnos", error: error.message });
  }
};

export const turnoMethods = {
  createTurno,
  deleteTurno,
  getTurnoById,
  getAllTurnos,
  updateTurno,
  getTurnosByUsuario
}