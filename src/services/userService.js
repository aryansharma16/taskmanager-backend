import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Role from '../models/Role.js';
import OrganisationMember from '../models/OrganisationMember.js';

const isObjectId = (v) => mongoose.isValidObjectId(v);

// Build a query that resolves ":id" in /api/users/:id to either the
// OrganisationMember._id (what `getUsers` returns to the client) or the
// underlying User._id, scoped to the caller's organisation.
const buildMemberQuery = (orgId, id) => {
    if (!isObjectId(id)) return null;
    return {
        organisation: orgId,
        $or: [{ _id: id }, { user: id }],
    };
};

const findRoleForOrg = async (orgId, roleId) => {
    if (!isObjectId(roleId)) return null;
    return Role.findOne({
        _id: roleId,
        $or: [{ organisation: orgId }, { organisation: null }],
    });
};

export const createUser = async (adminOrgId, name, email, password, roleId) => {
    if (!name || !email || !password) {
        throw new Error('name, email and password are required');
    }
    if (!roleId) {
        throw new Error('roleId is required. Create a role first, then assign it.');
    }
    if (!isObjectId(roleId)) {
        throw new Error('Invalid roleId');
    }

    const role = await findRoleForOrg(adminOrgId, roleId);
    if (!role) {
        throw new Error('Role not found or invalid for this organisation');
    }

    // Email is normalised by the schema, but normalise here too so the
    // existing-user lookup is consistent regardless of casing/whitespace.
    const normalisedEmail = String(email).trim().toLowerCase();

    let user = await User.findOne({ email: normalisedEmail });
    let createdNewUser = false;

    if (user) {
        const existingMember = await OrganisationMember.findOne({
            user: user._id,
            organisation: adminOrgId,
        });
        if (existingMember) {
            throw new Error('User is already a member of this organisation');
        }
    } else {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = await User.create({
            name,
            email: normalisedEmail,
            password: hashedPassword,
        });
        createdNewUser = true;
    }

    // If membership creation fails (e.g. unique-index race or validation),
    // roll back the User we just created to avoid orphaning it.
    let orgMember;
    try {
        orgMember = await OrganisationMember.create({
            user: user._id,
            organisation: adminOrgId,
            role: role._id,
        });
    } catch (err) {
        if (createdNewUser) {
            await User.deleteOne({ _id: user._id }).catch(() => {});
        }
        throw err;
    }

    const createdUser = user.toObject();
    delete createdUser.password;

    return { user: createdUser, membership: orgMember, alreadyExisted: !createdNewUser };
};

export const deleteUser = async (adminOrgId, targetId, requestingUserId) => {
    const query = buildMemberQuery(adminOrgId, targetId);
    const orgMember = query ? await OrganisationMember.findOne(query) : null;
    if (!orgMember) {
        throw new Error('User is not a member of this organisation');
    }

    if (
        requestingUserId &&
        orgMember.user.toString() === requestingUserId.toString()
    ) {
        throw new Error('You cannot remove yourself from the organisation');
    }

    // Hard-remove the membership; the underlying User stays so the same
    // person can belong to / be re-added to other organisations.
    await OrganisationMember.deleteOne({ _id: orgMember._id });

    return true;
};

export const getUsers = async (orgId) => {
    const members = await OrganisationMember.find({
        organisation: orgId,
        status: { $ne: 'SUSPENDED' },
    })
        .populate('user', 'name email profilePic status')
        .populate('role', 'name permissions isCustom');

    return members;
};

export const getUserById = async (orgId, id) => {
    const query = buildMemberQuery(orgId, id);
    const member = query
        ? await OrganisationMember.findOne(query)
            .populate('user', 'name email profilePic status')
            .populate('role', 'name permissions isCustom')
        : null;

    if (!member) {
        throw new Error('User membership not found in this organisation');
    }

    return member;
};

export const updateMemberRole = async (orgId, id, newRoleId) => {
    if (!newRoleId) {
        throw new Error('roleId is required');
    }
    if (!isObjectId(newRoleId)) {
        throw new Error('Invalid roleId');
    }

    const query = buildMemberQuery(orgId, id);
    const member = query ? await OrganisationMember.findOne(query) : null;
    if (!member) {
        throw new Error('User membership not found in this organisation');
    }

    const newRole = await findRoleForOrg(orgId, newRoleId);
    if (!newRole) {
        throw new Error('Role not found or invalid for this organisation');
    }

    member.role = newRole._id;
    await member.save();

    return member;
};
