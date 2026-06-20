import express from 'express';
import { userMethods } from '../controllers/user.Controller.js';
import { authServices } from '../services/auth.service.js';
import upload from '../services/multer.service.js';

const userRouter = express.Router();


userRouter.put("/estado/:id", userMethods.estadoUser);
userRouter.get('/', authServices.authenticateToken, authServices.isAdminOrEntrenador, userMethods.getAllUsers)
userRouter.get('/entrenadores', authServices.authenticateToken, userMethods.getAllEntrenadores)
userRouter.get('/admins', authServices.authenticateToken, authServices.isAdmin, userMethods.getAllAdmins)
userRouter.post('/', authServices.authenticateToken, authServices.isAdmin, upload.single('avatar'), userMethods.createUser)
userRouter.get('/:id', authServices.authenticateToken, userMethods.getUserById)
userRouter.put('/:id', authServices.authenticateToken, authServices.isAdmin, upload.single('avatar'), userMethods.updateUser)
userRouter.delete('/:id', authServices.authenticateToken, authServices.isAdmin, userMethods.deleteUser)

export default userRouter;