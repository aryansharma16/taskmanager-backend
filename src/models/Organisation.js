import mongoose from 'mongoose';

const organisationSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Organisation name is required'],
            trim: true,
            maxlength: [100, 'Name cannot be more than 100 characters'],
        },
        slug: {
            type: String,
            required: [true, 'Organisation slug is required'],
            unique: true,
            trim: true,
            lowercase: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        description: {
            type: String,
            trim: true,
            maxlength: [500, 'Description cannot be more than 500 characters'],
            default: '',
        },
        logo: {
            type: String,
            default: '', // Store URL to the organisation's logo
        },
        website: {
            type: String,
            trim: true,
            default: '',
        },
        industry: {
            type: String,
            trim: true,
            default: '',
        },
        subscriptionPlan: {
            type: String,
            enum: ['free', 'pro', 'enterprise'],
            default: 'free',
        },
        subscriptionStatus: {
            type: String,
            enum: ['active', 'past_due', 'canceled', 'trialing'],
            default: 'active',
        },
        billingEmail: {
            type: String,
            match: [
                /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
                'Please add a valid email',
            ],
            default: null,
        },
        metadata: {
            type: Map,
            of: mongoose.Schema.Types.Mixed, // Future proof for specific organisation settings or features
        },
    },
    {
        timestamps: true,
    }
);

export default mongoose.model('Organisation', organisationSchema);
