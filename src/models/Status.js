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

export default mongoose.model('Status', statusSchema);
