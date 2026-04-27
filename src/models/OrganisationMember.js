import mongoose from 'mongoose';

const organisationMemberSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  organisation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organisation',
    required: true,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'SUSPENDED', 'INVITED'],
    default: 'ACTIVE',
  }
}, {
  timestamps: true,
});

// Unique compound index so a user is only added to an org once
organisationMemberSchema.index({ user: 1, organisation: 1 }, { unique: true });
// Index for finding all members of an org
organisationMemberSchema.index({ organisation: 1, role: 1 });

export default mongoose.model('OrganisationMember', organisationMemberSchema);
