import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import OrganisationMember from '../models/OrganisationMember.js';
import Role from '../models/Role.js';
import { logActivity } from './activityLogService.js';

const isObjectId = (v) => mongoose.isValidObjectId(v);

const ORG_BYPASS_PERMS = ['*', 'manage:workspace'];

const slugify = (input) =>
    String(input)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

// A role assignable on a WorkspaceMember must have scope: 'WORKSPACE'.
// We accept both org-scoped workspace roles and global workspace roles
// (organisation: null). Returns the role doc or null.
const findWorkspaceScopedRole = async (orgId, roleId) => {
    if (!isObjectId(roleId)) return null;
    return Role.findOne({
        _id: roleId,
        scope: 'WORKSPACE',
        $or: [{ organisation: orgId }, { organisation: null }],
    });
};

// Confirm a target user is an ACTIVE member of the org. Workspace
// membership must always be a strict subset of org membership.
const requireOrgMember = async (orgId, userId) => {
    if (!isObjectId(userId)) {
        throw new Error(`Invalid userId: ${userId}`);
    }
    const member = await OrganisationMember.findOne({
        organisation: orgId,
        user: userId,
        status: 'ACTIVE',
    });
    if (!member) {
        throw new Error(`User ${userId} is not an active member of this organisation`);
    }
    return member;
};

// Resolves a `:memberId` route param to a WorkspaceMember row in the given
// workspace. Accepts either WorkspaceMember._id (what listMembers returns
// to the FE) or the underlying User._id, mirroring the org-member API.
const resolveWorkspaceMember = async (workspaceId, idOrUserId) => {
    if (!isObjectId(idOrUserId)) return null;
    return WorkspaceMember.findOne({
        workspace: workspaceId,
        $or: [{ _id: idOrUserId }, { user: idOrUserId }],
    });
};

const hasOrgBypass = (user) => {
    const perms = user?.role?.permissions || [];
    return ORG_BYPASS_PERMS.some((p) => perms.includes(p));
};

// ---------------------------------------------------------------------------
// Workspace CRUD
// ---------------------------------------------------------------------------

export const createWorkspace = async (
    orgId,
    { name, slug, description, creatorRoleId, initialMembers },
    actorId,
) => {
    if (typeof name !== 'string' || !name.trim()) {
        throw new Error('Workspace name is required');
    }
    if (!creatorRoleId) {
        throw new Error('creatorRoleId is required');
    }

    const creatorRole = await findWorkspaceScopedRole(orgId, creatorRoleId);
    if (!creatorRole) {
        throw new Error(
            'creatorRoleId is invalid or not a WORKSPACE-scoped role for this organisation',
        );
    }

    // Pre-flight validate every initial member before any DB writes so we
    // never end up with a workspace + partial members on validation error.
    const initials = Array.isArray(initialMembers) ? initialMembers : [];
    const resolvedInitials = [];
    for (const entry of initials) {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Each initialMembers entry must be an object { userId, roleId }');
        }
        const { userId } = entry;
        const roleId = entry.roleId || entry.role;
        if (!userId || !roleId) {
            throw new Error('Each initialMembers entry must include userId and roleId');
        }
        if (String(userId) === String(actorId)) {
            // Skip silently — creator already gets a membership via creatorRoleId.
            continue;
        }
        await requireOrgMember(orgId, userId);
        const role = await findWorkspaceScopedRole(orgId, roleId);
        if (!role) {
            throw new Error(
                `Initial member ${userId} has invalid roleId or it is not WORKSPACE-scoped`,
            );
        }
        resolvedInitials.push({ userId, roleId: role._id });
    }

    const finalSlug = slugify(slug || name);
    if (!finalSlug) {
        throw new Error('Could not derive a valid slug from the workspace name');
    }

    const workspace = await Workspace.create({
        name: name.trim(),
        slug: finalSlug,
        description: typeof description === 'string' ? description.trim() : '',
        organisation: orgId,
        createdBy: actorId,
    });

    // Always add the creator first; if that fails, roll back the workspace
    // so we never leave a workspace without an owner.
    try {
        await WorkspaceMember.create({
            workspace: workspace._id,
            user: actorId,
            role: creatorRole._id,
            addedBy: actorId,
        });
    } catch (err) {
        await Workspace.deleteOne({ _id: workspace._id }).catch(() => {});
        throw err;
    }

    // Best-effort add of remaining members. If any fails (e.g. unique
    // index race), record it but don't tear down the whole workspace.
    const memberFailures = [];
    for (const { userId, roleId } of resolvedInitials) {
        try {
            await WorkspaceMember.create({
                workspace: workspace._id,
                user: userId,
                role: roleId,
                addedBy: actorId,
            });
        } catch (err) {
            memberFailures.push({ userId: String(userId), error: err.message });
        }
    }

    await logActivity({
        entityType: 'Workspace',
        entityId: workspace._id,
        organisation: orgId,
        workspace: workspace._id,
        action: 'created',
        performedBy: actorId,
        metadata: {
            name: workspace.name,
            slug: workspace.slug,
            creatorRoleId: creatorRole._id,
            initialMemberCount: resolvedInitials.length,
            memberFailures,
        },
    });

    return { workspace, memberFailures };
};

export const getWorkspaces = async (
    orgId,
    requestingUser,
    { includeArchived = false, page = 1, limit = 20 } = {},
) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const filter = { organisation: orgId };
    if (!includeArchived) {
        filter.isActive = true;
    }

    const bypass = hasOrgBypass(requestingUser);

    let workspaceIdScope = null;
    if (!bypass) {
        // Non-bypass users only see workspaces they're an ACTIVE member of.
        const memberships = await WorkspaceMember.find({
            user: requestingUser._id,
            status: 'ACTIVE',
        }).select('workspace');
        workspaceIdScope = memberships.map((m) => m.workspace);
        if (workspaceIdScope.length === 0) {
            return { items: [], page: safePage, limit: safeLimit, total: 0 };
        }
        filter._id = { $in: workspaceIdScope };
    }

    const [items, total] = await Promise.all([
        Workspace.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .populate('createdBy', 'name email'),
        Workspace.countDocuments(filter),
    ]);

    return { items, page: safePage, limit: safeLimit, total };
};

export const getWorkspaceById = async (workspace) => {
    // The middleware already loaded and tenant-checked the workspace.
    // We enrich here with quick membership/task counts useful to the FE.
    const memberCount = await WorkspaceMember.countDocuments({
        workspace: workspace._id,
        status: 'ACTIVE',
    });

    return { workspace, memberCount };
};

export const updateWorkspace = async (workspace, patch, actorId) => {
    const before = {
        name: workspace.name,
        slug: workspace.slug,
        description: workspace.description,
    };

    if (patch.name !== undefined) {
        if (typeof patch.name !== 'string' || !patch.name.trim()) {
            throw new Error('name must be a non-empty string');
        }
        workspace.name = patch.name.trim();
    }
    if (patch.slug !== undefined) {
        const next = slugify(patch.slug);
        if (!next) {
            throw new Error('Invalid slug');
        }
        workspace.slug = next;
    }
    if (patch.description !== undefined) {
        workspace.description =
            typeof patch.description === 'string' ? patch.description.trim() : '';
    }
    if (patch.metadata !== undefined) {
        if (patch.metadata === null) {
            workspace.metadata = undefined;
        } else if (typeof patch.metadata === 'object') {
            workspace.metadata = patch.metadata;
        } else {
            throw new Error('metadata must be an object');
        }
    }

    await workspace.save();

    await logActivity({
        entityType: 'Workspace',
        entityId: workspace._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'updated',
        performedBy: actorId,
        metadata: {
            before,
            after: {
                name: workspace.name,
                slug: workspace.slug,
                description: workspace.description,
            },
        },
    });

    return workspace;
};

export const archiveWorkspace = async (workspace, actorId) => {
    if (!workspace.isActive) {
        throw new Error('Workspace is already archived');
    }
    workspace.isActive = false;
    workspace.archivedAt = new Date();
    await workspace.save();

    await logActivity({
        entityType: 'Workspace',
        entityId: workspace._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'archived',
        performedBy: actorId,
    });

    return workspace;
};

export const restoreWorkspace = async (workspace, actorId) => {
    if (workspace.isActive) {
        throw new Error('Workspace is not archived');
    }
    workspace.isActive = true;
    workspace.archivedAt = null;
    await workspace.save();

    await logActivity({
        entityType: 'Workspace',
        entityId: workspace._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'restored',
        performedBy: actorId,
    });

    return workspace;
};

// ---------------------------------------------------------------------------
// WorkspaceMember CRUD
// ---------------------------------------------------------------------------

export const listMembers = async (
    workspaceId,
    { status, page = 1, limit = 50 } = {},
) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const filter = { workspace: workspaceId };
    if (status) filter.status = String(status).toUpperCase();

    const [items, total] = await Promise.all([
        WorkspaceMember.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(safeLimit)
            .populate('user', 'name email profilePic')
            .populate('role', 'name permissions scope isCustom'),
        WorkspaceMember.countDocuments(filter),
    ]);

    return { items, page: safePage, limit: safeLimit, total };
};

export const addMember = async (workspace, userId, roleId, actorId) => {
    if (!userId) throw new Error('userId is required');
    if (!roleId) throw new Error('roleId is required');

    await requireOrgMember(workspace.organisation, userId);

    const role = await findWorkspaceScopedRole(workspace.organisation, roleId);
    if (!role) {
        throw new Error('roleId is invalid or not a WORKSPACE-scoped role for this organisation');
    }

    const existing = await WorkspaceMember.findOne({
        workspace: workspace._id,
        user: userId,
    });
    if (existing) {
        throw new Error('User is already a member of this workspace');
    }

    const member = await WorkspaceMember.create({
        workspace: workspace._id,
        user: userId,
        role: role._id,
        addedBy: actorId,
    });

    await logActivity({
        entityType: 'WorkspaceMember',
        entityId: member._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'created',
        performedBy: actorId,
        metadata: {
            targetUserId: userId,
            roleId: role._id,
            roleName: role.name,
        },
    });

    return member;
};

export const updateMemberRole = async (workspace, memberIdOrUserId, newRoleId, actorId) => {
    if (!newRoleId) throw new Error('roleId is required');

    const member = await resolveWorkspaceMember(workspace._id, memberIdOrUserId);
    if (!member) {
        throw new Error('Workspace member not found');
    }

    const newRole = await findWorkspaceScopedRole(workspace.organisation, newRoleId);
    if (!newRole) {
        throw new Error('roleId is invalid or not a WORKSPACE-scoped role for this organisation');
    }

    const previousRoleId = member.role;
    member.role = newRole._id;
    await member.save();

    await logActivity({
        entityType: 'WorkspaceMember',
        entityId: member._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'role_changed',
        performedBy: actorId,
        metadata: {
            targetUserId: member.user,
            oldRoleId: previousRoleId,
            newRoleId: newRole._id,
            newRoleName: newRole.name,
        },
    });

    return member;
};

export const removeMember = async (workspace, memberIdOrUserId, actorId) => {
    const member = await resolveWorkspaceMember(workspace._id, memberIdOrUserId);
    if (!member) {
        throw new Error('Workspace member not found');
    }

    await WorkspaceMember.deleteOne({ _id: member._id });

    await logActivity({
        entityType: 'WorkspaceMember',
        entityId: member._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'deleted',
        performedBy: actorId,
        metadata: {
            targetUserId: member.user,
            roleId: member.role,
        },
    });

    return true;
};
