// controllers/admin.Controller.ts
import { Request, Response } from 'express';
import prismaC from "../models/Cuota.js";
import prismaU from "../models/User.js";

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
    try {
        // 1) Cantidad total de usuarios activos
        const totalActiveUsers = await prismaU.count({
            where: { estado: true }
        });

        // 2) Definir el mes actual en formato YYYY-MM
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const monthStr = `${year}-${month}`; // e.g. "2025-05"

        // 3) Cuotas pagadas y pendientes en el mes actual (conteo)
        const [paidCount, pendingCount] = await Promise.all([
            prismaC.count({
                where: { mes: monthStr, pagada: true }
            }),
            prismaC.count({
                where: { mes: monthStr, pagada: false }
            })
        ]);

        // 4) Suma de importes de cuotas pagadas y pendientes en el mes actual
        const [paidSum, pendingSum] = await Promise.all([
            prismaC.aggregate({
                where: { mes: monthStr, pagada: true },
                _sum: { importe: true }
            }),
            prismaC.aggregate({
                where: { mes: monthStr, pagada: false },
                _sum: { importe: true }
            })
        ]);

        // 5) Histórico mensual de importes pagados
        const monthlySums = await prismaC.groupBy({
            by: ['mes'],
            where: { pagada: true },
            _sum: { importe: true },
            orderBy: { mes: 'asc' }
        });

        const monthlyPaidAmounts = monthlySums.map(entry => ({
            mes: entry.mes,
            totalPagado: entry._sum.importe ?? 0
        }));

        // -----------------------------
        // NUEVO: cuotas vencidas (por flag `vencida: true`)
        // -----------------------------
        const [overdueCount, overdueSumAgg] = await Promise.all([
            prismaC.count({ where: { vencida: true } }),
            prismaC.aggregate({ where: { vencida: true }, _sum: { importe: true } })
        ]);
        const overdueAmount = overdueSumAgg._sum.importe ?? 0;

        // 6) Responder todo junto
        res.status(200).json({
            kpi: {
                totalActiveUsers,
                quotasPaidThisMonth: paidCount,
                quotasPendingThisMonth: pendingCount,
                totalAmountPaidThisMonth: paidSum._sum.importe ?? 0,
                totalAmountPendingThisMonth: pendingSum._sum.importe ?? 0,
                quotasOverdue: overdueCount,
                totalAmountOverdue: overdueAmount
            },
            history: monthlyPaidAmounts
        });
    } catch (error: any) {
        console.error('Error obteniendo estadísticas de dashboard:', error);
        res.status(500).json({
            message: 'Error al obtener estadísticas de dashboard',
            error: error.message
        });
    }
};


export const adminMethods = {
    getDashboardStats
}