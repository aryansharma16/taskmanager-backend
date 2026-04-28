import mongoose from 'mongoose';

const workspaceSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Workspace name is required'],
            trim: true,
            maxlength: [100, 'Name cannot be more than 100 characters'],
        },
        slug: {
            type: String,
            required: [true, 'Workspace slug is required'],
            trim: true,
            lowercase: true,
            // Slug is unique per organisation, enforced via the compound
            // index below (not via field-level `unique`, which would be
            // global across tenants).
        },
        description: {
            type: String,
            trim: true,
            maxlength: [500, 'Description cannot be more than 500 characters'],
            default: '',
        },
        organisation: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organisation',
            required: true,
            index: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        // Soft-delete support: workspaces are flagged inactive instead of
        // hard-deleted so audit trails and historical references survive.
        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },
        archivedAt: {
            type: Date,
            default: null,
        },
        // Future-proof bag for per-workspace settings (e.g. theme,
        // automation flags) without further schema migrations.
        metadata: {
            type: Map,
            of: mongoose.Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

// Slug must be unique within an organisation (different orgs may reuse
// the same slug, e.g. "engineering").
workspaceSchema.index({ organisation: 1, slug: 1 }, { unique: true });
// Name must also be unique within an organisation for a friendlier UX.
workspaceSchema.index({ organisation: 1, name: 1 }, { unique: true });

export default mongoose.model('Workspace', workspaceSchema);
