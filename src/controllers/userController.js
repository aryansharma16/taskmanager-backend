import { createUser, deleteUser, getUsers, getUserById, updateMemberRole } from '../services/userService.js';

// @desc    Create a new user within the organisation
// @route   POST /api/users
// @access  Private / Admin
export const createUserController = async (req, res, next) => {
    try {
        const adminOrgId = req.user.organisation;
        if (!adminOrgId) {
            return res.status(400).json({ success: false, error: 'Organisation context required' });
        }

        const { name, email, password, roleName } = req.body;

        const result = await createUser(adminOrgId, name, email, password, roleName);

        res.status(201).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

export const getUsersController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        const users = await getUsers(orgId);
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        next(error);
    }
};

export const getUserByIdController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        const user = await getUserById(orgId, req.params.id);
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

export const updateMemberRoleController = async (req, res, next) => {
    try {
        const orgId = req.user.organisation;
        if (!orgId) return res.status(400).json({ success: false, error: 'Organisation context required' });

        const { roleId } = req.body;
        const updatedMember = await updateMemberRole(orgId, req.params.id, roleId);
        res.status(200).json({ success: true, data: updatedMember });
    } catch (error) {
        next(error);
    }
};

// @desc    Remove user from organisation
// @route   DELETE /api/users/:id
// @access  Private / Admin
export const deleteUserController = async (req, res, next) => {
    try {
        const adminOrgId = req.user.organisation;
        if (!adminOrgId) {
            return res.status(400).json({ success: false, error: 'Organisation context required' });
        }

        const targetUserId = req.params.id;

        await deleteUser(adminOrgId, targetUserId);

        res.status(200).json({
            success: true,
            data: {},
            message: 'User successfully removed from organisation',
        });
    } catch (error) {
        next(error);
    }
};
