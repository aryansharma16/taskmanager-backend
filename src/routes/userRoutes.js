import express from 'express';
import { createUserController, deleteUserController } from '../controllers/userController.js';
import { authenticate, requirePermissions } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes below
router.use(authenticate);

router.post('/', requirePermissions('create:user'), createUserController);

router.delete('/:id', requirePermissions('delete:user'), deleteUserController);

export default router;
