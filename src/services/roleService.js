import mongoose from 'mongoose';
import Role from '../models/Role.js';
import OrganisationMember from '../models/OrganisationMember.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import { logActivity } from './activityLogService.js';

const isObjectId = (v) => mongoose.isValidObjectId(v);

// Scopes a role can be created with via the public API. SYSTEM is reserved
// for global default roles seeded internally (e.g. SUPER_ADMIN).
const ALLOWED_CREATE_SCOPES = ['ORGANISATION', 'WORKSPACE'];

const sanitisePermissions = (permissions) => {
    if (permissions === undefined) return undefined;
    if (!Array.isArray(permissions)) {
        throw new Error('permissions must be an array of strings');
    }
    const cleaned = permissions
        .filter((p) => typeof p === 'string')
        .map((p) => p.trim())
        .filter(Boolean);
    return Array.from(new Set(cleaned));
};

export const createRole = async (
    orgId,
    name,
    permissions,
    description,
    actorId,
    scope = 'ORGANISATION',
) => {
    if (typeof name !== 'string' || !name.trim()) {
        throw new Error('Role name is required');
    }
    const normalisedScope = String(scope || 'ORGANISATION').toUpperCase();
    if (!ALLOWED_CREATE_SCOPES.includes(normalisedScope)) {
        throw new Error(`Invalid scope. Allowed: ${ALLOWED_CREATE_SCOPES.join(', ')}`);
    }

    const normalisedName = name.trim().toUpperCase();
    const cleanedPerms = sanitisePermissions(permissions) || [];

    const existing = await Role.findOne({
        name: normalisedName,
        organisation: orgId,
        scope: normalisedScope,
    });
    if (existing) {
        throw new Error('Role with this name already exists in the organisation for this scope');
    }

    const role = await Role.create({
        name: normalisedName,
        scope: normalisedScope,
        organisation: orgId,
        permissions: cleanedPerms,
        description: typeof description === 'string' ? description.trim() : '',
        isCustom: true,
    });

    await logActivity({
        entityType: 'Role',
        entityId: role._id,
        organisation: orgId,
        action: 'created',
        performedBy: actorId,
        metadata: {
            name: role.name,
            scope: role.scope,
            permissions: role.permissions,
            description: role.description,
        },
    });

    return role;
};

// `filters.scope` optionally narrows by 'ORGANISATION' or 'WORKSPACE'. The
// FE uses this to populate workspace-role pickers without showing org roles.
export const getRoles = async (orgId, filters = {}) => {
    const query = {
        $or: [{ organisation: orgId }, { organisation: null }],
    };
    if (filters.scope) {
        query.scope = String(filters.scope).toUpperCase();
    }
    return Role.find(query);
};

export const getRoleById = async (orgId, roleId) => {
    if (!isObjectId(roleId)) {
        throw new Error('Invalid roleId');
    }

    const role = await Role.findOne({
        _id: roleId,
        $or: [{ organisation: orgId }, { organisation: null }],
    });

    if (!role) {
        throw new Error('Role not found');
    }

    return role;
};

const resolveCustomRoleForOrg = async (orgId, roleId) => {
    if (!isObjectId(roleId)) {
        return { error: 'Invalid roleId' };
    }
    const role = await Role.findById(roleId);
    if (!role) {
        return { error: 'Role not found' };
    }
    if (role.organisation == null) {
        return { error: 'Cannot modify system/global roles' };
    }
    if (role.organisation.toString() !== orgId.toString()) {
        return { error: 'Role does not belong to your organisation' };
    }
    if (!role.isCustom) {
        return { error: 'Cannot modify system default roles' };
    }
    return { role };
};

// `patch` may include any subset of: name, scope, permissions, description.
// `actorId` is recorded on the activity log. The legacy positional form
// `updateRole(orgId, roleId, permissions, description, actorId)` is still
// accepted for backwards compatibility.
export const updateRole = async (orgId, roleId, patch = {}, description, actorId) => {
    // ---- Backwards-compat shim --------------------------------------------
    // Old call site: updateRole(orgId, roleId, permissions, description, actorId)
    // New call site: updateRole(orgId, roleId, patch, actorId)
    let normalisedPatch;
    let normalisedActorId;
    if (Array.isArray(patch) || patch === undefined || patch === null) {
        normalisedPatch = { permissions: patch, description };
        normalisedActorId = actorId;
    } else if (typeof patch === 'object' && (description !== undefined || actorId !== undefined)) {
        // If the caller passed an object AND extra positional args, treat
        // those positional args as the legacy call layout.
        normalisedPatch = patch;
        normalisedActorId = actorId !== undefined ? actorId : description;
    } else {
        normalisedPatch = patch;
        normalisedActorId = description;
    }

    const { role, error } = await resolveCustomRoleForOrg(orgId, roleId);
    if (error) {
        throw new Error(error);
    }

    const before = {
        name: role.name,
        scope: role.scope,
        permissions: [...role.permissions],
        description: role.description,
    };

    // Resolve the would-be next state of (name, scope) so we can run a
    // single uniqueness check before saving.
    let nextName = role.name;
    let nextScope = role.scope;

    if (normalisedPatch.name !== undefined) {
        if (typeof normalisedPatch.name !== 'string' || !normalisedPatch.name.trim()) {
            throw new Error('name must be a non-empty string');
        }
        nextName = normalisedPatch.name.trim().toUpperCase();
    }

    if (normalisedPatch.scope !== undefined) {
        const requestedScope = String(normalisedPatch.scope).toUpperCase();
        if (!ALLOWED_CREATE_SCOPES.includes(requestedScope)) {
            throw new Error(`Invalid scope. Allowed: ${ALLOWED_CREATE_SCOPES.join(', ')}`);
        }
        nextScope = requestedScope;
    }

    // If (name, scope) changes, ensure the new combination doesn't collide
    // with another role in the same org.
    if (nextName !== role.name || nextScope !== role.scope) {
        const collision = await Role.findOne({
            _id: { $ne: role._id },
            name: nextName,
            organisation: orgId,
            scope: nextScope,
        });
        if (collision) {
            throw new Error(
                'Another role with this name already exists in the organisation for this scope',
            );
        }
    }

    // If scope is changing, the role must not be referenced from the
    // member type that won't fit the new scope, otherwise we'd silently
    // break RBAC for those members.
    if (nextScope !== role.scope) {
        if (nextScope === 'WORKSPACE') {
            const orgInUse = await OrganisationMember.countDocuments({ role: role._id });
            if (orgInUse > 0) {
                throw new Error(
                    `Cannot change scope to WORKSPACE: this role is still assigned to ${orgInUse} organisation member(s). Reassign them first.`,
                );
            }
        } else if (nextScope === 'ORGANISATION') {
            const wsInUse = await WorkspaceMember.countDocuments({ role: role._id });
            if (wsInUse > 0) {
                throw new Error(
                    `Cannot change scope to ORGANISATION: this role is still assigned to ${wsInUse} workspace member(s). Reassign them first.`,
                );
            }
        }
    }

    role.name = nextName;
    role.scope = nextScope;

    if (normalisedPatch.permissions !== undefined) {
        const cleaned = sanitisePermissions(normalisedPatch.permissions);
        role.permissions = cleaned || [];
    }
    if (normalisedPatch.description !== undefined) {
        role.description =
            typeof normalisedPatch.description === 'string'
                ? normalisedPatch.description.trim()
                : '';
    }

    await role.save();

    await logActivity({
        entityType: 'Role',
        entityId: role._id,
        organisation: orgId,
        action: 'updated',
        performedBy: normalisedActorId,
        metadata: {
            before,
            after: {
                name: role.name,
                scope: role.scope,
                permissions: role.permissions,
                description: role.description,
            },
        },
    });

    return role;
};

export const deleteRole = async (orgId, roleId, actorId) => {
    const { role, error } = await resolveCustomRoleForOrg(orgId, roleId);
    if (error) {
        throw new Error(error);
    }

    // A role can be referenced from either OrganisationMember or
    // WorkspaceMember; we have to check both before deletion otherwise
    // we'd leave dangling references.
    const [orgInUse, wsInUse] = await Promise.all([
        OrganisationMember.countDocuments({ role: role._id }),
        WorkspaceMember.countDocuments({ role: role._id }),
    ]);
    const inUse = orgInUse + wsInUse;
    if (inUse > 0) {
        throw new Error(
            `Cannot delete role: it is still assigned to ${inUse} member(s) (org: ${orgInUse}, workspace: ${wsInUse}). Reassign them first.`
        );
    }

    const snapshot = {
        name: role.name,
        permissions: [...role.permissions],
        description: role.description,
    };

    await Role.findByIdAndDelete(role._id);

    await logActivity({
        entityType: 'Role',
        entityId: role._id,
        organisation: orgId,
        action: 'deleted',
        performedBy: actorId,
        metadata: snapshot,
    });

    return true;
};
