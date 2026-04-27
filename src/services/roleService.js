import Role from '../models/Role.js';

export const createRole = async (orgId, name, permissions, description) => {
    // Ensure role doesn't already exist in this org
    const existingRole = await Role.findOne({ name: name.toUpperCase(), organisation: orgId });
    if (existingRole) {
        throw new Error('Role with this name already exists in the organisation');
    }

    const role = await Role.create({
        name: name.toUpperCase(),
        scope: 'ORGANISATION',
        organisation: orgId,
        permissions: permissions || [],
        description: description || '',
        isCustom: true,
    });

    return role;
};

export const getRoles = async (orgId) => {
    // Return roles tied to this org (any scope: ORGANISATION, SYSTEM, etc.)
    // plus any truly global roles (no org). Scope is metadata, not a tenant
    // boundary — filtering by it here hid system roles like SUPER_ADMIN.
    const roles = await Role.find({
        $or: [{ organisation: orgId }, { organisation: null }],
    });
    return roles;
};

export const getRoleById = async (orgId, roleId) => {
    const role = await Role.findOne({
        _id: roleId,
        $or: [{ organisation: orgId }, { organisation: null }]
    });

    if (!role) {
        throw new Error('Role not found');
    }

    return role;
};

export const updateRole = async (orgId, roleId, permissions, description) => {
    const role = await Role.findOne({ _id: roleId, organisation: orgId });

    if (!role) {
        throw new Error('Role not found or you cannot edit global roles');
    }

    if (!role.isCustom) {
        throw new Error('Cannot edit system default roles');
    }

    if (permissions) role.permissions = permissions;
    if (description !== undefined) role.description = description;

    await role.save();
    return role;
};

export const deleteRole = async (orgId, roleId) => {
    const role = await Role.findOne({ _id: roleId, organisation: orgId });

    if (!role) {
        throw new Error('Role not found or you cannot delete global roles');
    }

    if (!role.isCustom) {
        throw new Error('Cannot delete system default roles');
    }

    // Should also check if users are currently assigned to this role, but for now just delete
    await Role.findByIdAndDelete(roleId);
    return true;
};
