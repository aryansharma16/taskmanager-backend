import * as orgService from '../services/organisationService.js';

export const createOrganisationController = async (req, res, next) => {
    try {
        const { name, slug, description, subscriptionPlan } = req.body;
        const org = await orgService.createOrganisation(name, slug, description, subscriptionPlan);
        res.status(201).json({ success: true, data: org });
    } catch (error) {
        next(error);
    }
};

export const getOrganisationsController = async (req, res, next) => {
    try {
        const orgs = await orgService.getOrganisations();
        res.status(200).json({ success: true, data: orgs });
    } catch (error) {
        next(error);
    }
};

export const getOrganisationByIdController = async (req, res, next) => {
    try {
        // A user can only fetch their own org unless they are SUPER_ADMIN.
        // For now, rely on `requirePermissions` middleware or explicit checks.
        // Assuming the route parameter :id is what they are trying to fetch.
        const reqOrgId = req.params.id;
        const userOrgId = req.user.organisation;

        // If they don't have SUPER_ADMIN wildcard, ensure they are fetching their own org
        if (!req.user.role.permissions.includes('*') && reqOrgId !== userOrgId.toString()) {
            return res.status(403).json({ success: false, error: 'Cannot access another organisation' });
        }

        const org = await orgService.getOrganisationById(reqOrgId);
        res.status(200).json({ success: true, data: org });
    } catch (error) {
        next(error);
    }
};

export const updateOrganisationController = async (req, res, next) => {
    try {
        const reqOrgId = req.params.id;
        const userOrgId = req.user.organisation;

        if (!req.user.role.permissions.includes('*') && reqOrgId !== userOrgId.toString()) {
            return res.status(403).json({ success: false, error: 'Cannot update another organisation' });
        }

        const org = await orgService.updateOrganisation(reqOrgId, req.body);
        res.status(200).json({ success: true, data: org });
    } catch (error) {
        next(error);
    }
};

export const deleteOrganisationController = async (req, res, next) => {
    try {
        const reqOrgId = req.params.id;
        const userOrgId = req.user.organisation;

        if (!req.user.role.permissions.includes('*') && reqOrgId !== userOrgId.toString()) {
            return res.status(403).json({ success: false, error: 'Cannot delete another organisation' });
        }

        await orgService.deleteOrganisation(reqOrgId);
        res.status(200).json({ success: true, data: {}, message: 'Organisation suspended successfully' });
    } catch (error) {
        next(error);
    }
};
