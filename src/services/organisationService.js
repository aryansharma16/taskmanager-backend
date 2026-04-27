import Organisation from '../models/Organisation.js';

export const createOrganisation = async (name, slug, description, subscriptionPlan) => {
    const existingOrg = await Organisation.findOne({ slug });
    if (existingOrg) {
        throw new Error('Organisation with this slug already exists');
    }

    const org = await Organisation.create({
        name,
        slug,
        description: description || '',
        subscriptionPlan: subscriptionPlan || 'free',
    });

    return org;
};

export const getOrganisations = async () => {
    // Typically for SUPER_ADMIN
    return await Organisation.find();
};

export const getOrganisationById = async (orgId) => {
    const org = await Organisation.findById(orgId);
    if (!org) {
        throw new Error('Organisation not found');
    }
    return org;
};

export const updateOrganisation = async (orgId, updateData) => {
    const org = await Organisation.findById(orgId);
    if (!org) {
        throw new Error('Organisation not found');
    }

    // prevent slug update if it conflicts
    if (updateData.slug && updateData.slug !== org.slug) {
        const existing = await Organisation.findOne({ slug: updateData.slug });
        if (existing) throw new Error('Slug already taken');
    }

    Object.assign(org, updateData);
    await org.save();
    
    return org;
};

export const deleteOrganisation = async (orgId) => {
    const org = await Organisation.findById(orgId);
    if (!org) {
        throw new Error('Organisation not found');
    }

    org.isActive = false;
    org.subscriptionStatus = 'canceled';
    await org.save();

    return true;
};
