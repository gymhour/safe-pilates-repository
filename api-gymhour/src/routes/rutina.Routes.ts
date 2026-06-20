import express from 'express';
import { rutinaMethods } from '../controllers/rutina.Controller.js';
import { authenticateToken, isAdminOrEntrenador } from '../services/auth.service.js';

const rutinaRouter = express.Router();
// 1) Rutas específicas primero:
rutinaRouter.get('/entrenador/:idEntrenador', authenticateToken, isAdminOrEntrenador, rutinaMethods.getRutinasByEntrenador);
rutinaRouter.get('/usuario/:idUsuario', rutinaMethods.getRutinasByUsuario);
rutinaRouter.get('/dia/:dayOfWeek', rutinaMethods.getRutinasByDayOfWeek);
rutinaRouter.get('/admins/', rutinaMethods.getRutinasByAdmins);
rutinaRouter.get('/asignadas', rutinaMethods.getRutinasAsignadas);

// 2) Luego las genéricas
rutinaRouter.get('/', rutinaMethods.getAllRutinasWithDetails);
rutinaRouter.post('/', rutinaMethods.createRutinaWithBlocks);
rutinaRouter.get('/:id', rutinaMethods.getRutinaById);
rutinaRouter.put('/:id', rutinaMethods.updateRutinaWithBlocks);
rutinaRouter.delete('/:id', rutinaMethods.deleteRutinaWithBlocks);

export default rutinaRouter;