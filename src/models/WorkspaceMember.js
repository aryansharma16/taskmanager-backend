import mongoose from 'mongoose';

const workspaceMemberSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        workspace: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Workspace',
            required: true,
        },
        role: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Role',
            required: true,
        },
        // Mirrors OrganisationMember.status so we can support invitations
        // and suspensions without losing the row.
        status: {
            type: String,
            enum: ['ACTIVE', 'SUSPENDED', 'INVITED'],
            default: 'ACTIVE',
        },
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// A user can only be added to a workspace once.
workspaceMemberSchema.index({ user: 1, workspace: 1 }, { unique: true });
// Speeds up RBAC scans like "find members of this workspace by role".
workspaceMemberSchema.index({ workspace: 1, role: 1 });
// Useful for "all workspaces I belong to" queries.
workspaceMemberSchema.index({ user: 1, status: 1 });

export default mongoose.model('WorkspaceMember', workspaceMemberSchema);
