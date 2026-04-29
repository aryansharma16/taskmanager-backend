import mongoose from 'mongoose';

const statusSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  color: {
    type: String,
    trim: true,
    default: '#cccccc', // Default placeholder color
  },
  // Position of this status in the workspace's pipeline. Lower = earlier
  // stage (e.g. "Todo" = 0, "In Progress" = 1, "Done" = 2). Not unique
  // on purpose — duplicates and gaps are tolerated and resolved by
  // sorting (`order` ASC, then `name` ASC). The service layer
  // auto-assigns `max+1` when a status is created without an explicit
  // value so new columns always land at the end of the board.
  order: {
    type: Number,
    default: 0,
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  }
}, {
  timestamps: true,
});

// Ensure status names are unique within a workspace
statusSchema.index({ workspace: 1, name: 1 }, { unique: true });
// Composite index that matches the sort used by `listStatuses` and
// `getBoard`, so the pipeline view stays cheap as the workspace grows.
statusSchema.index({ workspace: 1, order: 1, name: 1 });

export default mongoose.model('Status', statusSchema);
