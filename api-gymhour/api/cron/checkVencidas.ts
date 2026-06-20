import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export default async function handler(req: any, res: any) {
    try {
        const ahora = new Date();
        const { count } = await prisma.cuota.updateMany({
            where: {
                vence: { lt: ahora },
                pagada: false,
                vencida: false,   // ← sólo las que aún no estén marcadas
            },
            data: {
                vencida: true,
            },
        });
        res.status(200).json({ updated: count });
    } catch (err: any) {
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        await prisma.$disconnect();
    }
}
