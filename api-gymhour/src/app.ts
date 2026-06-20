import cors from "cors";
import dotenv from 'dotenv';
import express from 'express';
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from 'morgan';
import { dirname, join } from 'path';
import swaggerUi from 'swagger-ui-express';
import { fileURLToPath } from 'url';
import adminRoutes from './routes/admin.Routes.js';
import asistenteRoutes from "./routes/asistente.Routes.js";
import authRoutes from './routes/auth.Routes.js';
import claseRoutes from './routes/clase.Routes.js';
import cuotaRoutes from './routes/cuota.Routes.js';
import ejercicioRoutes from "./routes/ejercicio.Routes.js";
import ejercicioMedicionRoutes from './routes/ejercicioMedicion.Routes.js';
import historicoEjercicioRoutes from './routes/historicoMedicion.Routes.js';
import planRoutes from './routes/plan.Routes.js';
import rutinaRoutes from './routes/rutina.Routes.js';
import turnoRoutes from './routes/turno.Routes.js';
import userRouter from './routes/user.Routes.js';

dotenv.config();

const app = express();
// Seguridad básicaaaa
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json());
app.use(cors());
app.use(morgan('dev'));

// Limitar el número de peticiones por IP (100 cada 15 minutos)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 250, // Máximo 100 peticiones por IP
    message: "Demasiadas peticiones desde esta IP, por favor intente más tarde.",
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);

const PORT = process.env.PORT || 3000;;

// Reconstruir __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1) Sirve estáticos desde /public
app.use(express.static(join(__dirname, '..', 'public')));

// 2) Swagger UI apuntando al JSON estático
app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
        swaggerUrl: '/swagger.json',
        explorer: true
    })
);

// Rutas
app.use('/usuarios', userRouter);
app.use('/admin', adminRoutes);
app.use('/auth', authRoutes);
app.use('/clase', claseRoutes);
app.use('/turnos', turnoRoutes);
app.use('/rutinas', rutinaRoutes);
app.use('/ejercicios-resultados', ejercicioMedicionRoutes);
app.use('/historicoEjercicio', historicoEjercicioRoutes);
app.use('/cuotas', cuotaRoutes);
app.use('/planes', planRoutes);
app.use('/asistente', asistenteRoutes);
app.use('/ejercicios', ejercicioRoutes);

app.use('*', (req, res) => {
    res.status(404).send('Ruta no encontrada');
});

app.listen(PORT, () => {
    console.log(`API corriendo en http://localhost:${PORT}/`);
});

export default app;