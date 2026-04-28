import ActivityLog from '../models/ActivityLog.js';

// Fail-safe activity logger. Never throws — a logging failure must NOT
// take down the parent business operation (e.g. role creation must succeed
// even if the audit insert fails).
//
// Required: entityType, entityId, organisation, action, performedBy.
// Optional: workspace, metadata.
export const logActivity = async ({
    entityType,
    entityId,
    organisation,
    workspace,
    action,
    performedBy,
    metadata,
}) => {
    if (!entityType || !entityId || !organisation || !action || !performedBy) {
        // Silently skip; we don't want unauthenticated/system flows to crash.
        return null;
    }
    try {
        return await ActivityLog.create({
            entityType,
            entityId,
            organisation,
            workspace: workspace || null,
            action,
            performedBy,
            metadata: metadata || {},
        });
    } catch (err) {
        // Audit log issues should be observable but non-fatal.
        // eslint-disable-next-line no-console
        console.error('[activityLog] failed to record activity:', err.message);
        return null;
    }
};

// Convenience accessor: list activity for an organisation, newest first.
// Optional filters: entityType, entityId, performedBy, workspace.
export const listActivity = async (orgId, filters = {}, { limit = 50, skip = 0 } = {}) => {
    const query = { organisation: orgId };
    if (filters.entityType) query.entityType = filters.entityType;
    if (filters.entityId) query.entityId = filters.entityId;
    if (filters.performedBy) query.performedBy = filters.performedBy;
    if (filters.workspace) query.workspace = filters.workspace;

    return ActivityLog.find(query)
        .sort({ createdAt: -1 })
        .skip(Number(skip) || 0)
        .limit(Math.min(Number(limit) || 50, 200))
        .populate('performedBy', 'name email')
        .lean();
};
