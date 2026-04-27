import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
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
  dueDate: {
    type: Date,
    index: true,
  },
  startDate: {
    type: Date,
  },
  isArchived: {
    type: Boolean,
    default: false,
    index: true,
  }
}, {
  timestamps: true,
});

export default mongoose.model('Task', taskSchema);
