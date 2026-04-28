import mongoose from 'mongoose';
import Role from '../models/Role.js';
import OrganisationMember from '../models/OrganisationMember.js';

const isObjectId = (v) => mongoose.isValidObjectId(v);

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

export const createRole = async (orgId, name, permissions, description) => {
    if (typeof name !== 'string' || !name.trim()) {
        throw new Error('Role name is required');
    }

    const normalisedName = name.trim().toUpperCase();
    const cleanedPerms = sanitisePermissions(permissions) || [];

    // Ensure role doesn't already exist in this org for the ORGANISATION
    // scope (matches the unique compound index).
    const existing = await Role.findOne({
        name: normalisedName,
        organisation: orgId,
        scope: 'ORGANISATION',
    });
    if (existing) {
        throw new Error('Role with this name already exists in the organisation');
    }

    const role = await Role.create({
        name: normalisedName,
        scope: 'ORGANISATION',
        organisation: orgId,
        permissions: cleanedPerms,
        description: typeof description === 'string' ? description.trim() : '',
        isCustom: true,
    });

    return role;
};

export const getRoles = async (orgId) => {
    // Return roles tied to this org (any scope) plus any global roles
    // (organisation: null) so the FE can show them — but the FE should
    // hide edit/delete for non-custom or non-org roles.
    return Role.find({
        $or: [{ organisation: orgId }, { organisation: null }],
    });
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

// Resolve a role for a mutating action (update/delete). Returns either a
// loaded role or a typed error so callers can surface specific reasons.
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

export const updateRole = async (orgId, roleId, permissions, description) => {
    const { role, error } = await resolveCustomRoleForOrg(orgId, roleId);
    if (error) {
        throw new Error(error);
    }

    if (permissions !== undefined) {
        const cleaned = sanitisePermissions(permissions);
        role.permissions = cleaned || [];
    }
    if (description !== undefined) {
        role.description = typeof description === 'string' ? description.trim() : '';
    }

    await role.save();
    return role;
};

export const deleteRole = async (orgId, roleId) => {
    const { role, error } = await resolveCustomRoleForOrg(orgId, roleId);
    if (error) {
        throw new Error(error);
    }

    // Block deletion when the role is still assigned to one or more
    // members; otherwise we'd leave dangling refs on OrganisationMember.
    const inUse = await OrganisationMember.countDocuments({ role: role._id });
    if (inUse > 0) {
        throw new Error(
            `Cannot delete role: it is still assigned to ${inUse} member(s). Reassign them first.`
        );
    }

    await Role.findByIdAndDelete(role._id);
    return true;
};
