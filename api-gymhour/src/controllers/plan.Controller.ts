import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

// Crear un nuevo plan
export const createPlan = async (req: Request, res: Response): Promise<void> => {
    try {
        const { nombre, precio, desc } = req.body;
        if (!nombre || typeof precio !== 'number') {
            res.status(400).json({ message: "Faltan 'nombre' o 'precio' válidos" });
            return;
        }
        const plan = await prisma.plan.create({
            data: { nombre, precio, desc }
        });
        res.status(201).json({ message: 'Plan creado', plan });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Error creando plan', error: error.message });
    }
};

// Listar todos los planes
export const getAllPlans = async (req: Request, res: Response): Promise<void> => {
    try {
        const plans = await prisma.plan.findMany();
        res.status(200).json(plans);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo planes', error: error.message });
    }
};

// Obtener un plan por ID
export const getPlanById = async (req: Request, res: Response): Promise<void> => {
    try {
        const ID_Plan = Number(req.params.id);
        const plan = await prisma.plan.findUnique({ where: { ID_Plan } });
        if (!plan) {
            res.status(404).json({ message: 'Plan no encontrado' });
            return;
        }
        res.status(200).json(plan);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo plan', error: error.message });
    }
};

// Actualizar un plan
export const updatePlan = async (req: Request, res: Response): Promise<void> => {
    try {
        const ID_Plan = Number(req.params.id);
        const { nombre, precio, desc } = req.body;
        if (!nombre && typeof precio !== 'number') {
            res.status(400).json({ message: 'Nada para actualizar' });
            return;
        }
        const updated = await prisma.plan.update({
            where: { ID_Plan },
            data: {
                ...(nombre && { nombre }),
                ...(precio !== undefined && { precio }),
                ...(desc && { desc }),
            }
        });
        res.status(200).json({ message: 'Plan actualizado', plan: updated });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Error actualizando plan', error: error.message });
    }
};

// Borrar un plan
export const deletePlan = async (req: Request, res: Response): Promise<void> => {
    try {
        const ID_Plan = Number(req.params.id);
        await prisma.plan.delete({ where: { ID_Plan } });
        res.status(200).json({ message: 'Plan eliminado' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Error eliminando plan', error: error.message });
    }
};


export const planMethods = {
    createPlan,
    deletePlan,
    getPlanById,
    getAllPlans,
    updatePlan,
}