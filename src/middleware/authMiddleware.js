import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import OrganisationMember from '../models/OrganisationMember.js';

export const authenticate = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');

        const user = await User.findById(decoded.id);
        if (!user || !user.isActive) {
            return res.status(401).json({ success: false, error: 'User is inactive or not found' });
        }

        // Convert to plain object: User schema has no `role`/`organisation`
        // fields, so attaching them to the Mongoose doc is fragile.
        req.user = user.toObject();

        // Resolve org context. Precedence:
        //   1. Explicit `x-org-id` header (multi-tenant FE case)
        //   2. The user's single active membership (single-tenant case)
        // If the user belongs to multiple orgs and sends no header, we leave
        // role unset and let `requirePermissions` reject the request.
        const requestedOrgId = req.headers['x-org-id'];
        const memberQuery = { user: user._id, status: 'ACTIVE' };
        if (requestedOrgId) memberQuery.organisation = requestedOrgId;

        const memberships = await OrganisationMember.find(memberQuery).populate('role');

        let orgMember = null;
        if (requestedOrgId) {
            orgMember = memberships[0] || null;
        } else if (memberships.length === 1) {
            orgMember = memberships[0];
        }

        if (orgMember && orgMember.role) {
            req.user.role = orgMember.role;
            req.user.organisation = orgMember.organisation;
        }

        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
    }
};

// Middleware to check permissions based on user's role
export const requirePermissions = (...requiredPermissions) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ success: false, error: 'User role or organisation context not found' });
        }

        const userPermissions = req.user.role.permissions || [];

        // Check for wildcard permission (SUPER_ADMIN)
        if (userPermissions.includes('*')) {
            return next();
        }

        const hasPermission = requiredPermissions.every((perm) =>
            userPermissions.includes(perm)
        );

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: 'User is not authorized to perform this action',
            });
        }

        next();
    };
};
