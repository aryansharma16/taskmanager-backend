import {
    createUser,
    deleteUser,
    getUsers,
    getUserById,
    updateMemberRole,
} from '../services/userService.js';

const requireOrg = (req, res) => {
    const orgId = req.user?.organisation;
    if (!orgId) {
        res.status(400).json({ success: false, error: 'Organisation context required' });
        return null;
    }
    return orgId;
};

// @desc    Create a new user within the organisation (or attach an existing
//          user by email to this organisation)
// @route   POST /api/users
// @access  Private / Admin
export const createUserController = async (req, res, next) => {
    try {
        const adminOrgId = requireOrg(req, res);
        if (!adminOrgId) return;

        const { name, email, password } = req.body || {};
        const roleId = req.body?.roleId || req.body?.role;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'name, email and password are required',
            });
        }
        if (!roleId) {
            return res.status(400).json({
                success: false,
                error: 'roleId is required. Create a role first, then assign it when creating a user.',
            });
        }

        const result = await createUser(
            adminOrgId,
            name,
            email,
            password,
            roleId,
            req.user?._id,
        );

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

// @desc    List all (non-suspended) members of the organisation
// @route   GET /api/users
// @access  Private
export const getUsersController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const users = await getUsers(orgId);
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        next(error);
    }
};

// @desc    Fetch a single member by membership id or user id
// @route   GET /api/users/:id
// @access  Private
export const getUserByIdController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const user = await getUserById(orgId, req.params.id);
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

// @desc    Change a member's role
// @route   PUT /api/users/:id/role
// @access  Private / Admin
export const updateMemberRoleController = async (req, res, next) => {
    try {
        const orgId = requireOrg(req, res);
        if (!orgId) return;

        const roleId = req.body?.roleId || req.body?.role;
        if (!roleId) {
            return res.status(400).json({
                success: false,
                error: 'roleId is required',
            });
        }

        const updatedMember = await updateMemberRole(
            orgId,
            req.params.id,
            roleId,
            req.user?._id,
        );
        res.status(200).json({ success: true, data: updatedMember });
    } catch (error) {
        next(error);
    }
};

// @desc    Remove user from organisation (hard-deletes the membership only)
// @route   DELETE /api/users/:id
// @access  Private / Admin
export const deleteUserController = async (req, res, next) => {
    try {
        const adminOrgId = requireOrg(req, res);
        if (!adminOrgId) return;

        await deleteUser(adminOrgId, req.params.id, req.user?._id);

        res.status(200).json({
            success: true,
            data: {},
            message: 'User successfully removed from organisation',
        });
    } catch (error) {
        next(error);
    }
};
