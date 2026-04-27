import mongoose from 'mongoose';

const taskLabelSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  label: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Label',
    required: true,
  }
}, {
  timestamps: true,
});

// Unique compound index for task and label
taskLabelSchema.index({ task: 1, label: 1 }, { unique: true });

export default mongoose.model('TaskLabel', taskLabelSchema);
