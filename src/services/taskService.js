import mongoose from 'mongoose';
import Task from '../models/Task.js';
import TaskAssignment from '../models/TaskAssignment.js';
import Status from '../models/Status.js';
import Priority from '../models/Priority.js';
import WorkspaceMember from '../models/WorkspaceMember.js';
import { logActivity } from './activityLogService.js';

const isObjectId = (v) => mongoose.isValidObjectId(v);

// Drag-and-drop tuning. ORDER_STEP gives every freshly-appended task a
// 1000-unit gap from its predecessor, so callers can do thousands of
// fractional inserts before MIN_ORDER_GAP triggers a rebalance.
const ORDER_STEP = 1000;
const MIN_ORDER_GAP = 1e-6;

// Hard cap on how far we walk up `parentTask` chains during cycle
// detection. A real human-built tree never gets near this, but it
// guards against pathological data and infinite loops if a cycle
// somehow survived the validation here.
const MAX_PARENT_DEPTH = 100;

const ASSIGNMENT_ROLES = ['LEADER', 'ASSIGNEE', 'WATCHER'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Accept both bare names (`status`, `priority`, `parentTask`) and the
// more intuitive `Id`-suffixed aliases (`statusId`, `priorityId`,
// `parentTaskId`) on every task body. FE devs naturally reach for
// `statusId` when the value is a Mongo ObjectId; without this shim the
// unknown key is silently dropped on the floor and the task is created
// with no status — landing in the "no status" bucket on the board.
//
// We use the `in` operator (not truthiness) so an explicit `null` from
// the canonical key is preserved — `{ status: null }` clears the field
// even if `statusId` is also present.
const TASK_FIELD_ALIASES = [
    ['status', 'statusId'],
    ['priority', 'priorityId'],
    ['parentTask', 'parentTaskId'],
];

const normaliseTaskPayload = (input) => {
    if (!input || typeof input !== 'object') return input || {};
    const out = { ...input };
    for (const [canonical, alias] of TASK_FIELD_ALIASES) {
        if (!(canonical in out) && (alias in out)) {
            out[canonical] = out[alias];
        }
    }
    return out;
};

const assertSameWorkspace = (entity, workspaceId, label) => {
    if (!entity) return;
    if (entity.workspace.toString() !== workspaceId.toString()) {
        throw new Error(`${label} does not belong to this workspace`);
    }
};

// Workspace membership is the anchor for "who can be involved in a task".
// We deliberately require an ACTIVE WorkspaceMember (not just an org
// member) so an assignee can actually access the task without relying on
// org-level bypass perms.
const requireActiveWorkspaceMember = async (workspaceId, userId) => {
    if (!isObjectId(userId)) {
        throw new Error(`Invalid userId: ${userId}`);
    }
    const member = await WorkspaceMember.findOne({
        workspace: workspaceId,
        user: userId,
        status: 'ACTIVE',
    });
    if (!member) {
        throw new Error(`User ${userId} is not an active member of this workspace`);
    }
    return member;
};

const validateStatus = async (workspaceId, statusId) => {
    if (statusId === null || statusId === undefined) return null;
    if (!isObjectId(statusId)) throw new Error('Invalid statusId');
    const status = await Status.findById(statusId);
    if (!status) throw new Error('Status not found');
    assertSameWorkspace(status, workspaceId, 'Status');
    return status;
};

// Priority is currently a *global* lookup (not workspace-scoped). We still
// resolve and 404 if missing, but no tenant boundary check is needed.
const validatePriority = async (priorityId) => {
    if (priorityId === null || priorityId === undefined) return null;
    if (!isObjectId(priorityId)) throw new Error('Invalid priorityId');
    const priority = await Priority.findById(priorityId);
    if (!priority) throw new Error('Priority not found');
    return priority;
};

// `movingTaskId` is the task we'd be re-parenting. When it is set we
// also walk up from the proposed parent to make sure `movingTaskId`
// never appears in the chain (would create a cycle).
const validateParent = async (workspaceId, parentTaskId, movingTaskId = null) => {
    if (parentTaskId === null || parentTaskId === undefined) return null;
    if (!isObjectId(parentTaskId)) throw new Error('Invalid parentTaskId');
    if (movingTaskId && parentTaskId.toString() === movingTaskId.toString()) {
        throw new Error('A task cannot be its own parent');
    }
    const parent = await Task.findById(parentTaskId).select(
        'parentTask workspace isArchived'
    );
    if (!parent) throw new Error('Parent task not found');
    assertSameWorkspace(parent, workspaceId, 'Parent task');
    if (parent.isArchived) throw new Error('Parent task is archived');

    if (movingTaskId) {
        let cursorParentId = parent.parentTask;
        for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
            if (!cursorParentId) return parent;
            if (cursorParentId.toString() === movingTaskId.toString()) {
                throw new Error(
                    'Cannot make a descendant the parent (would create a cycle)'
                );
            }
            // eslint-disable-next-line no-await-in-loop
            const next = await Task.findById(cursorParentId).select('parentTask');
            if (!next) return parent;
            cursorParentId = next.parentTask;
        }
        throw new Error(
            `Parent chain exceeds maximum depth of ${MAX_PARENT_DEPTH}`
        );
    }
    return parent;
};

// Builds the filter that defines a single Kanban "column": tasks in a
// workspace under a specific status (or under no status at all).
// Centralised so append/move/rebalance always agree on what a column is.
const columnFilter = (workspaceId, statusId) => {
    const filter = { workspace: workspaceId, isArchived: false };
    if (statusId) {
        filter.status = statusId;
    } else {
        filter.status = null;
    }
    return filter;
};

const computeAppendOrder = async (workspaceId, statusId) => {
    const last = await Task.findOne(columnFilter(workspaceId, statusId))
        .sort({ order: -1 })
        .select('order');
    return (last?.order ?? 0) + ORDER_STEP;
};

// Rare maintenance op: rewrite every order in the column to a clean
// 1000-step sequence. Triggered automatically when fractional inserts
// push two siblings to within MIN_ORDER_GAP of each other.
const rebalanceColumn = async (workspaceId, statusId) => {
    const tasks = await Task.find(columnFilter(workspaceId, statusId))
        .sort({ order: 1, createdAt: 1, _id: 1 })
        .select('_id');
    if (!tasks.length) return;
    const ops = tasks.map((t, idx) => ({
        updateOne: {
            filter: { _id: t._id },
            update: { $set: { order: (idx + 1) * ORDER_STEP } },
        },
    }));
    await Task.bulkWrite(ops, { ordered: false });
};

// Resolve the new `order` value for a drag-and-drop into a target
// column. `beforeId` is the task that should sit immediately ABOVE the
// dropped task (smaller `order`); `afterId` is the one immediately
// BELOW (larger `order`). Either / both / neither may be passed.
const computeMoveOrder = async (workspaceId, statusId, beforeId, afterId) => {
    const lookup = async (id) => {
        if (!id) return null;
        if (!isObjectId(id)) throw new Error('Invalid sibling task id');
        const t = await Task.findById(id).select(
            'workspace status order isArchived'
        );
        if (!t) throw new Error('Sibling task not found');
        assertSameWorkspace(t, workspaceId, 'Sibling task');
        if (t.isArchived) throw new Error('Sibling task is archived');
        const sameColumn =
            (statusId == null && t.status == null) ||
            (statusId != null &&
                t.status != null &&
                t.status.toString() === statusId.toString());
        if (!sameColumn) {
            throw new Error('Sibling task is in a different column');
        }
        return t;
    };

    const before = await lookup(beforeId);
    const after = await lookup(afterId);

    if (before && after) {
        if (before.order >= after.order) {
            throw new Error(
                'Sibling order is inconsistent — the board may be stale, please refresh'
            );
        }
        const next = (before.order + after.order) / 2;
        const collapsed =
            Math.abs(next - before.order) < MIN_ORDER_GAP ||
            Math.abs(after.order - next) < MIN_ORDER_GAP;
        if (collapsed) {
            // Rebalance and recompute against the rebalanced siblings.
            await rebalanceColumn(workspaceId, statusId);
            return computeMoveOrder(workspaceId, statusId, beforeId, afterId);
        }
        return next;
    }
    if (before) return before.order + ORDER_STEP;
    if (after) return after.order - ORDER_STEP;
    return computeAppendOrder(workspaceId, statusId);
};

// The denormalised `assignees` array on Task is purely for fast filter
// queries ("tasks assigned to me"). Source of truth is TaskAssignment.
// Resync whenever the underlying assignment rows change.
const syncAssignees = async (taskId) => {
    const rows = await TaskAssignment.find({ task: taskId }).select('user');
    const unique = Array.from(new Set(rows.map((r) => r.user.toString())));
    await Task.updateOne({ _id: taskId }, { $set: { assignees: unique } });
};

const TASK_DIFF_FIELDS = [
    'title',
    'description',
    'status',
    'priority',
    'parentTask',
    'dueDate',
    'startDate',
    'completedAt',
    'order',
    'isArchived',
];

const pickTaskFields = (t) =>
    TASK_DIFF_FIELDS.reduce((acc, k) => {
        acc[k] = t[k];
        return acc;
    }, {});

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

export const createTask = async (workspace, payload, actorId) => {
    const {
        title,
        description,
        status,
        priority,
        parentTask,
        dueDate,
        startDate,
        assignees: initialAssignees,
    } = normaliseTaskPayload(payload);

    if (typeof title !== 'string' || !title.trim()) {
        throw new Error('Task title is required');
    }

    await validateStatus(workspace._id, status);
    await validatePriority(priority);
    await validateParent(workspace._id, parentTask, null);

    if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) {
        throw new Error('startDate cannot be after dueDate');
    }

    // Validate every initial assignee BEFORE any DB writes so we never
    // create a task with half its assignments.
    const initials = Array.isArray(initialAssignees) ? initialAssignees : [];
    const resolvedAssignees = [];
    for (const entry of initials) {
        if (!entry) continue;
        let userId;
        let role = 'ASSIGNEE';
        if (typeof entry === 'string' || entry instanceof mongoose.Types.ObjectId) {
            userId = entry;
        } else if (typeof entry === 'object') {
            userId = entry.userId || entry.user;
            role = (entry.role || 'ASSIGNEE').toString().toUpperCase();
        }
        if (!userId) throw new Error('Each assignee entry must include userId');
        if (!ASSIGNMENT_ROLES.includes(role)) {
            throw new Error(
                `Invalid assignment role: ${role}. Allowed: ${ASSIGNMENT_ROLES.join(', ')}`
            );
        }
        // eslint-disable-next-line no-await-in-loop
        await requireActiveWorkspaceMember(workspace._id, userId);
        resolvedAssignees.push({ userId, role });
    }

    const orderValue = await computeAppendOrder(workspace._id, status || null);

    const task = await Task.create({
        title: title.trim(),
        description:
            typeof description === 'string' ? description.trim() : undefined,
        workspace: workspace._id,
        createdBy: actorId,
        status: status || undefined,
        priority: priority || undefined,
        parentTask: parentTask || null,
        dueDate: dueDate || undefined,
        startDate: startDate || undefined,
        order: orderValue,
    });

    // Best-effort assignment writes — same pattern as workspace initial
    // members. A failure here doesn't tear down the task; surfaced to
    // the caller via `assignmentFailures`.
    const assignmentFailures = [];
    for (const { userId, role } of resolvedAssignees) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await TaskAssignment.create({
                task: task._id,
                user: userId,
                role,
            });
        } catch (err) {
            assignmentFailures.push({
                userId: String(userId),
                role,
                error: err.message,
            });
        }
    }
    if (resolvedAssignees.length) await syncAssignees(task._id);

    await logActivity({
        entityType: 'Task',
        entityId: task._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'created',
        performedBy: actorId,
        metadata: {
            title: task.title,
            status: task.status,
            priority: task.priority,
            parentTask: task.parentTask,
            initialAssigneeCount: resolvedAssignees.length,
            assignmentFailures,
        },
    });

    const fresh = await Task.findById(task._id);
    return { task: fresh, assignmentFailures };
};

// Flat list with rich filtering. Used for "All tasks", "My tasks", and
// nested-list views. Defaults excludes archived tasks unless the caller
// opts in with `includeArchived: true`.
export const listTasks = async (workspace, filters = {}) => {
    const safeLimit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const safePage = Math.max(Number(filters.page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const query = { workspace: workspace._id };
    if (filters.includeArchived !== true) {
        query.isArchived = false;
    }

    if (filters.status === 'null' || filters.status === null) {
        query.status = null;
    } else if (filters.status) {
        query.status = filters.status;
    }
    if (filters.priority) query.priority = filters.priority;
    if (filters.assignee) query.assignees = filters.assignee;
    if (filters.createdBy) query.createdBy = filters.createdBy;
    if (filters.parentTask === 'null' || filters.parentTask === null) {
        query.parentTask = null;
    } else if (filters.parentTask) {
        query.parentTask = filters.parentTask;
    }
    if (filters.search && typeof filters.search === 'string') {
        // Anchored, case-insensitive substring on title. Note: this is
        // an unindexed scan; if title search becomes hot, switch to a
        // text index on title+description. We cap the length so a
        // malicious query string can't blow up regex compile time.
        const safe = filters.search
            .slice(0, 80)
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.title = { $regex: safe, $options: 'i' };
    }
    if (filters.dueBefore) {
        query.dueDate = {
            ...(query.dueDate || {}),
            $lte: new Date(filters.dueBefore),
        };
    }
    if (filters.dueAfter) {
        query.dueDate = {
            ...(query.dueDate || {}),
            $gte: new Date(filters.dueAfter),
        };
    }

    const allowedSorts = ['order', 'createdAt', 'updatedAt', 'dueDate', 'title'];
    const sortField = allowedSorts.includes(filters.sort) ? filters.sort : 'order';
    const sortDir = filters.sortDir === 'desc' ? -1 : 1;

    const [items, total] = await Promise.all([
        Task.find(query)
            .sort({ [sortField]: sortDir, _id: 1 })
            .skip(skip)
            .limit(safeLimit)
            .populate('createdBy', 'name email')
            .populate('assignees', 'name email')
            .populate('status', 'name color')
            .populate('priority', 'name level'),
        Task.countDocuments(query),
    ]);

    return { items, page: safePage, limit: safeLimit, total };
};

// Board view: every status of the workspace becomes a column. Tasks
// are bucketed by their `status` and ordered by `order` ASC. By
// default only top-level tasks are returned (subtasks are usually
// rendered inside the parent's detail panel, not on the main board).
export const getBoard = async (
    workspace,
    { includeArchived = false, rootOnly = true } = {}
) => {
    const statuses = await Status.find({ workspace: workspace._id }).sort({
        name: 1,
    });

    const taskFilter = { workspace: workspace._id };
    if (!includeArchived) taskFilter.isArchived = false;
    if (rootOnly) taskFilter.parentTask = null;

    const tasks = await Task.find(taskFilter)
        .sort({ order: 1, _id: 1 })
        .populate('assignees', 'name email')
        .populate('priority', 'name level')
        .lean();

    const buckets = new Map();
    // "No status" column comes first. We drop it later if it ends up empty.
    buckets.set('null', { status: null, tasks: [] });
    for (const s of statuses) {
        buckets.set(s._id.toString(), { status: s, tasks: [] });
    }
    for (const t of tasks) {
        const key = t.status ? t.status.toString() : 'null';
        const bucket = buckets.get(key) || buckets.get('null');
        bucket.tasks.push(t);
    }

    const columns = Array.from(buckets.values());
    if (columns[0].status === null && columns[0].tasks.length === 0) {
        columns.shift();
    }
    return columns;
};

export const getTaskById = async (workspace, taskId) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    })
        .populate('createdBy', 'name email')
        .populate('assignees', 'name email')
        .populate('status', 'name color')
        .populate('priority', 'name level')
        .populate('parentTask', 'title status');
    if (!task) throw new Error('Task not found');

    const [assignments, subtaskCount] = await Promise.all([
        TaskAssignment.find({ task: task._id })
            .populate('user', 'name email profilePic')
            .sort({ createdAt: 1 }),
        Task.countDocuments({ parentTask: task._id, isArchived: false }),
    ]);

    return { task, assignments, subtaskCount };
};

export const getSubtasks = async (
    workspace,
    parentTaskId,
    { includeArchived = false } = {}
) => {
    if (!isObjectId(parentTaskId)) throw new Error('Invalid task id');
    const parent = await Task.findOne({
        _id: parentTaskId,
        workspace: workspace._id,
    }).select('_id');
    if (!parent) throw new Error('Task not found');

    const filter = { parentTask: parent._id };
    if (!includeArchived) filter.isArchived = false;
    return Task.find(filter)
        .sort({ order: 1, _id: 1 })
        .populate('assignees', 'name email')
        .populate('status', 'name color')
        .populate('priority', 'name level');
};

export const updateTask = async (workspace, taskId, patch, actorId) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    });
    if (!task) throw new Error('Task not found');
    if (task.isArchived) {
        throw new Error('Task is archived. Restore it before editing.');
    }

    patch = normaliseTaskPayload(patch);
    const before = pickTaskFields(task.toObject());

    if (patch.title !== undefined) {
        if (typeof patch.title !== 'string' || !patch.title.trim()) {
            throw new Error('title must be a non-empty string');
        }
        task.title = patch.title.trim();
    }
    if (patch.description !== undefined) {
        task.description =
            typeof patch.description === 'string' ? patch.description : '';
    }

    if (patch.status !== undefined) {
        if (patch.status === null) {
            // Move to the "no status" column at the end.
            task.status = undefined;
            task.order = await computeAppendOrder(workspace._id, null);
        } else {
            await validateStatus(workspace._id, patch.status);
            const prevStatus = task.status ? task.status.toString() : null;
            const nextStatus = patch.status.toString();
            task.status = patch.status;
            // If the column changed, snap to end of new column. If the
            // caller wants a specific position they should use /move.
            if (prevStatus !== nextStatus) {
                task.order = await computeAppendOrder(
                    workspace._id,
                    patch.status
                );
            }
        }
    }

    if (patch.priority !== undefined) {
        if (patch.priority === null) {
            task.priority = undefined;
        } else {
            await validatePriority(patch.priority);
            task.priority = patch.priority;
        }
    }

    if (patch.parentTask !== undefined) {
        if (patch.parentTask === null) {
            task.parentTask = null;
        } else {
            await validateParent(workspace._id, patch.parentTask, task._id);
            task.parentTask = patch.parentTask;
        }
    }

    if (patch.dueDate !== undefined) {
        task.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;
    }
    if (patch.startDate !== undefined) {
        task.startDate = patch.startDate ? new Date(patch.startDate) : null;
    }
    if (task.startDate && task.dueDate && task.startDate > task.dueDate) {
        throw new Error('startDate cannot be after dueDate');
    }

    if (patch.completedAt !== undefined) {
        task.completedAt = patch.completedAt
            ? new Date(patch.completedAt)
            : null;
    }

    if (patch.order !== undefined) {
        if (typeof patch.order !== 'number' || Number.isNaN(patch.order)) {
            throw new Error('order must be a number');
        }
        task.order = patch.order;
    }

    await task.save();

    await logActivity({
        entityType: 'Task',
        entityId: task._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'updated',
        performedBy: actorId,
        metadata: {
            before,
            after: pickTaskFields(task.toObject()),
        },
    });

    return task;
};

// Drag-and-drop endpoint. Atomically updates `status` (column) and
// `order` (position within column), with optional re-parenting.
// Caller passes either `beforeId` and/or `afterId` (sibling task ids
// in the *target* column) — see computeMoveOrder for the maths.
export const moveTask = async (workspace, taskId, payload, actorId) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    });
    if (!task) throw new Error('Task not found');
    if (task.isArchived) throw new Error('Cannot move an archived task');

    payload = normaliseTaskPayload(payload);
    const before = pickTaskFields(task.toObject());

    let nextStatusId = task.status ? task.status.toString() : null;
    if (payload.status !== undefined) {
        if (payload.status === null) {
            nextStatusId = null;
        } else {
            await validateStatus(workspace._id, payload.status);
            nextStatusId = payload.status.toString();
        }
    }

    if (payload.parentTask !== undefined) {
        if (payload.parentTask === null) {
            task.parentTask = null;
        } else {
            await validateParent(workspace._id, payload.parentTask, task._id);
            task.parentTask = payload.parentTask;
        }
    }

    const beforeId = payload.beforeId || null;
    const afterId = payload.afterId || null;
    if (beforeId && beforeId.toString() === task._id.toString()) {
        throw new Error('beforeId cannot reference the task itself');
    }
    if (afterId && afterId.toString() === task._id.toString()) {
        throw new Error('afterId cannot reference the task itself');
    }

    const nextOrder = await computeMoveOrder(
        workspace._id,
        nextStatusId,
        beforeId,
        afterId
    );

    task.status = nextStatusId || undefined;
    task.order = nextOrder;
    await task.save();

    await logActivity({
        entityType: 'Task',
        entityId: task._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'moved',
        performedBy: actorId,
        metadata: {
            before,
            after: pickTaskFields(task.toObject()),
            beforeId,
            afterId,
        },
    });

    return task;
};

// Soft-delete. Cascades to every descendant — archiving a parent task
// without its subtasks would leave dangling rows in the UI.
//
// Restore is intentionally NOT cascading (see restoreTask) because it's
// dangerous: a parent might have been archived while half its subtasks
// were already archived for unrelated reasons.
export const archiveTask = async (workspace, taskId, actorId) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    });
    if (!task) throw new Error('Task not found');
    if (task.isArchived) throw new Error('Task is already archived');

    // BFS walk down the parentTask graph collecting still-active
    // descendants. The graph is acyclic by construction (validateParent
    // enforces that on every parent change), so this terminates.
    const archivedIds = [task._id];
    const queue = [task._id];
    while (queue.length) {
        const current = queue.shift();
        // eslint-disable-next-line no-await-in-loop
        const children = await Task.find({
            parentTask: current,
            isArchived: false,
        }).select('_id');
        for (const c of children) {
            archivedIds.push(c._id);
            queue.push(c._id);
        }
    }

    await Task.updateMany(
        { _id: { $in: archivedIds } },
        { $set: { isArchived: true } }
    );

    await logActivity({
        entityType: 'Task',
        entityId: task._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'archived',
        performedBy: actorId,
        metadata: {
            cascadedCount: archivedIds.length - 1,
            archivedIds: archivedIds.map(String),
        },
    });

    return { archivedIds };
};

export const restoreTask = async (workspace, taskId, actorId) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    });
    if (!task) throw new Error('Task not found');
    if (!task.isArchived) throw new Error('Task is not archived');

    // If the parent is still archived, reattach to the root list. We
    // can't restore "into" an archived parent — the result would be an
    // active task hidden behind an archived one in every UI view.
    if (task.parentTask) {
        const parent = await Task.findById(task.parentTask).select('isArchived');
        if (!parent || parent.isArchived) {
            task.parentTask = null;
        }
    }

    task.isArchived = false;
    await task.save();

    await logActivity({
        entityType: 'Task',
        entityId: task._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'restored',
        performedBy: actorId,
    });

    return task;
};

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export const listAssignments = async (workspace, taskId) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    }).select('_id');
    if (!task) throw new Error('Task not found');
    return TaskAssignment.find({ task: task._id })
        .populate('user', 'name email profilePic')
        .sort({ createdAt: 1 });
};

export const addAssignment = async (
    workspace,
    taskId,
    { userId, role = 'ASSIGNEE' },
    actorId
) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    if (!userId) throw new Error('userId is required');
    const upper = String(role).toUpperCase();
    if (!ASSIGNMENT_ROLES.includes(upper)) {
        throw new Error(
            `Invalid role: ${role}. Allowed: ${ASSIGNMENT_ROLES.join(', ')}`
        );
    }

    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    });
    if (!task) throw new Error('Task not found');
    if (task.isArchived) throw new Error('Cannot assign on an archived task');

    await requireActiveWorkspaceMember(workspace._id, userId);

    const assignment = await TaskAssignment.create({
        task: task._id,
        user: userId,
        role: upper,
    });

    await syncAssignees(task._id);

    await logActivity({
        entityType: 'TaskAssignment',
        entityId: assignment._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'created',
        performedBy: actorId,
        metadata: { taskId: task._id, userId, role: upper },
    });

    return assignment;
};

export const updateAssignmentRole = async (
    workspace,
    taskId,
    assignmentId,
    newRole,
    actorId
) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    if (!isObjectId(assignmentId)) throw new Error('Invalid assignment id');
    const upper = String(newRole || '').toUpperCase();
    if (!ASSIGNMENT_ROLES.includes(upper)) {
        throw new Error(
            `Invalid role: ${newRole}. Allowed: ${ASSIGNMENT_ROLES.join(', ')}`
        );
    }

    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    }).select('_id');
    if (!task) throw new Error('Task not found');

    const assignment = await TaskAssignment.findOne({
        _id: assignmentId,
        task: task._id,
    });
    if (!assignment) throw new Error('Assignment not found');
    if (assignment.role === upper) return assignment;

    // The unique compound index on TaskAssignment is (task, user, role).
    // If the same user already has another row with the target role we
    // would hit a duplicate-key error from Mongo. Pre-check so we can
    // surface a friendlier message.
    const collision = await TaskAssignment.findOne({
        task: task._id,
        user: assignment.user,
        role: upper,
        _id: { $ne: assignment._id },
    });
    if (collision) {
        throw new Error(
            `User already has an assignment with role ${upper} on this task`
        );
    }

    const previousRole = assignment.role;
    assignment.role = upper;
    await assignment.save();

    await logActivity({
        entityType: 'TaskAssignment',
        entityId: assignment._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'role_changed',
        performedBy: actorId,
        metadata: {
            taskId: task._id,
            userId: assignment.user,
            oldRole: previousRole,
            newRole: upper,
        },
    });

    return assignment;
};

export const removeAssignment = async (
    workspace,
    taskId,
    assignmentId,
    actorId
) => {
    if (!isObjectId(taskId)) throw new Error('Invalid task id');
    if (!isObjectId(assignmentId)) throw new Error('Invalid assignment id');
    const task = await Task.findOne({
        _id: taskId,
        workspace: workspace._id,
    }).select('_id');
    if (!task) throw new Error('Task not found');

    const assignment = await TaskAssignment.findOne({
        _id: assignmentId,
        task: task._id,
    });
    if (!assignment) throw new Error('Assignment not found');

    await TaskAssignment.deleteOne({ _id: assignment._id });
    await syncAssignees(task._id);

    await logActivity({
        entityType: 'TaskAssignment',
        entityId: assignment._id,
        organisation: workspace.organisation,
        workspace: workspace._id,
        action: 'deleted',
        performedBy: actorId,
        metadata: {
            taskId: task._id,
            userId: assignment.user,
            role: assignment.role,
        },
    });

    return true;
};
