import mongoose from 'mongoose';

const labelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  color: {
    type: String,
    trim: true,
    default: '#cccccc',
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

// Ensure label names are unique within a workspace
labelSchema.index({ workspace: 1, name: 1 }, { unique: true });

export default mongoose.model('Label', labelSchema);
