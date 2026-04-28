import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'User name is required'],
            trim: true,
            maxlength: [100, 'Name cannot be more than 100 characters'],
        },
        email: {
            type: String,
            required: [true, 'User email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [
                /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
                'Please add a valid email',
            ],
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
            minlength: 6,
            select: false, // Don't return password in queries by default
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        lastLogin: {
            type: Date,
            default: null,
        },
        profilePic: {
            type: String,
            default: '', // Store a URL to the image (e.g., S3 or Cloudinary)
        },
        phoneNumber: {
            type: String,
            trim: true,
            default: '',
        },
        status: {
            type: String,
            enum: ['active', 'suspended', 'invited'],
            default: 'active',
        },
        metadata: {
            type: Map,
            of: mongoose.Schema.Types.Mixed, // Future proof: store arbitrary data like preferences
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model('User', userSchema);
