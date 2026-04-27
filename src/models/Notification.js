import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    required: true, // E.g., 'TASK_ASSIGNED', 'MENTIONED', 'TASK_COMPLETED'
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true, // Reference to the actual entity (Task, Comment, etc.)
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  }
}, {
  timestamps: true,
});

// Compound index for querying unread notifications for a user efficiently
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
