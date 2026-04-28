import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';
import WorkspaceMember from '../models/WorkspaceMember.js';

const isObjectId = (v) => mongoose.isValidObjectId(v);

// Bypass perms recognised by the hybrid model. Both grant unconditional
// access to any workspace within the requester's organisation.
const ORG_BYPASS_PERMS = ['*', 'manage:workspace'];

const orgPerms = (req) => req.user?.role?.permissions || [];

const hasOrgBypass = (req) => {
    const perms = orgPerms(req);
    return ORG_BYPASS_PERMS.some((p) => perms.includes(p));
};

// Resolve the workspace from `:id` (or `:workspaceId`), enforce tenant
// boundary, attach `req.workspace` and `req.workspaceMember`. Archived
// workspaces are blocked from mutations by default; pass
// `{ allowArchived: true }` from routes that need to operate on them
// (e.g. restore).
export const requireWorkspaceContext = ({ allowArchived = false } = {}) =>
    async (req, res, next) => {
        try {
            const orgId = req.user?.organisation;
            if (!orgId) {
                return res
                    .status(400)
                    .json({ success: false, error: 'Organisation context required' });
            }

            const workspaceId = req.params.workspaceId || req.params.id;
            if (!isObjectId(workspaceId)) {
                return res
                    .status(400)
                    .json({ success: false, error: 'Invalid workspace id' });
            }

            const workspace = await Workspace.findOne({
                _id: workspaceId,
                organisation: orgId,
            });

            // We deliberately return 404 (not 403) for cross-tenant
            // workspaces so a caller can't probe the existence of
            // workspaces in other organisations.
            if (!workspace) {
                return res
                    .status(404)
                    .json({ success: false, error: 'Workspace not found' });
            }

            if (!workspace.isActive && !allowArchived) {
                return res.status(400).json({
                    success: false,
                    error: 'Workspace is archived. Restore it before performing this action.',
                });
            }

            req.workspace = workspace;

            // Load the requester's membership (may not exist if they have
            // org bypass perms but aren't a member). `populate('role')` so
            // `requireWorkspacePermissions` can read perms in O(1).
            req.workspaceMember = await WorkspaceMember.findOne({
                workspace: workspace._id,
                user: req.user._id,
            }).populate('role');

            return next();
        } catch (err) {
            return next(err);
        }
    };

// Hybrid permission check:
//   1. Org wildcard '*' or 'manage:workspace' bypasses (no membership needed).
//   2. Otherwise the requester must have an ACTIVE WorkspaceMember whose
//      role grants every required permission.
export const requireWorkspacePermissions = (...requiredPermissions) =>
    (req, res, next) => {
        if (hasOrgBypass(req)) {
            return next();
        }

        const member = req.workspaceMember;
        if (!member || member.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                error: 'You are not an active member of this workspace',
            });
        }

        const memberPerms = member.role?.permissions || [];
        if (memberPerms.includes('*')) {
            return next();
        }

        const ok = requiredPermissions.every((p) => memberPerms.includes(p));
        if (!ok) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions in this workspace',
            });
        }

        return next();
    };
