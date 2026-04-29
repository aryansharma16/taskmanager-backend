import * as taskService from '../services/taskService.js';

// All task controllers run after `requireWorkspaceContext`, so
// `req.workspace` is loaded, tenant-checked, and not archived.

// @route POST /api/workspaces/:id/tasks
export const createTaskController = async (req, res, next) => {
    try {
        const result = await taskService.createTask(
            req.workspace,
            req.body || {},
            req.user?._id,
        );
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/tasks
export const listTasksController = async (req, res, next) => {
    try {
        const includeArchived =
            String(req.query.includeArchived || '').toLowerCase() === 'true';
        // Pull the explicit-known query params instead of spreading
        // `req.query` blindly so unsupported fields can't leak into the
        // Mongo filter. Both bare and `Id`-suffixed names are accepted
        // for the foreign-key filters so the FE can pass either style
        // without falling into the silent-drop trap that bites task
        // creation.
        const result = await taskService.listTasks(req.workspace, {
            includeArchived,
            page: req.query.page,
            limit: req.query.limit,
            status: req.query.status ?? req.query.statusId,
            priority: req.query.priority ?? req.query.priorityId,
            assignee: req.query.assignee ?? req.query.assigneeId,
            createdBy: req.query.createdBy ?? req.query.createdById,
            parentTask: req.query.parentTask ?? req.query.parentTaskId,
            search: req.query.search,
            sort: req.query.sort,
            sortDir: req.query.sortDir,
            dueBefore: req.query.dueBefore,
            dueAfter: req.query.dueAfter,
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/tasks/board
export const getBoardController = async (req, res, next) => {
    try {
        const includeArchived =
            String(req.query.includeArchived || '').toLowerCase() === 'true';
        // rootOnly defaults true (subtasks live inside their parent's
        // detail panel, not on the main Kanban). FE can opt out with
        // ?rootOnly=false to render every task on the board.
        const rootOnly =
            String(req.query.rootOnly ?? 'true').toLowerCase() !== 'false';
        const data = await taskService.getBoard(req.workspace, {
            includeArchived,
            rootOnly,
        });
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/tasks/:taskId
export const getTaskByIdController = async (req, res, next) => {
    try {
        const data = await taskService.getTaskById(
            req.workspace,
            req.params.taskId,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/tasks/:taskId/subtasks
export const getSubtasksController = async (req, res, next) => {
    try {
        const includeArchived =
            String(req.query.includeArchived || '').toLowerCase() === 'true';
        const data = await taskService.getSubtasks(
            req.workspace,
            req.params.taskId,
            { includeArchived },
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route PUT /api/workspaces/:id/tasks/:taskId
export const updateTaskController = async (req, res, next) => {
    try {
        const data = await taskService.updateTask(
            req.workspace,
            req.params.taskId,
            req.body || {},
            req.user?._id,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route DELETE /api/workspaces/:id/tasks/:taskId   (soft-delete)
export const archiveTaskController = async (req, res, next) => {
    try {
        const data = await taskService.archiveTask(
            req.workspace,
            req.params.taskId,
            req.user?._id,
        );
        res.status(200).json({
            success: true,
            data,
            message: 'Task archived',
        });
    } catch (error) {
        next(error);
    }
};

// @route PATCH /api/workspaces/:id/tasks/:taskId/restore
export const restoreTaskController = async (req, res, next) => {
    try {
        const data = await taskService.restoreTask(
            req.workspace,
            req.params.taskId,
            req.user?._id,
        );
        res.status(200).json({
            success: true,
            data,
            message: 'Task restored',
        });
    } catch (error) {
        next(error);
    }
};

// @route PATCH /api/workspaces/:id/tasks/:taskId/move
export const moveTaskController = async (req, res, next) => {
    try {
        const data = await taskService.moveTask(
            req.workspace,
            req.params.taskId,
            req.body || {},
            req.user?._id,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/tasks/:taskId/assignments
export const listAssignmentsController = async (req, res, next) => {
    try {
        const data = await taskService.listAssignments(
            req.workspace,
            req.params.taskId,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/workspaces/:id/tasks/:taskId/assignments
export const addAssignmentController = async (req, res, next) => {
    try {
        const userId = req.body?.userId || req.body?.user;
        const role = req.body?.role || 'ASSIGNEE';
        if (!userId) {
            return res
                .status(400)
                .json({ success: false, error: 'userId is required' });
        }
        const data = await taskService.addAssignment(
            req.workspace,
            req.params.taskId,
            { userId, role },
            req.user?._id,
        );
        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route PUT /api/workspaces/:id/tasks/:taskId/assignments/:assignmentId
export const updateAssignmentRoleController = async (req, res, next) => {
    try {
        const role = req.body?.role;
        if (!role) {
            return res
                .status(400)
                .json({ success: false, error: 'role is required' });
        }
        const data = await taskService.updateAssignmentRole(
            req.workspace,
            req.params.taskId,
            req.params.assignmentId,
            role,
            req.user?._id,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route DELETE /api/workspaces/:id/tasks/:taskId/assignments/:assignmentId
export const removeAssignmentController = async (req, res, next) => {
    try {
        await taskService.removeAssignment(
            req.workspace,
            req.params.taskId,
            req.params.assignmentId,
            req.user?._id,
        );
        res.status(200).json({
            success: true,
            data: {},
            message: 'Assignment removed',
        });
    } catch (error) {
        next(error);
    }
};
