import * as workspaceService from '../services/workspaceService.js';

const requireOrg = (req, res) => {
    const orgId = req.user?.organisation;
    if (!orgId) {
        res.status(400).json({ success: false, error: 'Organisation context required' });
        return null;
    }
    return orgId;
};

// @route POST /api/workspaces
export const createWorkspaceController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const { name, slug, description, initialMembers } = req.body || {};
        const creatorRoleId =
            req.body?.creatorRoleId || req.body?.creatorRole || req.body?.roleId || req.body?.role;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res
                .status(400)
                .json({ success: false, error: 'name is required' });
        }
        if (!creatorRoleId) {
            return res.status(400).json({
                success: false,
                error: 'creatorRoleId is required (the workspace-scoped role for the creator)',
            });
        }
        if (initialMembers !== undefined && !Array.isArray(initialMembers)) {
            return res
                .status(400)
                .json({ success: false, error: 'initialMembers must be an array' });
        }

        const result = await workspaceService.createWorkspace(
            orgId,
            { name, slug, description, creatorRoleId, initialMembers },
            req.user?._id,
        );

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces
export const getWorkspacesController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const includeArchived = String(req.query.includeArchived || '').toLowerCase() === 'true';
        const result = await workspaceService.getWorkspaces(orgId, req.user, {
            includeArchived,
            page: req.query.page,
            limit: req.query.limit,
        });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id
export const getWorkspaceByIdController = async (req, res, next) => {
    try {
        const result = await workspaceService.getWorkspaceById(req.workspace);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

// @route PUT /api/workspaces/:id
export const updateWorkspaceController = async (req, res, next) => {
    try {
        const { name, slug, description, metadata } = req.body || {};
        const updated = await workspaceService.updateWorkspace(
            req.workspace,
            { name, slug, description, metadata },
            req.user?._id,
        );
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

// @route DELETE /api/workspaces/:id (soft-delete / archive)
export const archiveWorkspaceController = async (req, res, next) => {
    try {
        const archived = await workspaceService.archiveWorkspace(req.workspace, req.user?._id);
        res.status(200).json({
            success: true,
            data: archived,
            message: 'Workspace archived',
        });
    } catch (error) {
        next(error);
    }
};

// @route PATCH /api/workspaces/:id/restore
export const restoreWorkspaceController = async (req, res, next) => {
    try {
        const restored = await workspaceService.restoreWorkspace(req.workspace, req.user?._id);
        res.status(200).json({
            success: true,
            data: restored,
            message: 'Workspace restored',
        });
    } catch (error) {
        next(error);
    }
};

// @route GET /api/workspaces/:id/members
export const listMembersController = async (req, res, next) => {
    try {
        const result = await workspaceService.listMembers(req.workspace._id, {
            status: req.query.status,
            page: req.query.page,
            limit: req.query.limit,
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

// @route POST /api/workspaces/:id/members
export const addMemberController = async (req, res, next) => {
    try {
        const { userId } = req.body || {};
        const roleId = req.body?.roleId || req.body?.role;

        if (!userId || !roleId) {
            return res.status(400).json({
                success: false,
                error: 'userId and roleId are required',
            });
        }

        const member = await workspaceService.addMember(
            req.workspace,
            userId,
            roleId,
            req.user?._id,
        );
        res.status(201).json({ success: true, data: member });
    } catch (error) {
        next(error);
    }
};

// @route PUT /api/workspaces/:id/members/:memberId
export const updateMemberRoleController = async (req, res, next) => {
    try {
        const roleId = req.body?.roleId || req.body?.role;
        if (!roleId) {
            return res.status(400).json({ success: false, error: 'roleId is required' });
        }

        const updated = await workspaceService.updateMemberRole(
            req.workspace,
            req.params.memberId,
            roleId,
            req.user?._id,
        );
        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
};

// @route DELETE /api/workspaces/:id/members/:memberId
export const removeMemberController = async (req, res, next) => {
    try {
        await workspaceService.removeMember(
            req.workspace,
            req.params.memberId,
            req.user?._id,
        );
        res.status(200).json({
            success: true,
            data: {},
            message: 'Member removed from workspace',
        });
    } catch (error) {
        next(error);
    }
};
