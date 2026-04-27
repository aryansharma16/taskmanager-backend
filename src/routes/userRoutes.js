import express from 'express';
import { 
    createUserController, 
    deleteUserController,
    getUsersController,
    getUserByIdController,
    updateMemberRoleController
} from '../controllers/userController.js';
import { authenticate, requirePermissions } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes below
router.use(authenticate);

router.post('/', requirePermissions('create:user'), createUserController);
router.get('/', requirePermissions('read:user'), getUsersController);
router.get('/:id', requirePermissions('read:user'), getUserByIdController);
router.put('/:id/role', requirePermissions('update:user'), updateMemberRoleController);
router.delete('/:id', requirePermissions('delete:user'), deleteUserController);

export default router;
