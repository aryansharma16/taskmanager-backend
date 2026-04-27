import express from 'express';
import { 
    createOrganisationController, 
    getOrganisationsController, 
    getOrganisationByIdController, 
    updateOrganisationController, 
    deleteOrganisationController 
} from '../controllers/organisationController.js';
import { authenticate, requirePermissions } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);

// SUPER_ADMIN level routes (requires '*')
router.post('/', requirePermissions('*'), createOrganisationController);
router.get('/', requirePermissions('*'), getOrganisationsController);

// Tenant level routes (requires specific org permissions)
router.get('/:id', requirePermissions('read:org'), getOrganisationByIdController);
router.put('/:id', requirePermissions('update:org'), updateOrganisationController);
router.delete('/:id', requirePermissions('delete:org'), deleteOrganisationController);

export default router;
