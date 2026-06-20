import express from 'express';
import { adminMethods } from '../controllers/admin.Controller.js';
import { authenticateToken, isAdmin } from '../services/auth.service.js';

const adminRouter = express.Router();

// Sólo accesible por admins (usa tu middleware de autenticación/autorización)
adminRouter.get('/dashboard', authenticateToken, isAdmin, adminMethods.getDashboardStats);

export default adminRouter;