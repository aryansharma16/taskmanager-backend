import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  entityType: {
    type: String,
    required: true,
    index: true, // E.g., 'Task', 'Comment', 'Workspace'
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  workspace: { // Added for fast workspace-level activity feeds
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  },
  action: {
    type: String,
    required: true, // E.g., 'created', 'updated', 'assigned', 'deleted'
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

export default mongoose.model('ActivityLog', activityLogSchema);
