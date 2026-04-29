import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  description: {
    type: String,
    maxlength: 10000,
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
    index: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  assignees: [{ // Denormalized for fast "assigned to me" queries
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  }],
  parentTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    default: null,
    index: true,
  },
  status: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Status',
    index: true,
  },
  priority: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Priority',
    index: true,
  },
  // Position of the task within its status column on the Kanban board.
  // Stored as a Number (double) so the service layer can insert between
  // two existing rows by averaging their orders (e.g. drop between
  // 1000 and 2000 -> 1500) without renumbering the whole column.
  // New tasks should be appended with `(maxOrderInColumn ?? 0) + 1000`.
  // If two siblings ever collapse to the same value the service may
  // rebalance the column to a fresh 1000-step sequence.
  order: {
    type: Number,
    default: 0,
  },
  dueDate: {
    type: Date,
    index: true,
  },
  startDate: {
    type: Date,
  },
  completedAt: {
    type: Date,
    default: null,
  },
  isArchived: {
    type: Boolean,
    default: false,
    index: true,
  }
}, {
  timestamps: true,
});

// Primary board/Kanban query: list every task in a column, already sorted.
// Covers `find({ workspace, status }).sort({ order: 1 })` with one index scan.
taskSchema.index({ workspace: 1, status: 1, order: 1 });

// Backlog / list view fallback when no status filter is applied.
taskSchema.index({ workspace: 1, order: 1 });

export default mongoose.model('Task', taskSchema);
