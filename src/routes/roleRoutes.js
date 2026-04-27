import express from 'express';
import {
    createRoleController,
    getRolesController,
    getRoleByIdController,
    updateRoleController,
    deleteRoleController
} from '../controllers/roleController.js';
import { authenticate, requirePermissions } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);

// We define permissions like 'create:role', 'read:role', 'update:role', 'delete:role'
router.post('/', requirePermissions('create:role'), createRoleController);
router.get('/', requirePermissions('read:role'), getRolesController);
router.get('/:id', requirePermissions('read:role'), getRoleByIdController);
router.put('/:id', requirePermissions('update:role'), updateRoleController);
router.delete('/:id', requirePermissions('delete:role'), deleteRoleController);

export default router;
