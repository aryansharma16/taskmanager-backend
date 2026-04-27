import mongoose from 'mongoose';

const workspaceMemberSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  workspace: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workspace',
    required: true,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
  }
}, {
  timestamps: true,
});

// Unique compound index for user and workspace
workspaceMemberSchema.index({ user: 1, workspace: 1 }, { unique: true });

export default mongoose.model('WorkspaceMember', workspaceMemberSchema);
