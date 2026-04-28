import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  entityType: {
    type: String,
    required: true,
    index: true, // E.g., 'Task', 'Comment', 'Role', 'OrganisationMember'
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  // Org context is always present (RBAC + workspace activities both belong
  // to a tenant). Required so org-level audit feeds work.
  organisation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    required: true,
    index: true,
  },
  // Workspace is optional — RBAC operations (role/user mgmt) don't belong
  // to any workspace.
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    default: null,
    index: true,
  },
  action: {
    type: String,
    required: true, // E.g., 'created', 'updated', 'role_changed', 'deleted'
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  }
}, {
  timestamps: true,
});

// Compound index for querying a specific entity's timeline efficiently
activityLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
// Compound index for rendering workspace activity feeds
activityLogSchema.index({ workspace: 1, createdAt: -1 });
// Compound index for rendering organisation-wide audit feeds
activityLogSchema.index({ organisation: 1, createdAt: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);
