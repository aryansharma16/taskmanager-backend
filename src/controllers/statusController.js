import * as statusService from '../services/statusService.js';

// All status controllers run after `requireWorkspaceContext`, so
// `req.workspace` is loaded, tenant-checked, and not archived.

// @route POST /api/workspaces/:id/statuses
export const createStatusController = async (req, res, next) => {
    try {
        const data = await statusService.createStatus(
            req.workspace,
            req.body || {},
            req.user?._id,
        );
        res.status(201).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/statuses
export const listStatusesController = async (req, res, next) => {
    try {
        const withTaskCounts =
            String(req.query.withTaskCounts || '').toLowerCase() === 'true';
        const data = await statusService.listStatuses(req.workspace, {
            withTaskCounts,
        });
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/statuses/:statusId
export const getStatusByIdController = async (req, res, next) => {
    try {
        const data = await statusService.getStatusById(
            req.workspace,
            req.params.statusId,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route PUT /api/workspaces/:id/statuses/:statusId
export const updateStatusController = async (req, res, next) => {
    try {
        const data = await statusService.updateStatus(
            req.workspace,
            req.params.statusId,
            req.body || {},
            req.user?._id,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route PUT /api/workspaces/:id/statuses/reorder
// Body: `{ orderedIds: [statusId, statusId, ...] }`. Position in the
// array becomes the new pipeline order. Returns the freshly-sorted
// list so the client can render without an extra round trip.
export const reorderStatusesController = async (req, res, next) => {
    try {
        const orderedIds = req.body?.orderedIds;
        const data = await statusService.reorderStatuses(
            req.workspace,
            orderedIds,
            req.user?._id,
        );
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

// @route DELETE /api/workspaces/:id/statuses/:statusId
// `reassignTo` is accepted in either the JSON body or as a query string
// for clients that prefer plain `axios.delete(url)`.
export const deleteStatusController = async (req, res, next) => {
    try {
        const reassignTo =
            req.body?.reassignTo !== undefined
                ? req.body.reassignTo
                : req.query?.reassignTo;
        const data = await statusService.deleteStatus(
            req.workspace,
            req.params.statusId,
            { reassignTo },
            req.user?._id,
        );
        res.status(200).json({
            success: true,
            data,
            message: 'Status deleted',
        });
    } catch (error) {
        next(error);
    }
};
