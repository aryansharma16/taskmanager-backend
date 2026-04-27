import { createUser, deleteUser } from '../services/userService.js';

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
