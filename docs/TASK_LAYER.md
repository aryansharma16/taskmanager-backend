# Task Layer

Reference for the Task engine: models, RBAC, ordering / drag-and-drop
algorithm, subtasks, assignments, edge cases, and audit-log behaviour.

## 1. Conceptual model

```text
Workspace
└── Task
    ├── parentTask  → Task        (subtask hierarchy, acyclic)
    ├── status      → Status      (workspace-scoped lookup; defines a Kanban column)
    ├── priority    → Priority    (global lookup)
    ├── assignees   → [User]      (denormalised — fast "assigned to me")
    └── TaskAssignment            (User × Task × role: LEADER | ASSIGNEE | WATCHER)
```

- Tasks live under a workspace. The workspace boundary is enforced on
  every read and every reference (status, priority, parentTask,
  siblings during drag-and-drop).
- Subtasks are modelled with `Task.parentTask` (self-reference). Cycle
  detection runs on every parent change.
- A task has two layers of assignees:
  - **`Task.assignees: [ObjectId<User>]`** — denormalised set, indexed,
    used by all "tasks assigned to user X" queries.
  - **`TaskAssignment`** — the source of truth, with a `role` enum
    (`LEADER | ASSIGNEE | WATCHER`). Updated by the dedicated
    assignment endpoints; the `assignees` array is recomputed from it
    on every mutation.

## 2. Ordering & drag-and-drop

The `Task.order` field is a `Number` (double). Tasks within a single
"column" — same `(workspace, status)` — are sorted by `order` ASC. The
compound index `{ workspace: 1, status: 1, order: 1 }` covers the
board query in a single index scan.

### Append rule

A new task lands at the **end** of its column:

```text
order = (max(order in column) ?? 0) + 1000
```

`1000` (`ORDER_STEP`) is the gap between freshly-appended tasks. It is
generous on purpose: every fractional insert into that gap halves it,
so a 1000-step gap survives ~10 inserts at the same spot before
collapsing.

### Move rule (drag-and-drop)

`PATCH /api/workspaces/:id/tasks/:taskId/move` accepts:

```json
{
  "status":     "<statusId|null>",   // optional; defaults to current
  "parentTask": "<taskId|null>",     // optional re-parenting
  "beforeId":   "<sibling above>",   // task that should sit ABOVE the moved task
  "afterId":    "<sibling below>"    // task that should sit BELOW the moved task
}
```

Resolution of the new `order`:

| `beforeId`? | `afterId`? | Result                                  |
|-------------|------------|-----------------------------------------|
| yes         | yes        | `(before.order + after.order) / 2`      |
| yes         | no         | `before.order + 1000` (drop at bottom)  |
| no          | yes        | `after.order - 1000` (drop at top)      |
| no          | no         | append to end of (new) column           |

The siblings are validated to be in the *target* column (same `status`
as the move target) and not archived. If they aren't, the request fails
with `400` so the FE knows the board is stale and should refresh.

### Rebalance

When `Math.abs(next - before.order) < 1e-6` (or the same against
`after`), the column is rebalanced: every task in the column is rewritten
to a clean `1000, 2000, 3000…` sequence in a single `bulkWrite`. The
move is then recomputed against the rebalanced siblings. This is rare —
it takes a sustained sequence of inserts at the exact same spot before
fractional spacing collapses.

### Status changes via plain `PUT`

If the caller changes `status` via the regular update endpoint
(without `beforeId`/`afterId`), the task is appended to the end of the
new column. Use `/move` to drop it at a specific position.

## 3. Subtasks

- `parentTask` is a self-reference. `null` means "root task".
- Cycles are rejected: setting parent X on task T fails if T appears
  anywhere on X's parent chain. The walk is capped at 100 levels
  (`MAX_PARENT_DEPTH`) to guard against pathological data.
- A task **cannot** be its own parent.
- The proposed parent must belong to the same workspace and not be
  archived.
- Board view (`GET /tasks/board`) defaults to `rootOnly=true`; subtasks
  are surfaced via `GET /tasks/:id/subtasks` or as part of the parent's
  detail page (`GET /tasks/:id` returns `subtaskCount`).

## 4. Soft-delete & cascades

- Archive (`DELETE /tasks/:id`) sets `isArchived = true` on the task
  **and every descendant** found via BFS down `parentTask`. The cascade
  is necessary — orphaned subtasks under an archived parent would be
  invisible in every UI view.
- Restore (`PATCH /tasks/:id/restore`) is **not** cascading. Each task
  must be restored explicitly. Rationale: a parent might have been
  archived while half its subtasks were already archived for unrelated
  reasons; cascading restore would resurrect them silently.
- Restoring a task whose parent is still archived implicitly detaches
  it (`parentTask = null`), so it never ends up as an active leaf
  hidden behind an archived branch.
- Deleting in this layer is always soft. The activity log retains a
  reference to every archived task forever.

## 5. RBAC

The Task engine plugs into the existing **hybrid workspace RBAC**:

1. Org-level wildcard `*` or `manage:workspace` bypasses all task
   permission checks (org admins can manage any workspace's tasks
   without being a member).
2. Otherwise the requester must have an `ACTIVE` `WorkspaceMember`
   whose role grants the required permission.

### Permissions

| Permission       | Granted on                                                                        |
|------------------|-----------------------------------------------------------------------------------|
| `read:task`      | List tasks, get task, get subtasks, view board, list assignments, **list/get statuses**. |
| `create:task`    | Create a task.                                                                    |
| `update:task`    | Edit a task, move it (drag-and-drop), restore it.                                 |
| `delete:task`    | Archive (soft-delete) a task.                                                     |
| `assign:task`    | Add / change-role / remove a `TaskAssignment` row.                                |
| `manage:status`  | Create / edit / delete statuses (Kanban columns) on the workspace.                |

Existing tenants must add these strings to whichever workspace-scoped
roles should hold them via `PUT /api/roles/:id`. They are **not**
seeded automatically (workspace-scoped roles are tenant-defined).

The org `OWNER` role keeps the existing `manage:workspace` perm and
therefore needs no change to operate on tasks.

## 6. API surface

All endpoints live under `/api/workspaces/:id/tasks`.

| Method | Path                                                  | Permission     | What it does                                                                                                  |
|--------|-------------------------------------------------------|----------------|---------------------------------------------------------------------------------------------------------------|
| POST   | `/`                                                   | `create:task`  | Create a task (optionally with `parentTask`, initial assignees, status, priority, dates).                     |
| GET    | `/`                                                   | `read:task`    | Paginated flat list. Filters: `status`, `priority`, `assignee`, `createdBy`, `parentTask=null|<id>`, `search`, `dueBefore`, `dueAfter`, `includeArchived`. Sort: `order|createdAt|updatedAt|dueDate|title`, `sortDir=asc|desc`. |
| GET    | `/board`                                              | `read:task`    | Tasks bucketed by status, ordered by `order` ASC. `?rootOnly=false` to include subtasks. |
| GET    | `/:taskId`                                            | `read:task`    | Single task with assignments and `subtaskCount`. |
| PUT    | `/:taskId`                                            | `update:task`  | Update title, description, status, priority, parentTask, dates, completedAt, order. Status change without `/move` re-snaps to end of new column. |
| DELETE | `/:taskId`                                            | `delete:task`  | Archive (soft-delete). Cascades down subtasks. |
| PATCH  | `/:taskId/restore`                                    | `update:task`  | Un-archive. Non-cascading. May null-out `parentTask` if the parent is still archived. |
| PATCH  | `/:taskId/move`                                       | `update:task`  | Drag-and-drop. Body: `{ status?, parentTask?, beforeId?, afterId? }`. |
| GET    | `/:taskId/subtasks`                                   | `read:task`    | Direct children (one level), ordered by `order` ASC. |
| GET    | `/:taskId/assignments`                                | `read:task`    | List `TaskAssignment` rows with populated user. |
| POST   | `/:taskId/assignments`                                | `assign:task`  | Body: `{ userId, role? }` (default `ASSIGNEE`). User must be an active workspace member. |
| PUT    | `/:taskId/assignments/:assignmentId`                  | `assign:task`  | Body: `{ role }`. Roles: `LEADER | ASSIGNEE | WATCHER`. |
| DELETE | `/:taskId/assignments/:assignmentId`                  | `assign:task`  | Remove a single assignment row. |

### Status sub-API (Kanban columns)

A workspace must have **at least one** `Status` for the board to render
real columns. Statuses are workspace-scoped lookups, mounted alongside
tasks at `/api/workspaces/:id/statuses`. Routes use the same hybrid
RBAC. Reads piggy-back on `read:task` (anyone who can see the board
needs to see its columns); mutations require `manage:status`.

| Method | Path                                                  | Permission       | What it does |
|--------|-------------------------------------------------------|------------------|--------------|
| GET    | `/api/workspaces/:id/statuses`                        | `read:task`      | List statuses, sorted by `name`. `?withTaskCounts=true` enriches each row with active-task count. |
| POST   | `/api/workspaces/:id/statuses`                        | `manage:status`  | Create. Body: `{ name, color? }`. Name unique per workspace (case-insensitive). |
| GET    | `/api/workspaces/:id/statuses/:statusId`              | `read:task`      | Single status + active task count. |
| PUT    | `/api/workspaces/:id/statuses/:statusId`              | `manage:status`  | Rename / re-color. |
| DELETE | `/api/workspaces/:id/statuses/:statusId`              | `manage:status`  | Delete. Blocked if any active task uses it; pass `reassignTo` (a sibling status id, or `"null"` for the unassigned column) to migrate. |

The full request / response shapes, deletion-with-reassignment story,
and error catalogue live in `docs/API_REFERENCE.md` §5.9.

#### Why the status surface lives here

- **Board view depends on it.** `getBoard` renders one column per
  status; an empty status list collapses the board to either the
  "no status" bucket or nothing at all (matching the empty-state UI).
- **Cross-tenant safety.** Every Task field that points at a Status
  (`createTask`, `updateTask`, `moveTask`) calls `validateStatus`
  which already checks the workspace boundary. The Status routes use
  the same `requireWorkspaceContext` middleware so probes for
  `:statusId` from another tenant return `404 Status not found`.
- **Delete-time integrity.** Tasks reference Status by `ObjectId` with
  no FK; `deleteStatus` either blocks (default), bulk-reassigns to a
  sibling, or bulk-clears to `null`, in a single `updateMany`.
  Archived tasks are intentionally left alone (see §4 — restoring a
  task should not silently re-status it into a column the user never
  picked).

## 7. Activity log events

| `entityType`     | `action`        | When |
|------------------|-----------------|------|
| `Task`           | `created`       | `POST /tasks`. Metadata: `title`, `status`, `priority`, `parentTask`, `initialAssigneeCount`, `assignmentFailures`. |
| `Task`           | `updated`       | `PUT /tasks/:id`. Metadata: `before`/`after` for the diff fields (`title`, `description`, `status`, `priority`, `parentTask`, `dueDate`, `startDate`, `completedAt`, `order`, `isArchived`). |
| `Task`           | `moved`         | `PATCH /tasks/:id/move`. Metadata: `before`/`after`, plus `beforeId`/`afterId`. |
| `Task`           | `archived`      | `DELETE /tasks/:id`. Metadata: `cascadedCount`, `archivedIds`. |
| `Task`           | `restored`      | `PATCH /tasks/:id/restore`. |
| `TaskAssignment` | `created`       | Add assignment. Metadata: `taskId`, `userId`, `role`. |
| `TaskAssignment` | `role_changed`  | Update assignment role. Metadata: `taskId`, `userId`, `oldRole`, `newRole`. |
| `TaskAssignment` | `deleted`       | Remove assignment. Metadata: `taskId`, `userId`, `role`. |
| `Status`         | `created`       | `POST /statuses`. Metadata: `name`, `color`. |
| `Status`         | `updated`       | `PUT /statuses/:id`. Metadata: `before`/`after` (`name`, `color`). |
| `Status`         | `deleted`       | `DELETE /statuses/:id`. Metadata: `name`, `color`, `reassignedTaskCount`, `reassignedTo`. |

Logging failures are swallowed by `logActivity` and never roll back the
parent operation.

## 8. Edge cases & guarantees

| Case | Behaviour |
|------|-----------|
| `:taskId` not a valid ObjectId | `400 Invalid task id` (or `400 Invalid id format` from the error handler). |
| Task in a different workspace | `404 Task not found` (no cross-tenant probe). |
| Mutating an archived task (anything except restore) | `400 Task is archived...` / `400 Cannot move an archived task`. |
| `status` from a different workspace | `400 Status does not belong to this workspace`. |
| `parentTask` from a different workspace | `400 Parent task does not belong to this workspace`. |
| `parentTask` is the task itself | `400 A task cannot be its own parent`. |
| `parentTask` is a descendant of the task | `400 Cannot make a descendant the parent (would create a cycle)`. |
| Parent chain longer than 100 levels | `400 Parent chain exceeds maximum depth of 100`. |
| Drag-and-drop sibling in a different column | `400 Sibling task is in a different column`. |
| Drag-and-drop sibling order inverted (board stale) | `400 Sibling order is inconsistent — the board may be stale, please refresh`. |
| `beforeId` or `afterId` references the moving task itself | `400 beforeId/afterId cannot reference the task itself`. |
| `startDate > dueDate` | `400 startDate cannot be after dueDate`. |
| Initial assignee is not an active workspace member | Whole creation aborted *before* any DB writes — `400 User <id> is not an active member of this workspace`. |
| Same user assigned twice with the same role | Second insert hits the unique index → surfaced as `409 Duplicate value for task, user, role`. |
| Updating an assignment to a role the same user already has | `400 User already has an assignment with role <X> on this task`. |
| Archiving a task with active subtasks | Cascades — every active descendant is archived in one `updateMany`. |
| Restoring a task whose parent is still archived | Restored at root level (`parentTask = null`). |
| Concurrent drag-and-drop on the same task | Last write wins (no optimistic concurrency). Acceptable for a single-user-per-board UX; can be tightened later via `__v` checks. |
| Fractional `order` collapse | Column auto-rebalanced; the move is recomputed against the rebalanced siblings. |
| Pagination (list endpoint) | `?page` (min 1), `?limit` (default 50, max 200). |
| Title regex search | Anchored, case-insensitive, length-capped substring on `title`. Unindexed scan; if it gets hot, switch to a Mongo text index. |
| Listing tasks while `includeArchived !== true` | `isArchived: false` is forced into the query. |
| Org-bypass admin assigning themselves to a task | Still requires being an active `WorkspaceMember`. They can add themselves first via the workspace-members API. |

## 9. Future enhancements (non-blocking, intentionally out of scope)

- **`Status.isCompleted`** — boolean flag on the workspace-scoped
  Status model, enforced unique-per-workspace. `moveTask`/`updateTask`
  could then auto-set `Task.completedAt = now` when a task moves into
  a completed status, and clear it when it leaves. Today the FE has
  to send `completedAt` explicitly.
- **Bulk reorder** — `PATCH /tasks/reorder` taking an array of
  `{ taskId, status, order }` for clients that perform multi-card
  drags. Trivial to add on top of the current code.
- **Optimistic concurrency** — opt into Mongoose's `__v` (`versionKey`)
  on `Task` and reject moves with stale versions. Useful when many
  users share a board.
- **Recurring tasks / templates** — separate model that spawns Tasks
  on a schedule.
- **Task-level RBAC overrides** — e.g. "private to assignees". Today
  visibility is workspace-wide.
- **Tags / labels** — `Label` and `TaskLabel` models already exist;
  adding the routes is a small follow-up.
- **Comments / attachments** — same: models present, routes pending.
- **Real-time** — emit Socket.IO events from `logActivity` mutations
  so multiple clients sharing a board stay in sync without polling.
