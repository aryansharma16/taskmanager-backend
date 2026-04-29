# Backend API Reference (Frontend)

Quick reference for every HTTP endpoint. Pair this with the FE app to
wire up screens.

> **Base URL** (`{baseURL}` below): `http://localhost:5000`
> All paths start with `/api`. All requests/responses are JSON.
>
> Examples in this doc use the workspace id `69f0920eff6553f8b326fb92`.
> Replace it with whatever id the user is currently viewing.

---

## 1. How things bind

```text
Organisation                         (the tenant / company)
└── User           (via OrganisationMember + an org Role)
    └── Workspace  (project / team silo)
        ├── WorkspaceMember          (User × Workspace × workspace Role)
        ├── Status                   (Kanban column, e.g. "To Do")
        │   └── order: Number        (left-to-right position on the board)
        └── Task                     (the card)
            ├── status      → Status         (which column)
            ├── parentTask  → Task           (subtasks; null = root)
            ├── order: Number                (position inside its column)
            ├── assignees: [User]            (denormalised; for filters)
            └── TaskAssignment               (User × Task × role)
```

Mental model:

- A **User** logs in and picks an **Organisation** (tenant).
- Inside the org they see one or more **Workspaces** they belong to.
- A workspace defines its own **Statuses** (columns) — the board needs
  at least one before tasks have somewhere to land. Each status has an
  `order` that decides its left-to-right position on the board.
- A **Task** belongs to a workspace, sits in a Status (or "no status"),
  has an `order` for its vertical position inside that column, may
  have a `parentTask` (subtasks), and may have multiple
  **TaskAssignments** (LEADER / ASSIGNEE / WATCHER per user).
- Two independent drag-and-drop axes:
  - **Cards (tasks)** drag up/down inside a column or across columns →
    `PATCH /tasks/:taskId/move`.
  - **Columns (statuses)** drag left/right across the board →
    `PUT /statuses/reorder`.
  - See §5.10 for the full FE interaction guide.

---

## 2. Auth setup

1. `POST {baseURL}/api/auth/login` → returns a JWT.
2. Store the token, send it on every authenticated request:
   `Authorization: Bearer <token>`.
3. If the user belongs to **more than one org**, also send
   `x-org-id: <organisationId>` on every request.

```javascript
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  const orgId = localStorage.getItem('activeOrgId');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (orgId) config.headers['x-org-id'] = orgId;
  return config;
});
```

---

## 3. Response envelope

```json
// Success
{ "success": true, "data": <payload>, "message"?: "..." }

// Failure
{ "success": false, "error": "<human readable>", "details"?: <object> }
```

`details` is an optional structured payload some endpoints attach for
self-diagnosis. Drag-and-drop is the main user — see §5.10 A.2 for
the shape on `Sibling order is inconsistent` errors.

| Status | Meaning                          | What the FE does                  |
|--------|----------------------------------|------------------------------------|
| 200    | OK                               | Render result                      |
| 201    | Created                          | Render + success toast             |
| 400    | Bad request / validation         | Inline form error                  |
| 401    | Token missing / expired          | Redirect to `/login`               |
| 403    | Authenticated but not allowed    | "You don't have access" toast      |
| 404    | Not found / cross-tenant probe   | Redirect with toast                |
| 409    | Duplicate (slug / email / etc.)  | Inline error on offending field    |
| 5xx    | Server error                     | Generic toast + retry              |

---

## 4. Permissions cheat-sheet

Permissions are strings. The wildcard `*` overrides everything.

**Org-level** (granted on a user's org Role):
`*`, `read:org`, `update:org`, `delete:org`, `create:user`, `read:user`,
`update:user`, `delete:user`, `create:role`, `read:role`, `update:role`,
`delete:role`, `create:workspace`, `read:workspace`, `update:workspace`,
`delete:workspace`, `manage:workspace` (org bypass for workspace
endpoints), `manage:workspace_members`.

**Workspace-level** (granted on a user's workspace Role):
`read:workspace`, `update:workspace`, `delete:workspace`,
`manage:workspace_members`, `read:task`, `create:task`, `update:task`,
`delete:task`, `assign:task`, `manage:status`.

**Hybrid rule for any `/api/workspaces/:id/...` endpoint:**

```javascript
const can = (perm) => {
  const orgPerms = currentUser.org.role.permissions;
  if (orgPerms.includes('*') || orgPerms.includes('manage:workspace')) return true;
  return (workspaceMember?.role?.permissions || []).includes(perm);
};
```

---

## 5. Endpoints

> All examples use real ObjectId-shaped placeholders. Replace
> `69f0920eff6553f8b326fb92` (workspaceId), `aa11...` (taskId), etc.

### 5.1 Auth (public)

| Method | URL | What it does |
|---|---|---|
| POST | `{baseURL}/api/auth/register` | Bootstrap a brand-new tenant: creates an Organisation, the OWNER role, the first User, and the membership row. Returns the org + user. |
| POST | `{baseURL}/api/auth/login`    | Email + password → returns a JWT and the orgs the user belongs to. |

**Register body:**
```json
{
  "orgName":      "Acme Inc",
  "slug":         "acme",
  "userName":     "Alice Owner",
  "userEmail":    "alice@acme.com",
  "userPassword": "super-secret-123"
}
```

**Login body:**
```json
{ "email": "alice@acme.com", "password": "super-secret-123" }
```

**Login response (200):**
```json
{
  "success": true,
  "token": "<jwt>",
  "data": {
    "id":    "<userId>",
    "name":  "Alice Owner",
    "email": "alice@acme.com",
    "organisations": [
      { "organisationId": "<orgId>", "name": "Acme Inc", "slug": "acme", "role": "OWNER" }
    ]
  }
}
```

> If `organisations.length > 1`, force an org-picker step before the
> first authenticated call (it sets `x-org-id`).

---

### 5.2 Organisations

| Method | URL | Perm | What it does |
|---|---|---|---|
| POST   | `{baseURL}/api/organisations`           | `*`           | Create a new tenant (super-admin only; usually `register` is used instead). |
| GET    | `{baseURL}/api/organisations`           | `*`           | List every organisation in the system. |
| GET    | `{baseURL}/api/organisations/<orgId>`   | `read:org`    | Fetch a tenant. Non-super-admins can only read their own org. |
| PUT    | `{baseURL}/api/organisations/<orgId>`   | `update:org`  | Edit name/description/logo/website/industry/billingEmail/subscriptionPlan/metadata. |
| DELETE | `{baseURL}/api/organisations/<orgId>`   | `delete:org`  | Soft-suspend the org. |

---

### 5.3 Roles

A `Role` is a permission bundle. Scope is `ORGANISATION` (default) or
`WORKSPACE`. Workspace-scoped roles are picked when adding workspace
members or creating workspaces.

| Method | URL | Perm | What it does |
|---|---|---|---|
| POST   | `{baseURL}/api/roles`              | `create:role` | Create a custom role. |
| GET    | `{baseURL}/api/roles`              | `read:role`   | List roles. Filter with `?scope=ORGANISATION` or `?scope=WORKSPACE`. |
| GET    | `{baseURL}/api/roles/<roleId>`     | `read:role`   | Fetch one role. |
| PUT    | `{baseURL}/api/roles/<roleId>`     | `update:role` | Edit `permissions` / `description`. System / global roles are read-only. |
| DELETE | `{baseURL}/api/roles/<roleId>`     | `delete:role` | Delete a custom role. Rejected if any member still uses it. |

**Create body:**
```json
{
  "name":        "WORKSPACE_OWNER",
  "scope":       "WORKSPACE",
  "description": "Full control inside this workspace",
  "permissions": ["read:workspace", "update:workspace", "manage:workspace_members"]
}
```

**Update body:**
```json
{ "permissions": ["..."], "description": "..." }
```

---

### 5.4 Users (org members)

`<userId>` here accepts **either** the `OrganisationMember._id` or the
underlying `User._id`.

| Method | URL | Perm | What it does |
|---|---|---|---|
| POST   | `{baseURL}/api/users`                  | `create:user` | Add a user to the current org. Creates the User if email is new, else attaches the existing one. |
| GET    | `{baseURL}/api/users`                  | `read:user`   | List active org members. |
| GET    | `{baseURL}/api/users/<userId>`         | `read:user`   | Fetch one member. |
| PUT    | `{baseURL}/api/users/<userId>/role`    | `update:user` | Change member's org role. Body: `{ "roleId": "..." }`. |
| DELETE | `{baseURL}/api/users/<userId>`         | `delete:user` | Remove member from the org (User row is preserved). Self-removal is rejected. |

**Create body:**
```json
{
  "name":     "Bob Member",
  "email":    "bob@acme.com",
  "password": "another-secret-1",
  "roleId":   "<role _id>"
}
```

---

### 5.5 Workspaces

A workspace is a project/team silo inside an org. `<workspaceId>` is a
24-char ObjectId.

| Method | URL | Perm | What it does |
|---|---|---|---|
| POST   | `{baseURL}/api/workspaces`                                                 | org `create:workspace`  | Create a workspace. Creator is auto-added with their picked workspace role. |
| GET    | `{baseURL}/api/workspaces`                                                 | org `read:workspace`    | List workspaces. Non-bypass users see only ones they're an active member of. Query: `?page=1&limit=20&includeArchived=false`. |
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92`                        | ws `read:workspace`     | Fetch one workspace + member count. |
| PUT    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92`                        | ws `update:workspace`   | Update name / slug / description / metadata. |
| DELETE | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92`                        | ws `delete:workspace`   | Archive (soft-delete). |
| PATCH  | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/restore`                | ws `update:workspace`   | Un-archive. |

**Create body:**
```json
{
  "name":          "Engineering",
  "slug":          "engineering",
  "description":   "Core product team",
  "creatorRoleId": "<workspace-scoped role _id>",
  "initialMembers": [
    { "userId": "<userId>", "roleId": "<workspace-scoped role _id>" }
  ]
}
```

**Get-by-id response:**
```json
{ "workspace": { "_id": "...", "name": "Engineering", "isActive": true, "..." : "..." }, "memberCount": 7 }
```

---

### 5.6 Workspace members

`<memberId>` accepts either the `WorkspaceMember._id` (preferred) or
the underlying `User._id`.

| Method | URL | Perm | What it does |
|---|---|---|---|
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/members`                          | ws `read:workspace`           | Paginated members list. Query: `?status=ACTIVE|SUSPENDED|INVITED&page&limit`. |
| POST   | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/members`                          | ws `manage:workspace_members` | Add a member. |
| PUT    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/members/<memberId>`               | ws `manage:workspace_members` | Change member's role. |
| DELETE | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/members/<memberId>`               | ws `manage:workspace_members` | Remove the membership row. |

**Add / change-role bodies:**
```json
{ "userId": "<orgUserId>", "roleId": "<workspace-scoped role _id>" }
```
```json
{ "roleId": "<workspace-scoped role _id>" }
```

---

### 5.7 Statuses (Kanban columns)

A workspace **must have at least one Status** before its board renders
real columns. If the FE shows "A board needs at least one status…",
that's the empty-list state of `GET /statuses`.

Each status carries an integer `order` field. Lower numbers render
first (left → right on a Kanban board, top → bottom in a list view),
so `order` is the source of truth for the **stage pipeline** — e.g.
`To Do` (0) → `In Progress` (1) → `Done` (2). `order` is **not**
required to be contiguous or unique; the backend only uses it as a
sort key and falls back to `name` ASC for ties.

| Method | URL | Perm | What it does |
|---|---|---|---|
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/statuses`                              | `read:task`     | List statuses, sorted by `order` ASC then `name` ASC. Add `?withTaskCounts=true` to get a `taskCount` per status (active tasks only). |
| POST   | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/statuses`                              | `manage:status` | Create a status. New statuses are appended to the end of the pipeline (`order = max + 1`) unless an explicit `order` is sent. |
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/statuses/<statusId>`                   | `read:task`     | Fetch one status + active task count. |
| PUT    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/statuses/<statusId>`                   | `manage:status` | Rename / re-color / nudge order. |
| PUT    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/statuses/reorder`                      | `manage:status` | **Bulk reorder** the whole pipeline (column drag-and-drop). |
| DELETE | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/statuses/<statusId>?reassignTo=<id>`   | `manage:status` | Delete. Blocked while any active task uses it; pass `reassignTo` to migrate. |

**Create / update body:**
```json
{ "name": "In Progress", "color": "#f59e0b", "order": 1 }
```
- `name` required, max 60 chars, **unique per workspace** (case-insensitive).
- `color` optional hex (`#RGB` or `#RRGGBB`); defaults to `#cccccc`.
- `order` optional non-negative integer. Omit it on create to append
  to the end of the pipeline. On update, this is a "nudge" — it does
  **not** renumber siblings. For drag-and-drop use `/reorder` instead.

**List response (with `?withTaskCounts=true`):**
```json
[
  { "_id": "s1", "name": "To Do",       "color": "#94a3b8", "order": 0, "workspace": "...", "taskCount": 5 },
  { "_id": "s2", "name": "In Progress", "color": "#f59e0b", "order": 1, "workspace": "...", "taskCount": 2 },
  { "_id": "s3", "name": "Done",        "color": "#10b981", "order": 2, "workspace": "...", "taskCount": 12 }
]
```

**Get-by-id response:**
```json
{ "status": { "_id": "s1", "name": "To Do", "color": "#94a3b8", "order": 0, "workspace": "..." }, "taskCount": 5 }
```

**Reorder body** (`PUT /statuses/reorder`):
```json
{ "orderedIds": ["s3", "s1", "s2"] }
```
- Position in the array becomes the new `order` (`s3` → `0`, `s1` →
  `1`, `s2` → `2`).
- The array **must reference every status in the workspace exactly
  once** — duplicates, missing ids, or ids from another workspace all
  return `400`.
- Returns the freshly-sorted full list, so the FE can replace its
  column model in one go without an extra `GET /statuses` round trip:

```json
{
  "success": true,
  "data": [
    { "_id": "s3", "name": "Done",        "order": 0, "..." : "..." },
    { "_id": "s1", "name": "To Do",       "order": 1, "..." : "..." },
    { "_id": "s2", "name": "In Progress", "order": 2, "..." : "..." }
  ]
}
```

**Delete with reassignment**

If `taskCount > 0` you must tell the API where the existing tasks should go:

- `?reassignTo=<otherStatusId>` — move all active tasks to that status, then delete.
- `?reassignTo=null` — clear the status on those tasks (they fall into the "no status" column), then delete.
- Omit it → backend returns `400` with the count.

```http
DELETE {baseURL}/api/workspaces/69f0920eff6553f8b326fb92/statuses/s1?reassignTo=s2
```

Response:
```json
{ "success": true, "data": { "reassignedTaskCount": 5 }, "message": "Status deleted" }
```

---

### 5.8 Tasks

Tasks live under a workspace. The board view returns one bucket per
status; tasks without a status fall into a leading "no status" bucket
(skipped if empty).

| Method | URL | Perm | What it does |
|---|---|---|---|
| POST   | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks`                                  | `create:task` | Create a task. |
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks`                                  | `read:task`   | Paginated flat list with filters (see below). |
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/board`                            | `read:task`   | **Kanban view**: tasks bucketed by status, ordered by `order`. |
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>`                         | `read:task`   | One task + assignments + `subtaskCount`. |
| PUT    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>`                         | `update:task` | Edit fields. Changing `status` here re-snaps the task to the bottom of the new column (use `/move` for a specific position). |
| DELETE | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>`                         | `delete:task` | Archive (soft-delete). Cascades down all subtasks. |
| PATCH  | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>/restore`                 | `update:task` | Un-archive (single task; not cascading). |
| PATCH  | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>/move`                    | `update:task` | **Drag-and-drop**: pick new column / position. |
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>/subtasks`                | `read:task`   | Direct children (one level), ordered. |

**Create body:**
```json
{
  "title":        "Wire up auth screen",
  "description":  "Markdown supported.",
  "statusId":     "<statusId|null>",
  "priorityId":   "<priorityId|null>",
  "parentTaskId": "<taskId|null>",
  "dueDate":      "2026-05-01T00:00:00Z",
  "startDate":    "2026-04-29T00:00:00Z",
  "assignees": [
    "<userId>",
    { "userId": "<userId>", "role": "LEADER" }
  ]
}
```
- Only `title` is required. `assignees` accepts bare user ids (default
  role `ASSIGNEE`) or `{ userId, role }`. All assignees must be active
  workspace members.
- `statusId` / `priorityId` / `parentTaskId` are also accepted as
  `status` / `priority` / `parentTask` (legacy alias). Pick whichever
  you prefer — both forms hit the same validator. **`status` without
  the `Id` suffix used to be silently ignored when the wrong key was
  sent; that's no longer the case.**

**Create response (201):**
```json
{
  "task": { "_id": "...", "title": "...", "order": 1000, "isArchived": false, "..." : "..." },
  "assignmentFailures": []
}
```

**List query string:**
```
?page=1&limit=50
&includeArchived=false
&statusId=<statusId>       (or statusId=null for tasks with no status)
&priorityId=<priorityId>
&assigneeId=<userId>
&createdById=<userId>
&parentTaskId=<taskId>     (or parentTaskId=null for root-level only)
&search=<title-substring>  (case-insensitive, max 80 chars)
&dueBefore=<ISODate>&dueAfter=<ISODate>
&sort=order|createdAt|updatedAt|dueDate|title
&sortDir=asc|desc
```
Bare-name query keys (`status`, `priority`, `assignee`, `createdBy`,
`parentTask`) are also accepted for backwards compat.

**List response:**
```json
{ "items": [<task>, ...], "page": 1, "limit": 50, "total": 12 }
```

**Board response** (`GET /tasks/board`):
```json
[
  { "status": { "_id": "s1", "name": "To Do",       "color": "#94a3b8" }, "tasks": [<task>, ...] },
  { "status": { "_id": "s2", "name": "In Progress", "color": "#f59e0b" }, "tasks": [<task>, ...] },
  { "status": { "_id": "s3", "name": "Done",        "color": "#10b981" }, "tasks": [<task>, ...] }
]
```
A `null`-status bucket appears at the front only if some tasks have no
status. Query: `?rootOnly=false` to include subtasks, `?includeArchived=true`
to show archived rows.

**Get-by-id response:**
```json
{
  "task": { "_id": "...", "title": "...", "..." : "..." },
  "assignments": [
    { "_id": "...", "user": { "_id": "...", "name": "...", "email": "..." }, "role": "ASSIGNEE" }
  ],
  "subtaskCount": 3
}
```

**Update body** (any subset):
```json
{
  "title":        "...",
  "description":  "...",
  "statusId":     "<statusId|null>",
  "priorityId":   "<priorityId|null>",
  "parentTaskId": "<taskId|null>",
  "dueDate":      "<ISODate|null>",
  "startDate":    "<ISODate|null>",
  "completedAt":  "<ISODate|null>",
  "order":        1500
}
```

**Move body** (drag-and-drop). Pick **one** of three drop-targeting
styles — see §5.10 for which one to use when:

```json
// Style 1 (RECOMMENDED) — 0-based index of the slot in the target column
{
  "statusId":     "<statusId|null>",
  "parentTaskId": "<taskId|null>",
  "position":     2
}
```

```json
// Style 2 — explicit neighbour ids (clearer naming)
{
  "statusId":   "<statusId|null>",
  "prevTaskId": "<task that should sit ABOVE the dropped task>",
  "nextTaskId": "<task that should sit BELOW the dropped task>"
}
```

```json
// Style 3 — same as style 2, legacy names
{
  "statusId": "<statusId|null>",
  "beforeId": "<task that should sit ABOVE the dropped task>",
  "afterId":  "<task that should sit BELOW the dropped task>"
}
```

> Both `statusId` and `status`, `priorityId` and `priority`,
> `parentTaskId` and `parentTask` are accepted on every task body
> (create / update / move). The `Id`-suffixed names are the recommended
> form because they read better when the value is an ObjectId; the bare
> names are kept for backwards compat.
>
> **Style mixing:** `position` cannot be sent together with
> `prevTaskId` / `nextTaskId` / `beforeId` / `afterId` — pick one or
> the other. `prevTaskId` and `beforeId` are interchangeable (same
> for `nextTaskId` / `afterId`); sending both with conflicting values
> is a `400`.

How `order` is computed for styles 2 & 3:

| `prevTaskId` (`beforeId`) | `nextTaskId` (`afterId`) | New `order` |
|---|---|---|
| yes | yes | `(prev.order + next.order) / 2` |
| yes | no  | `prev.order + 1000` (drop at bottom) |
| no  | yes | `next.order  - 1000` (drop at top)    |
| no  | no  | append: `max(order in target column) + 1000` |

For style 1 (`position`): the backend lists every other task in the
target column (excluding the dragged one), sorts by `order`, and
inserts the dragged task into slot `position` — averaging the two
neighbours' orders, or extending the sequence if `position` falls at
the start / end.

If the column gets too dense the backend rebalances it to a clean
1000-step sequence and recomputes — transparent to the FE.

**Common bug → "200 OK but the card didn't move".** If your move
request resolves to the task's *current* slot (same status + same
order), the API now returns `400 Move did not change the task
position…` instead of silently 200-ing. The fix is almost always one
of:

- `prevTaskId` / `nextTaskId` (or `beforeId` / `afterId`) **swapped**.
  `prev` is the task that ends up ABOVE the dropped one; `next` is
  the one that ends up BELOW.
- A stale neighbour id from the source column after a cross-column
  drop.
- Nothing actually changed (user dropped the card back where it
  came from). Detect this in the FE *before* firing the request.

When in doubt, switch to `position` — it sidesteps all three.

---

### 5.9 Task assignments

A `TaskAssignment` is the source of truth for who's on a task and in
what role. The denormalised `Task.assignees: [User]` array is rebuilt
automatically on every assignment mutation, so the
`?assignee=<userId>` filter on `GET /tasks` always stays accurate.

| Method | URL | Perm | What it does |
|---|---|---|---|
| GET    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>/assignments`                          | `read:task`   | List assignments with populated user. |
| POST   | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>/assignments`                          | `assign:task` | Add an assignment. |
| PUT    | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>/assignments/<assignmentId>`           | `assign:task` | Change role. |
| DELETE | `{baseURL}/api/workspaces/69f0920eff6553f8b326fb92/tasks/<taskId>/assignments/<assignmentId>`           | `assign:task` | Remove the row. |

**Add body:**
```json
{ "userId": "<userId>", "role": "LEADER" }
```
- `role` is `LEADER | ASSIGNEE | WATCHER`. Defaults to `ASSIGNEE`.
- `userId` must be an active workspace member.

**Change-role body:**
```json
{ "role": "ASSIGNEE" }
```

**Assignment document:**
```json
{
  "_id":  "...",
  "task": "<taskId>",
  "user": { "_id": "...", "name": "...", "email": "...", "profilePic": "..." },
  "role": "LEADER|ASSIGNEE|WATCHER",
  "createdAt": "...", "updatedAt": "..."
}
```

---

### 5.10 Drag-and-drop interaction guide (FE)

The board has **two independent drag axes**. They use different
endpoints, different bodies, and different optimistic-update
strategies. Here's the contract end-to-end.

#### A. Dragging a task card (vertical or across columns)

Endpoint:

```http
PATCH {baseURL}/api/workspaces/<wsId>/tasks/<taskId>/move
```

You can pick **one** of three styles for telling the backend where the
card landed. Style A.1 is the simplest and is what most drag libraries
hand you out of the box; reach for it first.

##### A.1 By position index (recommended)

```json
{
  "statusId": "<targetColumnId|null>",  // omit when same column
  "position": 2                          // 0-based slot in the target column
}
```

`position` is the **0-based index** of the slot the card should occupy
in the target column **after** the move (the dragged card itself is
excluded from the count). `0` = top, `1` = second from top, etc. Any
number ≥ length-of-column appends to the bottom.

Why prefer this over A.2 / A.3:

- React-beautiful-dnd, @dnd-kit, dragula, and friends all give you a
  `destination.index` directly — no neighbour hunting on the FE.
- Cross-column drops "just work": `position` is computed against the
  target column, not the source one.
- It's impossible to accidentally swap "above" and "below".

```javascript
async function onTaskDragEnd({ task, destination }) {
  const previous = boardState;
  setBoardState(applyDragLocal(boardState, task.id, destination));

  try {
    const { data } = await api.patch(
      `/api/workspaces/${wsId}/tasks/${task.id}/move`,
      {
        statusId: destination.columnId,   // omit if same column
        position: destination.index,
      },
    );
    setBoardState((s) => replaceTask(s, data));
  } catch (err) {
    setBoardState(previous);
    const msg = err.response?.data?.error ?? 'Could not move task';
    if (msg.includes('inconsistent') || msg.includes('did not change')) {
      await reloadBoard();
    } else {
      toast.error(msg);
    }
  }
}
```

##### A.2 By neighbour ids (`prevTaskId` / `nextTaskId`)

Use this when your drag library reports neighbour cards instead of an
index, or when the FE wants to be explicit:

```json
{
  "statusId":   "<targetColumnId|null>",
  "prevTaskId": "<sibling that ends up immediately ABOVE>",
  "nextTaskId": "<sibling that ends up immediately BELOW>"
}
```

Pick the right combination:

| Drop location in target column | Send |
|---|---|
| Top of column | only `nextTaskId` |
| Bottom of column | only `prevTaskId` |
| Between two cards | both |
| Empty column | neither (the card is appended) |

> **The most common bug here is swapping the two ids.** If you drag a
> card UP, the card it lands above is the `nextTaskId` (it's now BELOW
> the dropped one), **not** the `prevTaskId`. Getting this wrong used
> to silently 200 with `order` unchanged; the API now returns
> `400 Move did not change the task position…` so the bug surfaces
> immediately. If you keep tripping over this, switch to A.1.

> **The board must render columns sorted by `order` ASC** for
> `prevTaskId` / `nextTaskId` to mean what you think. If the FE
> sorts by title / `createdAt` / drag-and-drop temp state instead,
> the visible "above/below" no longer matches the DB neighbours,
> and the ids you pick will be flipped relative to actual `order`.
> Symptom: you get `400 Sibling order is inconsistent — …` even
> though the request looks right.

When the request would land "between" two cards but the prev/next
pair isn't in `order` ASC, the API responds:

```json
{
  "success": false,
  "error": "Sibling order is inconsistent — `prevTaskId` (<id>, order 3000) must have a smaller `order` than `nextTaskId` (<id>, order 2000), but the opposite is true. Most likely the FE swapped the two ids, or the board is rendering tasks in a different sort than `order` ASC. Refresh the board, or switch to `position` (0-based index) instead of neighbour ids — see API_REFERENCE §5.10.",
  "details": {
    "prevTaskId": "<id>",
    "prevOrder": 3000,
    "nextTaskId": "<id>",
    "nextOrder": 2000
  }
}
```

The numbers in `details` tell you exactly which side is "wrong" —
read them in dev tools and you can usually point at the bug in a
few seconds (e.g. `prevOrder > nextOrder` ⇒ ids are flipped).

##### A.3 By neighbour ids (`beforeId` / `afterId`, legacy)

Identical to A.2 with older field names. `beforeId` ≡ `prevTaskId`,
`afterId` ≡ `nextTaskId`. Kept for backwards compat — new code should
prefer A.1 or A.2.

##### Common rules (all three styles)

- `statusId` is **required only when the column changed**. Omit it
  (or send `null` for the no-status bucket) when dragging within the
  same column.
- The neighbour ids **must already be in the target column** — if
  you send a stale id from the source column, the backend returns
  `400 Sibling task is in a different column`.
- Never reference the dragged task itself in
  `prevTaskId`/`beforeId`/`nextTaskId`/`afterId` — rejected with `400`.
- Don't mix `position` with neighbour ids in the same request — `400`.
- `parentTaskId` is only used when the FE supports re-parenting via
  drag (e.g. dropping into a subtask zone); leave it out otherwise.

How `order` is computed for A.2 / A.3:

| `prevTaskId` (`beforeId`) | `nextTaskId` (`afterId`) | New `order` |
|---|---|---|
| yes | yes | `(prev.order + next.order) / 2` |
| yes | no  | `prev.order + 1000` (drop at bottom) |
| no  | yes | `next.order  - 1000` (drop at top)    |
| no  | no  | append: `max(order in target column) + 1000` |

If the column gets too dense the backend rebalances it to a clean
1000-step sequence and recomputes — transparent to the FE.

Response (200) — same shape regardless of which style you sent:

```json
{
  "success": true,
  "data": {
    "_id": "<taskId>",
    "title": "...",
    "status": "<targetColumnId>",
    "order": 1500,
    "..." : "..."
  }
}
```

#### B. Dragging a status column (horizontal pipeline reorder)

Endpoint:

```http
PUT {baseURL}/api/workspaces/<wsId>/statuses/reorder
```

Body — the **full** new column order, every status id exactly once,
in the order you want them rendered:

```json
{ "orderedIds": ["<statusId>", "<statusId>", "<statusId>"] }
```

Why "every id exactly once"?

- The endpoint atomically rewrites every column's `order` to its array
  index (`0..n-1`). Sending a partial list would silently leave
  un-touched columns at their old `order`, which would mix old and
  new positions on the next render. The backend rejects partial input
  with `400 orderedIds must reference every status in the workspace
  exactly once`.

Recommended FE flow (optimistic):

```javascript
async function onStatusDragEnd(newColumns) {
  const previous = columns;

  // 1. Optimistic: render the new column order immediately.
  setColumns(newColumns);

  try {
    const { data } = await api.put(
      `/api/workspaces/${wsId}/statuses/reorder`,
      { orderedIds: newColumns.map((c) => c._id) },
    );
    // 2. Replace with the server-canonical list (which now carries
    //    the freshly-assigned `order: 0..n-1` values).
    setColumns(data);
  } catch (err) {
    setColumns(previous);
    toast.error(err.response?.data?.error ?? 'Could not reorder columns');
  }
}
```

Response (200) — the freshly-sorted list, ready to bind to your
column model without a follow-up `GET`:

```json
{
  "success": true,
  "data": [
    { "_id": "s3", "name": "Done",        "order": 0, "..." : "..." },
    { "_id": "s1", "name": "To Do",       "order": 1, "..." : "..." },
    { "_id": "s2", "name": "In Progress", "order": 2, "..." : "..." }
  ]
}
```

#### C. Permissions to gate the UI

| Action | Required perm | Hide / disable when missing |
|---|---|---|
| Drag a task card | `update:task` | Lock cards (e.g. `pointer-events: none`) and skip the drag-handle. |
| Drag a status column | `manage:status` | Hide the column drag handle; the "+ Add status", rename, color, and delete affordances should hide too. |
| Create a task in a column | `create:task` | Hide the "+ Add a task" footer in each column. |
| Add an assignee | `assign:task` | Hide the "+ assignee" button on the task detail panel. |

Use the `can(perm)` helper from §4 — it already folds the org-level
`*` and `manage:workspace` bypasses in.

#### D. Recommended initial board load

Two parallel calls, then render:

```javascript
const [statusesRes, boardRes] = await Promise.all([
  api.get(`/api/workspaces/${wsId}/statuses?withTaskCounts=true`),
  api.get(`/api/workspaces/${wsId}/tasks/board`),
]);
const columns = statusesRes.data.data;            // ← already sorted by `order`
const board   = boardRes.data.data;               // ← columns also in `order` ASC
```

Both endpoints return columns in the same `order` ASC sequence, so
you can zip / merge them by `_id` without re-sorting on the FE.

#### E. Empty / edge states

- **Empty board:** if `GET /statuses` returns `[]`, render the
  "Configure statuses" CTA. There's no "no status" column until a
  task without a status exists.
- **Status deleted while user was dragging it:** the next mutation
  returns `404 Status not found` — refetch and re-render.
- **Workspace archived mid-session:** every status / task mutation
  returns `400 Workspace is archived. Restore it before performing
  this action.` — surface a single banner, not per-action toasts.

---

## 6. Common error messages

| Where | Status | Message |
|---|---|---|
| Anywhere | 400 | `Invalid id format: <value>` (bad ObjectId in URL) |
| Anywhere | 404 | `<Resource> not found` (also returned for cross-tenant probes) |
| Workspace | 400 | `Workspace is archived. Restore it before performing this action.` |
| Status | 400 | `A status with this name already exists in this workspace` |
| Status | 400 | `Cannot delete status: N active task(s) still use it. Pass reassignTo to migrate them.` |
| Status | 400 | `order must be a non-negative integer` (create / update / single-status nudge) |
| Status | 400 | `orderedIds must be a non-empty array` (reorder) |
| Status | 400 | `orderedIds contains duplicates` (reorder) |
| Status | 400 | `orderedIds must reference every status in the workspace exactly once` (reorder; missing or extra ids) |
| Status | 400 | `Status <id> does not belong to this workspace` (reorder) |
| Task | 400 | `Status does not belong to this workspace` |
| Task | 400 | `A task cannot be its own parent` / `would create a cycle` |
| Task | 400 | `Sibling order is inconsistent — \`prevTaskId\` (…, order N) must have a smaller \`order\` than \`nextTaskId\` (…, order M) …` (drag-and-drop; response carries a `details` object with the observed orders — see §5.10 A.2) |
| Task | 400 | `Sibling task is in a different column` (drag-and-drop with stale `prevTaskId`/`nextTaskId`) |
| Task | 400 | `Move did not change the task position…` (FE swapped `prev`/`next` or sent a stale neighbour — see §5.10 A.2) |
| Task | 400 | `position must be a non-negative integer` (drag-and-drop, style A.1) |
| Task | 400 | `Send either `position` OR `beforeId`/`afterId` — not both` (drag-and-drop, mixed styles) |
| Task | 400 | `beforeId and prevTaskId conflict — send only one` / `afterId and nextTaskId conflict — send only one` |
| Task | 400 | `Task is archived. Restore it before editing.` |
| Assignment | 400 | `User <id> is not an active member of this workspace` |
| Assignment | 409 | `Duplicate value for task, user, role` |

---

## 7. Concrete usage walkthrough

A typical flow for the Kanban screen, end to end:

```text
1. Login                  → POST {baseURL}/api/auth/login
2. Pick org (if many)     → set x-org-id header
3. Pick workspace         → GET  {baseURL}/api/workspaces
4. Open the board:
   a. Load columns        → GET  {baseURL}/api/workspaces/<wsId>/statuses?withTaskCounts=true
      └─ if empty, show "Configure statuses" CTA → POST .../statuses
   b. Load tasks          → GET  {baseURL}/api/workspaces/<wsId>/tasks/board
5. Open task details      → GET  {baseURL}/api/workspaces/<wsId>/tasks/<taskId>
6. Add an assignee        → POST {baseURL}/api/workspaces/<wsId>/tasks/<taskId>/assignments
7. Drag card up/down or
   between columns        → PATCH {baseURL}/api/workspaces/<wsId>/tasks/<taskId>/move
                            { "statusId": "<columnB>", "beforeId": "...", "afterId": "..." }
8. Drag a column          → PUT   {baseURL}/api/workspaces/<wsId>/statuses/reorder
   left/right               { "orderedIds": ["<s3>", "<s1>", "<s2>"] }
9. Archive task           → DELETE {baseURL}/api/workspaces/<wsId>/tasks/<taskId>
```

What's bound to what at each step:

- The JWT identifies the **User**.
- `x-org-id` (or the user's only org) selects the **Organisation**.
- The URL's workspaceId selects the **Workspace** (and tenant-checks
  the user against it).
- The task's `status` field selects which **Status** column it lives
  in. `null` = the leading "no status" bucket.
- The status's `order` field decides the **column's left-to-right
  position** on the board. `/statuses/reorder` is the only endpoint
  you need for column drag — pass the full `orderedIds` array.
- The task's `order` field decides its **vertical position inside
  that column**. `/tasks/<taskId>/move` is the only endpoint you need
  for card drag — pass `beforeId` / `afterId` based on what you
  dropped between.
- `TaskAssignment` rows (LEADER / ASSIGNEE / WATCHER) hang off a task;
  the `Task.assignees` array stays in sync automatically.
