import express from 'express';
import { authMethods } from '../controllers/auth.Controller.js';
import { authenticateToken } from '../services/auth.service.js';

const authRouter = express.Router();

authRouter.post('/register', authMethods.register)
authRouter.post('/login', authMethods.login)
authRouter.post("/forgot-password", authMethods.forgotPassword);
authRouter.post("/reset-password", authMethods.resetPassword);
authRouter.put("/change-password", authenticateToken, authMethods.changePassword);

export default authRouter;