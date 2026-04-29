import express from 'express';
import {
    createTaskController,
    listTasksController,
    getBoardController,
    getTaskByIdController,
    getSubtasksController,
    updateTaskController,
    archiveTaskController,
    restoreTaskController,
    moveTaskController,
    listAssignmentsController,
    addAssignmentController,
    updateAssignmentRoleController,
    removeAssignmentController,
} from '../controllers/taskController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
    requireWorkspaceContext,
    requireWorkspacePermissions,
} from '../middleware/workspaceMiddleware.js';

// `mergeParams: true` is what lets us read `:id` (the workspaceId)
// when this router is mounted under `/api/workspaces/:id/tasks`.
// Without it, Express would scope params to this router only.
const router = express.Router({ mergeParams: true });

// Auth + workspace context apply to every task route. The middleware
// tenant-checks the workspace and rejects archived workspaces, so the
// controllers can trust `req.workspace` from this point on.
router.use(authenticate);
router.use(requireWorkspaceContext());

// ---------------------------------------------------------------------------
// Task list / board / create
// ---------------------------------------------------------------------------

router.get(
    '/',
    requireWorkspacePermissions('read:task'),
    listTasksController,
);
router.post(
    '/',
    requireWorkspacePermissions('create:task'),
    createTaskController,
);
router.get(
    '/board',
    requireWorkspacePermissions('read:task'),
    getBoardController,
);

// ---------------------------------------------------------------------------
// Single task
// ---------------------------------------------------------------------------

router.get(
    '/:taskId',
    requireWorkspacePermissions('read:task'),
    getTaskByIdController,
);
router.put(
    '/:taskId',
    requireWorkspacePermissions('update:task'),
    updateTaskController,
);
router.delete(
    '/:taskId',
    requireWorkspacePermissions('delete:task'),
    archiveTaskController,
);
router.patch(
    '/:taskId/restore',
    requireWorkspacePermissions('update:task'),
    restoreTaskController,
);
// Drag-and-drop. `update:task` is required (rather than a separate
// `move:task` perm) because a move is just a constrained update on
// status + order.
router.patch(
    '/:taskId/move',
    requireWorkspacePermissions('update:task'),
    moveTaskController,
);
router.get(
    '/:taskId/subtasks',
    requireWorkspacePermissions('read:task'),
    getSubtasksController,
);

// ---------------------------------------------------------------------------
// Task assignment subroutes
// ---------------------------------------------------------------------------

router.get(
    '/:taskId/assignments',
    requireWorkspacePermissions('read:task'),
    listAssignmentsController,
);
router.post(
    '/:taskId/assignments',
    requireWorkspacePermissions('assign:task'),
    addAssignmentController,
);
router.put(
    '/:taskId/assignments/:assignmentId',
    requireWorkspacePermissions('assign:task'),
    updateAssignmentRoleController,
);
router.delete(
    '/:taskId/assignments/:assignmentId',
    requireWorkspacePermissions('assign:task'),
    removeAssignmentController,
);

export default router;
