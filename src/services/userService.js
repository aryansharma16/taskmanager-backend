import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Role from '../models/Role.js';
import OrganisationMember from '../models/OrganisationMember.js';

export const createUser = async (adminOrgId, name, email, password, roleName = 'MEMBER') => {
    // 1. Check if user already exists
    let user = await User.findOne({ email });

    // 2. Get role
    let role = await Role.findOne({ name: roleName.toUpperCase(), organisation: adminOrgId });
    if (!role) {
        role = await Role.findOne({ name: roleName.toUpperCase(), organisation: null }); // Fallback to global role if exists
    }
    if (!role) {
        // Fallback create basic member role if not exists globally or locally
        role = await Role.create({
            name: 'MEMBER',
            scope: 'ORGANISATION',
            permissions: ['read:user'],
        });
    }

    if (user) {
        // User exists, check if already in organisation
        const existingMember = await OrganisationMember.findOne({ user: user._id, organisation: adminOrgId });
        if (existingMember) {
            throw new Error('User is already a member of this organisation');
        }
    } else {
        // 3. Hash password and create user
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = await User.create({
            name,
            email,
            password: hashedPassword,
        });
    }

    // 4. Add user to organisation
    const orgMember = await OrganisationMember.create({
        user: user._id,
        organisation: adminOrgId,
        role: role._id,
    });

    // Remove password from returned object
    const createdUser = user.toObject();
    delete createdUser.password;

    return { user: createdUser, membership: orgMember };
};

export const deleteUser = async (adminOrgId, targetUserId) => {
    // 1. Find membership
    const orgMember = await OrganisationMember.findOne({ user: targetUserId, organisation: adminOrgId });
    if (!orgMember) {
        throw new Error('User is not a member of this organisation');
    }

    // 2. Suspend or remove user from organisation instead of deleting the User entirely
    orgMember.status = 'SUSPENDED';
    await orgMember.save();
    
    return true;
};

export const getUsers = async (orgId) => {
    const members = await OrganisationMember.find({ organisation: orgId })
        .populate('user', 'name email profilePic status')
        .populate('role', 'name permissions isCustom');
    
    return members;
};

export const getUserById = async (orgId, userId) => {
    const member = await OrganisationMember.findOne({ organisation: orgId, user: userId })
        .populate('user', 'name email profilePic status')
        .populate('role', 'name permissions isCustom');
    
    if (!member) {
        throw new Error('User membership not found in this organisation');
    }

    return member;
};

export const updateMemberRole = async (orgId, userId, newRoleId) => {
    const member = await OrganisationMember.findOne({ organisation: orgId, user: userId });
    if (!member) {
        throw new Error('User membership not found in this organisation');
    }

    const newRole = await Role.findOne({
        _id: newRoleId,
        $or: [{ organisation: orgId }, { organisation: null }]
    });

    if (!newRole) {
        throw new Error('Role not found or invalid for this organisation');
    }

    member.role = newRole._id;
    await member.save();

    return member;
};
