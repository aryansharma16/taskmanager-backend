import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Role name is required'],
            trim: true,
            uppercase: true, // e.g., 'OWNER', 'ADMIN', 'MEMBER'
        },
        scope: {
            type: String,
            enum: ['ORGANISATION', 'WORKSPACE'],
            default: 'ORGANISATION',
            required: true,
        },
        organisation: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organisation',
            default: null, // Null means it's a global system default role
        },
        description: {
            type: String,
            trim: true,
            maxlength: [200, 'Description cannot exceed 200 characters'],
            default: '',
        },
        permissions: {
            type: [String],
            default: [],
            // e.g., ['create:user', 'delete:user', 'read:users']
        },
        isCustom: {
            type: Boolean,
            default: false, // Helps differentiate system default roles vs organisation-created custom roles
        },
        metadata: {
            type: Map,
            of: mongoose.Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index allows different orgs to have custom roles with the same name
roleSchema.index({ name: 1, organisation: 1, scope: 1 }, { unique: true });

export default mongoose.model('Role', roleSchema);
