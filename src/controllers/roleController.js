import * as roleService from '../services/roleService.js';

export const createRoleController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        const { name, permissions, description } = req.body;
        const role = await roleService.createRole(orgId, name, permissions, description);

        res.status(201).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
};

export const getRolesController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        const roles = await roleService.getRoles(orgId);
        res.status(200).json({ success: true, data: roles });
    } catch (error) {
        next(error);
    }
};

export const getRoleByIdController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        const role = await roleService.getRoleById(orgId, req.params.id);
        res.status(200).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
};

export const updateRoleController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        const { permissions, description } = req.body;
        const role = await roleService.updateRole(orgId, req.params.id, permissions, description);
        res.status(200).json({ success: true, data: role });
    } catch (error) {
        next(error);
    }
};

export const deleteRoleController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        await roleService.deleteRole(orgId, req.params.id);
        res.status(200).json({ success: true, data: {}, message: 'Role deleted successfully' });
    } catch (error) {
        next(error);
    }
};
