import mongoose from 'mongoose';

const taskAssignmentSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: ['LEADER', 'ASSIGNEE', 'WATCHER'],
    default: 'ASSIGNEE',
    required: true,
  }
}, {
  timestamps: true,
});

// Unique compound index for task, user, and role
taskAssignmentSchema.index({ task: 1, user: 1, role: 1 }, { unique: true });

export default mongoose.model('TaskAssignment', taskAssignmentSchema);
