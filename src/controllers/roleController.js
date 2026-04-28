import * as roleService from '../services/roleService.js';

const requireOrg = (req, res) => {
    const orgId = req.user?.organisation;
    if (!orgId) {
        res.status(400).json({ success: false, error: 'Organisation context required' });
        return null;
    }
    return orgId;
};

export const createRoleController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const { name, permissions, description } = req.body || {};

        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Role name is required' });
        }
        if (permissions !== undefined && !Array.isArray(permissions)) {
            return res.status(400).json({
                success: false,
                error: 'permissions must be an array of strings',
            });
        }

        const role = await roleService.createRole(
            orgId,
            name,
            permissions,
            description,
            req.user?._id,
        );
        res.status(201).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
};

export const getRolesController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const roles = await roleService.getRoles(orgId);
        res.status(200).json({ success: true, data: roles });
    } catch (error) {
        next(error);
    }
};

export const getRoleByIdController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const role = await roleService.getRoleById(orgId, req.params.id);
        res.status(200).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
};

export const updateRoleController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const { permissions, description } = req.body || {};

        if (permissions !== undefined && !Array.isArray(permissions)) {
            return res.status(400).json({
                success: false,
                error: 'permissions must be an array of strings',
            });
        }

        const role = await roleService.updateRole(
            orgId,
            req.params.id,
            permissions,
            description,
            req.user?._id,
        );
        res.status(200).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
};

export const deleteRoleController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        await roleService.deleteRole(orgId, req.params.id, req.user?._id);
        res.status(200).json({ success: true, data: {}, message: 'Role deleted successfully' });
    } catch (error) {
        next(error);
    }
};
