import express from 'express';
import { turnoMethods } from '../controllers/turno.Controller.js';
import { authenticateToken } from '../services/auth.service.js';

const turnoRouter = express.Router();

turnoRouter.get('/usuario/:idUsuario', authenticateToken, turnoMethods.getTurnosByUsuario);
turnoRouter.get('/', authenticateToken, turnoMethods.getAllTurnos)
turnoRouter.post('/', authenticateToken, turnoMethods.createTurno)
turnoRouter.get('/:id', authenticateToken, turnoMethods.getTurnoById)
turnoRouter.put('/:id', authenticateToken, turnoMethods.updateTurno)
turnoRouter.delete('/:id', authenticateToken, turnoMethods.deleteTurno)

export default turnoRouter;