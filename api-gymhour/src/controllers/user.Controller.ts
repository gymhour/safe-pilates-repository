import { Prisma } from '@prisma/client';
import { Request, Response } from "express";
import prisma from "../models/Prisma.js";
import { deleteImage, getImageUrl, uploadImageBuffer } from "../services/cloudinary.service.js";
import { sendWelcomeEmail } from "../services/email.service.js";
import { hashPassword } from "../services/password.service.js";

type UsuarioReturn = {
    ID_Usuario: number;
    email: string;
    nombre: string | null;
    apellido: string | null;
    direc: string | null;
    tel: string | null;
    profesion: string | null;
    tipo: string | null;
    fechaCumple: Date | null;
    estado: boolean | null;
    imagenUsuario: string | null;
    fechaRegistro: Date;
    plan: {
        ID_Plan: number;
        nombre: string;
        precio: number;
    } | null;
};

/** CREATE USER */
export const createUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            email, password, nombre, apellido,
            profesion, direc, tel, tipo,
            fechaCumple, ID_Plan: rawPlanId
        } = req.body;

        if (!email || !password) {
            res.status(400).json({ message: 'Email y password son obligatorios' });
            return;
        }
        // Convertir ID_Plan a número
        const planId = rawPlanId !== undefined
            ? Number.parseInt(rawPlanId as string, 10)
            : null;
        if (rawPlanId !== undefined && (!Number.isInteger(planId) || planId! < 1)) {
            res.status(400).json({ message: 'ID_Plan debe ser un entero válido' });
            return;
        }
        // 1) Crear usuario sin imagen
        const hashedPassword = await hashPassword(password);
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                nombre: nombre || null,
                apellido: apellido || null,
                profesion: profesion || null,
                direc: direc || null,
                tel: tel || null,
                tipo: tipo || null,
                fechaCumple: fechaCumple ? new Date(fechaCumple) : null,
                estado: true,
                ID_Plan: planId
            },
            include: {
                plan: true
            }
        });

        // 2) Si viene archivo, subirlo a la carpeta 'users'
        if (req.file) {
            const publicId = `user_${user.ID_Usuario}`;
            const result = await uploadImageBuffer(
                req.file.buffer as Buffer,
                publicId,
                'users'
            );
            await prisma.user.update({
                where: { ID_Usuario: user.ID_Usuario },
                data: { imagenUsuario: result.public_id }
            });
            user.imagenUsuario = result.public_id;
        }

        // 3) Enviar email (sin bloquear)
        try {
            await sendWelcomeEmail(user.email, user.nombre ?? "");
        } catch {
            // no hacemos nada si falla el mail
        }

        res.status(201).json(user);
    } catch (error: any) {
        if (error.code === 'P2002') {
            res.status(400).json({ message: 'El email ya existe' });
        } else {
            console.error(error);
            res.status(500).json({ error: 'Hubo un error en el registro' });
        }
    }
};

/** GET ALL USERS (PAGINATED + FILTERS + PLAN) */
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
    try {
        const { page = '1', tipo, nombre, apellido, email, estado } = req.query;
        const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
        const take = 15, skip = (pageNumber - 1) * take;

        const where: Prisma.UserWhereInput = {};
        if (tipo) where.tipo = tipo as string;
        if (nombre) where.nombre = { contains: nombre as string } as Prisma.StringFilter;
        if (apellido) where.apellido = { contains: apellido as string } as Prisma.StringFilter;
        if (email) where.email = { contains: email as string } as Prisma.StringFilter;

        // nuevo: parseo y validación de "estado"
        if (estado !== undefined) {
            const s = (estado as string).toLowerCase();
            if (s === 'true' || s === '1') {
                where.estado = true;
            } else if (s === 'false' || s === '0') {
                where.estado = false;
            } else if (s === 'null') {
                // Prisma typing puede no aceptar `null` directo, casteamos (es seguro semánticamente)
                (where as any).estado = null;
            } else {
                res.status(400).json({ message: "Parametro 'estado' invalido. Usar true|false|1|0|null" });
                return;
            }
        }

        const [total, users] = await prisma.$transaction([
            prisma.user.count({ where }),
            prisma.user.findMany({
                where, skip, take, orderBy: { fechaRegistro: 'desc' },
                select: {
                    ID_Usuario: true, email: true, nombre: true, apellido: true,
                    direc: true, tel: true, profesion: true, tipo: true,
                    fechaCumple: true, estado: true, imagenUsuario: true,
                    fechaRegistro: true,
                    plan: { select: { ID_Plan: true, nombre: true, precio: true } }
                }
            })
        ]);

        const data = (users as (UsuarioReturn & { imagenUsuario: string | null })[]).map(u => ({
            ...u,
            avatarUrl: u.imagenUsuario
                ? getImageUrl(u.imagenUsuario, { secure: true, width: 80, height: 80, crop: 'thumb' })
                : null
        }));

        res.status(200).json({
            meta: { totalItems: total, take, page: pageNumber, totalPages: Math.ceil(total / take) },
            data
        });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Hubo un error, prueba más tarde' });
    }
};

/** GET ENTRENADORES (INCLUYE PLAN) */
export const getAllEntrenadores = async (req: Request, res: Response): Promise<void> => {
    try {
        const entrenadores = await prisma.user.findMany({
            where: { tipo: "entrenador" },
            select: {
                ID_Usuario: true,
                email: true,
                nombre: true,
                apellido: true,
                direc: true,
                tel: true,
                profesion: true,
                tipo: true,
                fechaCumple: true,
                estado: true,
                imagenUsuario: true,
                fechaRegistro: true,
                plan: {
                    select: {
                        ID_Plan: true,
                        nombre: true,
                        precio: true
                    }
                },
                ClasesACargo: {               // <— relación que queremos incluir
                    select: {
                        ID_Clase: true,
                        nombre: true,
                        descripcion: true,        // opcional, si quieres más datos
                        imagenClase: true
                    }
                }
            }
        });

        // Añadimos avatarUrl y devolvemos todo junto
        const result = entrenadores.map(e => ({
            ID_Usuario: e.ID_Usuario,
            email: e.email,
            nombre: e.nombre,
            apellido: e.apellido,
            direc: e.direc,
            tel: e.tel,
            profesion: e.profesion,
            tipo: e.tipo,
            fechaCumple: e.fechaCumple,
            estado: e.estado,
            fechaRegistro: e.fechaRegistro,
            plan: e.plan,
            clasesACargo: e.ClasesACargo.map(c => ({
                ID_Clase: c.ID_Clase,
                nombre: c.nombre,
                descripcion: c.descripcion,
                imagenClase: c.imagenClase
            })),
            avatarUrl: e.imagenUsuario
                ? getImageUrl(e.imagenUsuario)
                : null
        }));

        res.status(200).json(result);
    } catch (error: any) {
        console.error("[getAllEntrenadores] Error:", error);
        res.status(500).json({ message: "Hubo un error, prueba más tarde" });
    }
};

/** GET USER BY ID (INCLUYE PLAN) */
export const getUserById = async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) {
        res.status(400).json({ message: "ID inválido" });
        return;
    }

    try {
        const user = await prisma.user.findUnique({
            where: { ID_Usuario: id },
            select: {
                ID_Usuario: true,
                email: true,
                nombre: true,
                apellido: true,
                profesion: true,
                direc: true,
                tel: true,
                tipo: true,
                fechaRegistro: true,
                fechaBaja: true,
                fechaCumple: true,
                estado: true,
                resetToken: true,
                resetTokenExpiry: true,
                imagenUsuario: true,
                ID_Plan: true,
                plan: {
                    select: {
                        ID_Plan: true,
                        nombre: true,
                        precio: true
                    }
                }
            }
        });

        if (!user) {
            res.status(404).json({ message: "Usuario no encontrado" });
            return;
        }

        const avatarUrl = user.imagenUsuario
            ? getImageUrl(user.imagenUsuario, { secure: true, width: 200, height: 200, crop: 'thumb' })
            : null;

        res.status(200).json({ ...user, avatarUrl });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: "Hubo un error, prueba más tarde" });
    }
};


/** UPDATE USER (INCLUYE PLAN) */
export const updateUser = async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    const {
        email,
        password,
        nombre,
        apellido,
        profesion,
        direc,
        tel,
        tipo,
        fechaCumple,
        estado,
        ID_Plan: ID_PlanStr
    } = req.body;
    const file = req.file;

    try {
        // 1) Build data to update
        const data: any = {};
        if (email) data.email = email;
        if (nombre) data.nombre = nombre;
        if (apellido) data.apellido = apellido;
        if (profesion) data.profesion = profesion;
        if (direc) data.direc = direc;
        if (tel) data.tel = tel;
        if (tipo) data.tipo = tipo;
        if (fechaCumple) data.fechaCumple = new Date(fechaCumple);
        if (estado !== undefined) data.estado = estado;

        // Convertir ID_Plan de string a number y validar
        if (ID_PlanStr !== undefined) {
            const planId = Number(ID_PlanStr);
            if (isNaN(planId)) {
                res.status(400).json({ message: 'ID_Plan inválido; debe ser un número' });
                return;
            }
            data.ID_Plan = planId;
        }

        if (password) {
            data.password = await hashPassword(password);
        }

        // 2) Si hay nuevo avatar, eliminar el anterior y subir el nuevo
        if (file) {
            const prev = await prisma.user.findUnique({
                where: { ID_Usuario: id },
                select: { imagenUsuario: true }
            });
            if (prev?.imagenUsuario) {
                try {
                    await deleteImage(prev.imagenUsuario);
                } catch { /* ignorar fallo */ }
            }
            const result = await uploadImageBuffer(
                file.buffer as Buffer,
                `user_${id}`,
                'users'
            );
            data.imagenUsuario = result.public_id;
        }

        // 3) Actualizar usuario en la BD
        const updated = await prisma.user.update({
            where: { ID_Usuario: id },
            data,
            include: { plan: true }
        });

        res.status(200).json(updated);
    } catch (error: any) {
        console.error('Error updating user:', error);
        // Manejar violación de unique en email
        if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
            res.status(400).json({ message: 'El email ya existe' });
        } else {
            res.status(500).json({ message: 'Hubo un error, prueba más tarde', error: error.message });
        }
    }
};

/** DELETE USER */
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    try {
        const user = await prisma.user.findUnique({ where: { ID_Usuario: id } });
        if (!user) {
            res.status(404).json({ message: 'Usuario no encontrado' });
            return;
        }
        if (user.tipo === 'Admin') {
            res.status(403).json({ message: 'No se puede eliminar un admin' });
            return;
        }
        if (user.imagenUsuario) await deleteImage(user.imagenUsuario);
        await prisma.user.delete({ where: { ID_Usuario: id } });
        res.status(200).json({ message: `Usuario ${id} eliminado` });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Hubo un error, prueba más tarde', error: error.message });
    }
};

const estadoUser = async (req: Request, res: Response): Promise<void> => {
    try {
        // 1) Parsea y valida el ID de ruta
        const rawId = req.params.id;
        const ID_Usuario = Number.parseInt(rawId, 10);
        if (!rawId || !Number.isInteger(ID_Usuario) || ID_Usuario < 1) {
            res.status(400).json({ message: "Parámetro ‘id’ inválido" });
            return;
        }

        // 2) Valida que en el body venga `estado` y sea booleano
        const { estado } = req.body;
        if (typeof estado !== 'boolean') {
            res.status(400).json({ message: "El campo 'estado' es obligatorio y debe ser true o false" });
            return;
        }

        // 3) Actualiza el usuario con el nuevo estado
        const user = await prisma.user.update({
            where: { ID_Usuario },
            data: { estado },
            select: {
                ID_Usuario: true,
                email: true,
                estado: true,
                nombre: true,
                apellido: true
            }
        });

        // 4) Devuelve el usuario actualizado
        const mensaje = estado
            ? "Usuario activado correctamente"
            : "Usuario desactivado correctamente";

        res.json({ message: mensaje, user });

    } catch (error: any) {
        if (error.code === "P2025") {
            // Prisma no encontró el registro
            res.status(404).json({ message: "Usuario no encontrado" });
        } else {
            console.error(error);
            res.status(500).json({ message: "Error interno al actualizar estado de usuario" });
        }
    }
};

export const getAllAdmins = async (req: Request, res: Response): Promise<void> => {
    try {
        const admins = await prisma.user.findMany({
            where: { tipo: { equals: "admin" } }, // sin mode
            orderBy: { fechaRegistro: "desc" },
            select: {
                ID_Usuario: true,
                tipo: true,
                estado: true,
            }
        });

        res.status(200).json(admins);
    } catch (error: any) {
        console.error("[getAllAdmins] Error:", error);
        res.status(500).json({ message: "Hubo un error, prueba más tarde" });
    }
};

export const userMethods = {
    createUser,
    getAllUsers,
    deleteUser,
    getUserById,
    updateUser,
    getAllEntrenadores,
    getAllAdmins,
    estadoUser
};