import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Role from '../models/Role.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '../../.env') });

const updateOwnerRole = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected...');

        const result = await Role.updateMany(
            { name: 'OWNER' },
            { 
                $addToSet: { 
                    permissions: { 
                        $each: [
                            'create:role', 'read:role', 'update:role', 'delete:role',
                            'read:org', 'update:org'
                        ] 
                    } 
                } 
            }
        );

        console.log(`✅ Updated existing OWNER roles. Modified ${result.modifiedCount} documents.`);
        process.exit();
    } catch (error) {
        console.error('❌ Error updating roles:', error);
        process.exit(1);
    }
};

updateOwnerRole();
