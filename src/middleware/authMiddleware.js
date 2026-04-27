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
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123'); // Fallback for dev

        // Find user
        const user = await User.findById(decoded.id);
        if (!user || !user.isActive) {
            return res.status(401).json({ success: false, error: 'User is inactive or not found' });
        }

        req.user = user;

        // Extract organization context from header
        const orgId = req.headers['x-org-id'];
        if (orgId) {
            const orgMember = await OrganisationMember.findOne({
                user: user._id,
                organisation: orgId,
                status: 'ACTIVE'
            }).populate('role');

            if (orgMember && orgMember.role) {
                req.user.role = orgMember.role;
                req.user.organisation = orgId;
            }
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
