import mongoose from 'mongoose';
import Status from '../models/Status.js';
import Task from '../models/Task.js';
import { logActivity } from './activityLogService.js';

const isObjectId = (v) => mongoose.isValidObjectId(v);

// Hex color validator. Accepts #RGB and #RRGGBB; the model defaults to
// `#cccccc` if absent, so we only run this when the caller supplied a
// value. Empty string is rejected — it's almost always a UI bug.
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const MAX_NAME_LENGTH = 60;

const normaliseName = (raw) => {
    if (typeof raw !== 'string') {
        throw new Error('Status name is required');
    }
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('Status name is required');
    if (trimmed.length > MAX_NAME_LENGTH) {
        throw new Error(
            `Status name must be ${MAX_NAME_LENGTH} characters or fewer`,
        );
    }
    return trimmed;
};

const normaliseColor = (raw) => {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return undefined;
    if (typeof raw !== 'string' || !HEX_COLOR_RE.test(raw.trim())) {
        throw new Error('color must be a hex string like #1f9d55 or #f80');
    }
    return raw.trim().toLowerCase();
};

// Order is a stable sort key for the pipeline ("Todo" < "In Progress" <
// "Done"). We accept any finite, non-negative integer — the value is
// deliberately just a sort hint, not a slot number, so callers don't
// have to worry about gaps. `null`/`undefined` means "no preference"
// and lets `createStatus` auto-pick `max+1`.
const normaliseOrder = (raw) => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new Error('order must be a non-negative integer');
    }
    return n;
};

// Find the next free `order` value for a workspace. Used when a status
// is created without an explicit order so it lands at the end of the
// pipeline rather than colliding with the default `0`.
const nextOrderFor = async (workspaceId) => {
    const last = await Status.findOne({ workspace: workspaceId })
        .sort({ order: -1 })
        .select('order')
        .lean();
    return last ? (last.order ?? 0) + 1 : 0;
};

// Resolve `:statusId` to a Status row that lives in the given workspace.
// We fold the workspace boundary into the query (instead of fetching and
// then comparing) so cross-tenant probes return 404 with no extra round
// trip — same pattern the workspace middleware uses for workspaces.
const findStatusInWorkspace = async (workspaceId, statusId) => {
    if (!isObjectId(statusId)) throw new Error('Invalid status id');
    return Status.findOne({ _id: statusId, workspace: workspaceId });
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const createStatus = async (workspace, payload, actorId) => {
    const name = normaliseName(payload?.name);
    const color = normaliseColor(payload?.color);
    const explicitOrder = normaliseOrder(payload?.order);

    // Pre-flight uniqueness check so we can surface a friendly error
    // before hitting the unique compound index. The index is still the
    // source of truth and will catch concurrent races as `409`.
    const clash = await Status.findOne({
        workspace: workspace._id,
        name,
    }).collation({ locale: 'en', strength: 2 });
    if (clash) {
        throw new Error('A status with this name already exists in this workspace');
    }

    // If the caller didn't pin an order, append to the end of the
    // pipeline. Two concurrent creates can land on the same `order`,
    // which is fine — `name` is the secondary sort key and clients
    // can call `reorderStatuses` to compact later.
    const order =
        explicitOrder !== undefined
            ? explicitOrder
            : await nextOrderFor(workspace._id);

    const status = await Status.create({
        name,
        color: color || undefined,
        order,
        workspace: workspace._id,
    });

    await logActivity({
        entityType: 'Status',
        entityId: status._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'created',
        performedBy: actorId,
        metadata: {
            name: status.name,
            color: status.color,
            order: status.order,
        },
    });

    return status;
};

// List statuses for a workspace. Sorted by pipeline `order` ASC (with
// `name` as a stable tiebreaker for ties / legacy rows that all share
// the default `0`) so the configuration UI and `getBoard` agree on
// column order. When `withTaskCounts` is set, each row is enriched
// with the number of *active* tasks pointing at it — useful for
// rendering column counts in the configuration UI without fetching
// the full board.
export const listStatuses = async (
    workspace,
    { withTaskCounts = false } = {},
) => {
    const statuses = await Status.find({ workspace: workspace._id })
        .sort({ order: 1, name: 1 })
        .lean();

    if (!withTaskCounts || statuses.length === 0) {
        return statuses;
    }

    // One aggregation per call, not per status. Bucket counts by status
    // id and merge back in JS.
    const counts = await Task.aggregate([
        {
            $match: {
                workspace: workspace._id,
                isArchived: false,
                status: { $in: statuses.map((s) => s._id) },
            },
        },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [c._id.toString(), c.count]));
    return statuses.map((s) => ({
        ...s,
        taskCount: byId.get(s._id.toString()) || 0,
    }));
};

export const getStatusById = async (workspace, statusId) => {
    const status = await findStatusInWorkspace(workspace._id, statusId);
    if (!status) throw new Error('Status not found');

    const taskCount = await Task.countDocuments({
        workspace: workspace._id,
        status: status._id,
        isArchived: false,
    });

    return { status, taskCount };
};

export const updateStatus = async (workspace, statusId, patch, actorId) => {
    const status = await findStatusInWorkspace(workspace._id, statusId);
    if (!status) throw new Error('Status not found');

    const before = {
        name: status.name,
        color: status.color,
        order: status.order,
    };

    if (patch.name !== undefined) {
        const next = normaliseName(patch.name);
        if (next.toLowerCase() !== status.name.toLowerCase()) {
            // Same uniqueness pre-flight as create. Excludes this row
            // so renaming `Todo -> todo` (case-only change) succeeds.
            const clash = await Status.findOne({
                workspace: workspace._id,
                name: next,
                _id: { $ne: status._id },
            }).collation({ locale: 'en', strength: 2 });
            if (clash) {
                throw new Error(
                    'A status with this name already exists in this workspace',
                );
            }
        }
        status.name = next;
    }
    if (patch.color !== undefined) {
        status.color = normaliseColor(patch.color) || '#cccccc';
    }
    // Single-status order updates are a quick "nudge" — they don't
    // renumber siblings. For drag-and-drop rearranges that need the
    // whole pipeline updated atomically, callers should use
    // `reorderStatuses` instead.
    if (patch.order !== undefined) {
        const nextOrder = normaliseOrder(patch.order);
        if (nextOrder === undefined) {
            throw new Error('order must be a non-negative integer');
        }
        status.order = nextOrder;
    }

    await status.save();

    await logActivity({
        entityType: 'Status',
        entityId: status._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'updated',
        performedBy: actorId,
        metadata: {
            before,
            after: {
                name: status.name,
                color: status.color,
                order: status.order,
            },
        },
    });

    return status;
};

// Bulk-reorder the pipeline. Accepts an ordered array of status ids;
// position in the array becomes the new `order` value. Validates that
// every id belongs to the workspace and that the array covers the full
// set of statuses (no missing or extra ids), so the resulting
// `0..n-1` numbering is gap-free and unambiguous.
//
// We use an unordered `bulkWrite` so all the writes ship in a single
// round trip. If any write fails, MongoDB still applies the others —
// callers can re-issue the operation safely because the inputs are
// idempotent (the same ids map to the same indices).
export const reorderStatuses = async (workspace, orderedIds, actorId) => {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        throw new Error('orderedIds must be a non-empty array');
    }
    for (const id of orderedIds) {
        if (!isObjectId(id)) throw new Error('Invalid status id in orderedIds');
    }

    const seen = new Set(orderedIds.map(String));
    if (seen.size !== orderedIds.length) {
        throw new Error('orderedIds contains duplicates');
    }

    const existing = await Status.find({ workspace: workspace._id })
        .select('_id order name')
        .lean();
    const existingIds = new Set(existing.map((s) => s._id.toString()));

    if (existing.length !== seen.size) {
        throw new Error(
            'orderedIds must reference every status in the workspace exactly once',
        );
    }
    for (const id of seen) {
        if (!existingIds.has(id)) {
            throw new Error(
                `Status ${id} does not belong to this workspace`,
            );
        }
    }

    const ops = orderedIds.map((id, index) => ({
        updateOne: {
            filter: { _id: id, workspace: workspace._id },
            update: { $set: { order: index } },
        },
    }));
    await Status.bulkWrite(ops, { ordered: false });

    await logActivity({
        entityType: 'Workspace',
        entityId: workspace._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'statuses_reordered',
        performedBy: actorId,
        metadata: {
            order: orderedIds.map(String),
        },
    });

    return Status.find({ workspace: workspace._id })
        .sort({ order: 1, name: 1 })
        .lean();
};

// Delete a status. Tasks reference Status by ObjectId without a foreign
// key, so deleting a status that's still in use would leave dangling
// refs that the board view would silently drop into the "no status"
// column. We block that by default and let callers opt into a migration
// by passing `reassignTo`:
//
//   - `reassignTo` omitted / null → block if any task uses the status.
//   - `reassignTo: <statusId>`   → bulk-update every active task on the
//      old status to the new one, then delete.
//   - `reassignTo: 'null'`       → bulk-clear every active task's status
//      (they fall into the "no status" column), then delete.
//
// Archived tasks intentionally keep the dangling ref — we don't want a
// soft-deleted task to be silently re-statused on a future restore.
export const deleteStatus = async (
    workspace,
    statusId,
    { reassignTo } = {},
    actorId,
) => {
    const status = await findStatusInWorkspace(workspace._id, statusId);
    if (!status) throw new Error('Status not found');

    let nextStatusId = undefined;
    if (reassignTo !== undefined && reassignTo !== null && reassignTo !== '') {
        if (reassignTo === 'null' || reassignTo === false) {
            nextStatusId = null;
        } else {
            if (!isObjectId(reassignTo)) {
                throw new Error('Invalid reassignTo status id');
            }
            if (reassignTo.toString() === status._id.toString()) {
                throw new Error(
                    'reassignTo must be a different status from the one being deleted',
                );
            }
            const target = await findStatusInWorkspace(
                workspace._id,
                reassignTo,
            );
            if (!target) {
                throw new Error('reassignTo status not found in this workspace');
            }
            nextStatusId = target._id;
        }
    }

    const inUseFilter = {
        workspace: workspace._id,
        status: status._id,
        isArchived: false,
    };
    const inUseCount = await Task.countDocuments(inUseFilter);

    if (inUseCount > 0 && nextStatusId === undefined) {
        throw new Error(
            `Cannot delete status: ${inUseCount} active task(s) still use it. Pass reassignTo to migrate them.`,
        );
    }

    if (inUseCount > 0) {
        await Task.updateMany(inUseFilter, {
            $set: { status: nextStatusId },
        });
    }

    await Status.deleteOne({ _id: status._id });

    await logActivity({
        entityType: 'Status',
        entityId: status._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'deleted',
        performedBy: actorId,
        metadata: {
            name: status.name,
            color: status.color,
            reassignedTaskCount: inUseCount,
            reassignedTo:
                nextStatusId === undefined
                    ? undefined
                    : nextStatusId === null
                        ? null
                        : String(nextStatusId),
        },
    });

    return { reassignedTaskCount: inUseCount };
};
