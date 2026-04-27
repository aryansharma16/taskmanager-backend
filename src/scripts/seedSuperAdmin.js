import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Role from '../models/Role.js';
import Organisation from '../models/Organisation.js';
import OrganisationMember from '../models/OrganisationMember.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '../../.env') });

const seedSystem = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected for seeding...');

        // 1. Create System Organisation
        let systemOrg = await Organisation.findOne({ slug: 'system-admin' });
        if (!systemOrg) {
            systemOrg = await Organisation.create({
                name: 'System Administration',
                slug: 'system-admin',
                description: 'Top-level organisation for system administrators',
                subscriptionPlan: 'enterprise',
            });
            console.log('✅ System Organisation created');
        } else {
            console.log('ℹ️ System Organisation already exists');
        }

        // 2. Create the SUPER_ADMIN role (system-wide)
        let superAdminRole = await Role.findOne({ name: 'SUPER_ADMIN', scope: 'SYSTEM' });
        if (!superAdminRole) {
            superAdminRole = await Role.create({
                name: 'SUPER_ADMIN',
                scope: 'SYSTEM',
                organisation: systemOrg._id, // Tied to the system org
                description: 'Top-most system level role granting absolute access',
                permissions: ['*'], // Wildcard permission
                isCustom: false,
            });
            console.log('✅ SUPER_ADMIN role created');
        } else {
            console.log('ℹ️ SUPER_ADMIN role already exists');
        }

        // 3. Create the super admin user
        const superAdminEmail = 'admin@taskmanager.com';
        let superAdminUser = await User.findOne({ email: superAdminEmail });

        if (!superAdminUser) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('supersecret', salt);

            superAdminUser = await User.create({
                name: 'System Admin',
                email: superAdminEmail,
                password: hashedPassword,
            });
            console.log('✅ Super Admin user created');
            console.log(`   Email: ${superAdminEmail}`);
            console.log(`   Password: supersecret`);
        } else {
            console.log('ℹ️ Super Admin user already exists');
        }

        // 4. Link User, Organisation, and Role via OrganisationMember
        let orgMember = await OrganisationMember.findOne({
            user: superAdminUser._id,
            organisation: systemOrg._id,
        });

        if (!orgMember) {
            orgMember = await OrganisationMember.create({
                user: superAdminUser._id,
                organisation: systemOrg._id,
                role: superAdminRole._id,
                status: 'ACTIVE',
            });
            console.log('✅ Linked Super Admin user to System Organisation with SUPER_ADMIN role');
        } else {
            console.log('ℹ️ Super Admin user is already a member of the System Organisation');
            // Ensure they have the correct role
            if (orgMember.role.toString() !== superAdminRole._id.toString()) {
                orgMember.role = superAdminRole._id;
                await orgMember.save();
                console.log('✅ Updated existing member to SUPER_ADMIN role');
            }
        }

        console.log('Seeding completed successfully!');
        process.exit();
    } catch (error) {
        console.error('❌ Error seeding system data:', error);
        process.exit(1);
    }
};

seedSystem();
