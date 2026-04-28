import express from 'express';
import {
    createWorkspaceController,
    getWorkspacesController,
    getWorkspaceByIdController,
    updateWorkspaceController,
    archiveWorkspaceController,
    restoreWorkspaceController,
    listMembersController,
    addMemberController,
    updateMemberRoleController,
    removeMemberController,
} from '../controllers/workspaceController.js';
import { authenticate, requirePermissions } from '../middleware/authMiddleware.js';
import {
    requireWorkspaceContext,
    requireWorkspacePermissions,
} from '../middleware/workspaceMiddleware.js';

const router = express.Router();

router.use(authenticate);

// ---------------------------------------------------------------------------
// Org-level workspace routes (no `:id` yet, so workspace-context middleware
// is not used; org-level RBAC gates the action).
// ---------------------------------------------------------------------------

router.post('/', requirePermissions('create:workspace'), createWorkspaceController);
router.get('/', requirePermissions('read:workspace'), getWorkspacesController);

// ---------------------------------------------------------------------------
// Workspace-scoped routes. requireWorkspaceContext loads `req.workspace` and
// `req.workspaceMember`; requireWorkspacePermissions enforces the hybrid
// model (org bypass perms or workspace-role perms).
// ---------------------------------------------------------------------------

router.get(
    '/:id',
    requireWorkspaceContext(),
    requireWorkspacePermissions('read:workspace'),
    getWorkspaceByIdController,
);

router.put(
    '/:id',
    requireWorkspaceContext(),
    requireWorkspacePermissions('update:workspace'),
    updateWorkspaceController,
);

router.delete(
    '/:id',
    requireWorkspaceContext(),
    requireWorkspacePermissions('delete:workspace'),
    archiveWorkspaceController,
);

// Restore needs to operate on archived workspaces, so we explicitly allow
// archived in the context middleware.
router.patch(
    '/:id/restore',
    requireWorkspaceContext({ allowArchived: true }),
    requireWorkspacePermissions('update:workspace'),
    restoreWorkspaceController,
);

// ---------------------------------------------------------------------------
// Workspace member subroutes
// ---------------------------------------------------------------------------

router.get(
    '/:id/members',
    requireWorkspaceContext(),
    requireWorkspacePermissions('read:workspace'),
    listMembersController,
);

router.post(
    '/:id/members',
    requireWorkspaceContext(),
    requireWorkspacePermissions('manage:workspace_members'),
    addMemberController,
);

router.put(
    '/:id/members/:memberId',
    requireWorkspaceContext(),
    requireWorkspacePermissions('manage:workspace_members'),
    updateMemberRoleController,
);

router.delete(
    '/:id/members/:memberId',
    requireWorkspaceContext(),
    requireWorkspacePermissions('manage:workspace_members'),
    removeMemberController,
);

export default router;
