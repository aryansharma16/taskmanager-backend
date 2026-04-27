import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Organisation from '../models/Organisation.js';
import Role from '../models/Role.js';
import OrganisationMember from '../models/OrganisationMember.js';

export const registerTenant = async (orgName, slug, userName, userEmail, userPassword) => {
    // 1. Check if org slug or user email already exists
    const existingOrg = await Organisation.findOne({ slug });
    if (existingOrg) throw new Error('Organisation with this slug already exists');

    const existingUser = await User.findOne({ email: userEmail });
    if (existingUser) throw new Error('User with this email already exists');

    // 2. Create Organisation
    const organisation = await Organisation.create({ name: orgName, slug });

    // 3. Ensure 'OWNER' role exists
    let ownerRole = await Role.findOne({ name: 'OWNER', scope: 'ORGANISATION' });
    if (!ownerRole) {
        ownerRole = await Role.create({
            name: 'OWNER',
            scope: 'ORGANISATION',
            permissions: [
                'create:user', 'read:user', 'update:user', 'delete:user',
                'create:role', 'read:role', 'update:role', 'delete:role',
                'read:org', 'update:org'
            ],
        });
    }

    // 4. Hash password and create initial User
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(userPassword, salt);

    const user = await User.create({
        name: userName,
        email: userEmail,
        password: hashedPassword,
    });

    const orgMember = await OrganisationMember.create({
        user: user._id,
        organisation: organisation._id,
        role: ownerRole._id,
        status: 'ACTIVE'
    });

    return { organisation, user };
};

export const login = async (email, password) => {
    // 1. Check for user and include password in query
    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.isActive) {
        throw new Error('Invalid credentials or user is inactive');
    }

    // 2. Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new Error('Invalid credentials');
    }

    // 3. Get organisation memberships
    const orgMembers = await OrganisationMember.find({ user: user._id, status: 'ACTIVE' })
        .populate('organisation')
        .populate('role');

    // 4. Sign JWT
    const payload = {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        organisations: orgMembers.map((member) => ({
            organisationId: member.organisation._id,
            name: member.organisation.name,
            slug: member.organisation.slug,
            role: member.role.name,
        })),
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET || 'secret123', {
        expiresIn: process.env.JWT_EXPIRE || '30d',
    });

    // 5. Update lastLogin for user
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    return { token, user, orgMembers };
};
