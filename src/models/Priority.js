import mongoose from 'mongoose';

const prioritySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  level: {
    type: Number,
    required: true,
    index: true, // Useful for sorting tasks by priority
  }
}, {
  timestamps: true,
});

export default mongoose.model('Priority', prioritySchema);
