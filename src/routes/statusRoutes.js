import express from 'express';
import {
    createStatusController,
    listStatusesController,
    getStatusByIdController,
    updateStatusController,
    deleteStatusController,
} from '../controllers/statusController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
    requireWorkspaceContext,
    requireWorkspacePermissions,
} from '../middleware/workspaceMiddleware.js';

// `mergeParams: true` so this router can read the parent `:id` (the
// workspaceId) when mounted at `/api/workspaces/:id/statuses`.
const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(requireWorkspaceContext());

// Reading statuses piggy-backs on `read:task` — anyone who can see the
// board already needs to see its columns. Mutations require a dedicated
// `manage:status` perm, since configuring the workflow is an admin-y
// operation distinct from working on tasks.
router.get(
    '/',
    requireWorkspacePermissions('read:task'),
    listStatusesController,
);
router.post(
    '/',
    requireWorkspacePermissions('manage:status'),
    createStatusController,
);

router.get(
    '/:statusId',
    requireWorkspacePermissions('read:task'),
    getStatusByIdController,
);
router.put(
    '/:statusId',
    requireWorkspacePermissions('manage:status'),
    updateStatusController,
);
router.delete(
    '/:statusId',
    requireWorkspacePermissions('manage:status'),
    deleteStatusController,
);

export default router;
