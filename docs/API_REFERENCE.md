# Backend API Reference (UI prompt)

Single self-contained reference for every endpoint exposed by the
backend. Paste this whole file into a UI-generation prompt and the model
has everything it needs: auth setup, permission strings, request /
response shapes, error envelope, and the suggested screen list.

> Stack assumptions: Node.js + Express + MongoDB (Mongoose). All
> responses are JSON. Base URL: `http://localhost:5000/api`.

---

## 1. Conceptual model (what the UI is wrapping)

```text
Organisation (tenant, B2B account)
├── User (member of one or more organisations via OrganisationMember)
├── Role (permission bundle; scope = ORGANISATION or WORKSPACE)
├── OrganisationMember (User x Organisation x Role)
└── Workspace (project / team silo, archivable)
    └── WorkspaceMember (User x Workspace x Role)
```

- A user belongs to one or more **Organisations** via
  `OrganisationMember`, each with an org-level `Role`.
- An organisation contains zero or more **Workspaces**.
- A user gains workspace access by being a `WorkspaceMember` (which
  references a workspace-scoped `Role`), unless their org role grants
  bypass perms.

---

## 2. Authentication

- `POST /api/auth/login` returns a JWT in `token`. Store it client-side.
- Send it on every authenticated request as
  `Authorization: Bearer <token>`.
- If the user belongs to multiple organisations, the FE must pick one
  and send `x-org-id: <organisationId>` on every request. If the user
  belongs to exactly one org, the header is optional.
- Recommended axios setup:

```javascript
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
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

## 3. Standard response envelope

Every endpoint returns one of:

```json
// Success
{ "success": true, "data": <payload>, "message"?: "..." }

// Failure
{ "success": false, "error": "<human readable>", "stack"?: "..." }
```

### HTTP status codes

| Status | Meaning                                  | Suggested UX                         |
|--------|------------------------------------------|--------------------------------------|
| 200    | OK                                       | Render result                        |
| 201    | Created                                  | Render result + success toast        |
| 400    | Validation / bad request                 | Inline form error using `error`      |
| 401    | Token missing / invalid / expired        | Redirect to `/login`                 |
| 403    | Authenticated but not permitted          | Toast "You don't have access"        |
| 404    | Not found / cross-tenant probe           | Redirect with toast                  |
| 409    | Duplicate (slug / email / membership)    | Inline error on offending field      |
| 5xx    | Server error                             | Generic toast + retry option         |

---

## 4. Permission catalogue

The backend's RBAC is permission-string based (`verb:noun` style).
A role holds an array of these strings. The wildcard `*` overrides
everything.

### Org-level permissions

| String                       | What it allows                                      |
|------------------------------|-----------------------------------------------------|
| `*`                          | Super admin — bypasses every check                  |
| `read:org`                   | View org details                                    |
| `update:org`                 | Edit org details                                    |
| `delete:org` (`*` only)      | Suspend org                                         |
| `create:user`                | Add a member to the org                             |
| `read:user`                  | List/read members                                   |
| `update:user`                | Change a member's role                              |
| `delete:user`                | Remove a member from the org                        |
| `create:role`                | Create a custom role                                |
| `read:role`                  | List/read roles                                     |
| `update:role`                | Edit a custom role                                  |
| `delete:role`                | Delete a custom role                                |
| `create:workspace`           | Create a workspace                                  |
| `read:workspace`             | List workspaces (scope still narrowed by membership)|
| `update:workspace`           | Edit a workspace (org bypass)                       |
| `delete:workspace`           | Archive a workspace (org bypass)                    |
| `manage:workspace`           | **Bypass perm**: act on any workspace in the tenant |
| `manage:workspace_members`   | Manage members on any workspace (when combined with bypass) |

The `OWNER` role auto-seeded for new tenants holds all of these except
`*` and `delete:org`.

### Workspace-level permissions (workspace-scoped roles)

| String                       | What it allows inside a workspace                    |
|------------------------------|------------------------------------------------------|
| `read:workspace`             | View workspace + members                             |
| `update:workspace`           | Edit workspace name/slug/description, restore        |
| `delete:workspace`           | Archive workspace                                    |
| `manage:workspace_members`   | Add/remove members; change member roles              |
| (future) `create:task`, `read:task`, `update:task`, `delete:task`, `assign:task` | Task engine permissions, reserved for the next phase. |

### Hybrid RBAC for workspace endpoints

Workspace-scoped routes apply this check:

1. If the requester's **org role** has `*` or `manage:workspace`,
   allow.
2. Otherwise the requester must have an `ACTIVE` `WorkspaceMember`
   whose `role.permissions` include every required workspace
   permission.

The FE should mirror this when deciding which buttons to show:

```javascript
const can = (perm) => {
  const orgPerms = currentUser.org.role.permissions;
  if (orgPerms.includes('*') || orgPerms.includes('manage:workspace')) return true;
  return (workspaceMember?.role?.permissions || []).includes(perm);
};
```

---

## 5. Endpoint reference

> Notation: `:id` means a 24-char Mongo ObjectId. All authenticated
> routes also need `Authorization: Bearer <token>` (omitted from each
> row for brevity).

### 5.1 Auth

#### `POST /api/auth/register`

Public. Bootstraps a brand-new tenant: creates an `Organisation`, the
default `OWNER` role (with full org + workspace perms), the first
`User`, and the join `OrganisationMember`.

Body:
```json
{
  "orgName":     "Acme Inc",
  "slug":        "acme",
  "userName":    "Alice Owner",
  "userEmail":   "alice@acme.com",
  "userPassword":"super-secret-123"
}
```
200/201 response `data`:
```json
{
  "organisation": { "_id": "...", "name": "Acme Inc", "slug": "acme", "..." : "..." },
  "user":         { "_id": "...", "name": "Alice Owner", "email": "alice@acme.com" }
}
```
Errors: `400` (missing fields), `409` (slug or email already taken).

#### `POST /api/auth/login`

Public. Returns a JWT and the list of organisations the user belongs to.

Body:
```json
{ "email": "alice@acme.com", "password": "super-secret-123" }
```
200 response:
```json
{
  "success": true,
  "token": "<jwt>",
  "data": {
    "id":    "<userId>",
    "name":  "Alice Owner",
    "email": "alice@acme.com",
    "organisations": [
      {
        "organisationId": "<orgId>",
        "name": "Acme Inc",
        "slug": "acme",
        "role": "OWNER"
      }
    ]
  }
}
```
Errors: `401` for any login failure (wrong password, deactivated user,
missing email).

> The login response gives you the role *name* per org, not the full
> permission list. If the FE needs the perm list to gate UI without
> another round-trip, fetch `GET /api/roles?scope=ORGANISATION` after
> login and look up by name; or extend the backend to embed permissions
> in the JWT.

---

### 5.2 Organisations

All require `authenticate`. Endpoints marked `*` require the wildcard
permission (super admin only).

| Method | Path                          | Permission   | What it does                                |
|--------|-------------------------------|--------------|---------------------------------------------|
| POST   | `/api/organisations`          | `*`          | Create a new tenant (typically registration handles this; super-admin tool). |
| GET    | `/api/organisations`          | `*`          | List every organisation in the system.       |
| GET    | `/api/organisations/:id`      | `read:org`   | Fetch a tenant. The controller enforces that non-`*` users can only fetch *their own* org. |
| PUT    | `/api/organisations/:id`      | `update:org` | Edit org fields (name, description, logo, website, industry, billingEmail, subscriptionPlan, metadata). Same own-tenant guard. |
| DELETE | `/api/organisations/:id`      | `delete:org` | Soft-suspend the org (`isActive=false`, `subscriptionStatus='canceled'`). |

Organisation document shape (response):
```json
{
  "_id": "...", "name": "Acme Inc", "slug": "acme",
  "description": "", "logo": "", "website": "", "industry": "",
  "subscriptionPlan": "free|pro|enterprise",
  "subscriptionStatus": "active|past_due|canceled|trialing",
  "billingEmail": null, "isActive": true,
  "createdAt": "...", "updatedAt": "..."
}
```

---

### 5.3 Roles

All require `authenticate`. Roles can be **org-scoped** (default) or
**workspace-scoped** (`scope: 'WORKSPACE'`).

| Method | Path                | Permission     | What it does                                    |
|--------|---------------------|----------------|-------------------------------------------------|
| POST   | `/api/roles`        | `create:role`  | Create a custom role.                           |
| GET    | `/api/roles`        | `read:role`    | List roles. Optional query: `?scope=ORGANISATION|WORKSPACE`. Returns both tenant-scoped roles and globally-scoped (`organisation: null`) defaults. |
| GET    | `/api/roles/:id`    | `read:role`    | Fetch a role.                                   |
| PUT    | `/api/roles/:id`    | `update:role`  | Edit `permissions` and/or `description`. Cannot edit non-custom or global roles. |
| DELETE | `/api/roles/:id`    | `delete:role`  | Delete a custom role. Rejected if it's still assigned to any `OrganisationMember` *or* `WorkspaceMember`. |

#### Create body

```json
{
  "name": "WORKSPACE_OWNER",          // required, uppercased server-side
  "scope": "WORKSPACE",                // optional, defaults to "ORGANISATION"
  "description": "Full control inside this workspace",
  "permissions": [
    "read:workspace", "update:workspace", "delete:workspace",
    "manage:workspace_members"
  ]
}
```

#### Update body

```json
{ "permissions": [...], "description": "optional new description" }
```

#### Role document shape

```json
{
  "_id": "...", "name": "WORKSPACE_OWNER",
  "scope": "ORGANISATION|WORKSPACE|SYSTEM",
  "organisation": "<orgId|null>",
  "permissions": ["..."],
  "description": "...",
  "isCustom": true,
  "createdAt": "...", "updatedAt": "..."
}
```

Errors:
- `400 Role name is required`, `400 permissions must be an array of strings`, `400 Invalid scope`.
- `409 Duplicate value for name, organisation, scope` if the role already exists.
- `400 Cannot modify system/global roles`, `400 Role does not belong to your organisation`, `400 Cannot modify system default roles`.
- `400 Cannot delete role: it is still assigned to N member(s) (org: X, workspace: Y).`

---

### 5.4 Users (organisation members)

All require `authenticate`. `:id` accepts **either** the
`OrganisationMember._id` returned by `GET /api/users` **or** the
underlying `User._id`.

| Method | Path                          | Permission     | What it does                                                             |
|--------|-------------------------------|----------------|--------------------------------------------------------------------------|
| POST   | `/api/users`                  | `create:user`  | Add a user to the current org. Creates the `User` if email is new; else attaches the existing user to the current org. |
| GET    | `/api/users`                  | `read:user`    | List active members of the current org (suspended members are filtered out). |
| GET    | `/api/users/:id`              | `read:user`    | Fetch a single member by membership id or user id.                       |
| PUT    | `/api/users/:id/role`         | `update:user`  | Change the member's role. Body: `{ roleId | role }`.                     |
| DELETE | `/api/users/:id`              | `delete:user`  | Remove the member from the org (the underlying `User` is preserved). Self-removal is rejected with `400`. |

#### Create body

```json
{
  "name":     "Bob Member",
  "email":    "bob@acme.com",
  "password": "another-secret-1",
  "roleId":   "<role _id>"   // alias accepted: "role"
}
```

201 response `data`:
```json
{
  "user":           { "_id": "...", "name": "...", "email": "...", "..." : "..." },
  "membership":     { "_id": "...", "user": "...", "organisation": "...", "role": "...", "status": "ACTIVE", "..." : "..." },
  "alreadyExisted": false
}
```

`alreadyExisted: true` means the email matched an existing `User`
across the platform; the `password` from the body was ignored and the
user was simply attached to your org.

#### Member document (returned by list / get)

```json
{
  "_id": "<membershipId>",
  "user": { "_id": "...", "name": "...", "email": "...", "profilePic": "...", "status": "active|suspended|invited" },
  "organisation": "<orgId>",
  "role": { "_id": "...", "name": "...", "permissions": ["..."], "isCustom": true },
  "status": "ACTIVE|SUSPENDED|INVITED",
  "createdAt": "...", "updatedAt": "..."
}
```

Errors:
- `400 name, email and password are required`, `400 roleId is required`, `400 Invalid roleId`.
- `400 User is already a member of this organisation`.
- `400 You cannot remove yourself from the organisation`.
- `409 Duplicate value for email` if the email is already in use globally.

---

### 5.5 Workspaces

All require `authenticate`. `:id` (and `:memberId` further down) is a
Mongo ObjectId. Workspace-scoped routes use the **hybrid RBAC** model
(see section 4).

| Method | Path                                              | Org permission         | Workspace permission              | What it does                                                                                   |
|--------|---------------------------------------------------|------------------------|-----------------------------------|------------------------------------------------------------------------------------------------|
| POST   | `/api/workspaces`                                 | `create:workspace`     | -                                 | Create a workspace. Creator is auto-added with the role they pick.                              |
| GET    | `/api/workspaces`                                 | `read:workspace`       | -                                 | List workspaces. Non-bypass users see only workspaces they're an `ACTIVE` member of.            |
| GET    | `/api/workspaces/:id`                             | -                      | `read:workspace` (or org bypass)  | Fetch a workspace + member count.                                                              |
| PUT    | `/api/workspaces/:id`                             | -                      | `update:workspace` (or bypass)    | Update name, slug, description, metadata.                                                       |
| DELETE | `/api/workspaces/:id`                             | -                      | `delete:workspace` (or bypass)    | Archive (soft-delete). `isActive=false`, `archivedAt=now`.                                      |
| PATCH  | `/api/workspaces/:id/restore`                     | -                      | `update:workspace` (or bypass)    | Un-archive. Only endpoint that operates on archived workspaces.                                |

#### Create body

```json
{
  "name":          "Engineering",
  "slug":          "engineering",                  // optional, auto-derived from name
  "description":   "Core product team",
  "creatorRoleId": "<workspace-scoped role _id>",  // aliases: "creatorRole", "roleId", "role"
  "initialMembers": [
    { "userId": "<userId>", "roleId": "<workspace-scoped role _id>" }
  ]
}
```

201 response `data`:
```json
{
  "workspace": {
    "_id": "...", "name": "Engineering", "slug": "engineering",
    "description": "Core product team", "organisation": "...",
    "createdBy": "...", "isActive": true, "archivedAt": null,
    "metadata": null, "createdAt": "...", "updatedAt": "..."
  },
  "memberFailures": [
    { "userId": "<id>", "error": "<reason this initial member failed>" }
  ]
}
```

`memberFailures` is empty in the happy path. The workspace itself
always succeeds; failures are reported per initial-member entry.

#### List query string

```
?page=1&limit=20&includeArchived=false
```
- `page` defaults `1`, `limit` defaults `20`, max `100`.
- `includeArchived=true` is silently ignored for users without
  `*` or `manage:workspace`.

200 response `data`:
```json
{
  "items": [
    {
      "_id": "...", "name": "Engineering", "slug": "engineering",
      "description": "...", "organisation": "...",
      "createdBy": { "_id": "...", "name": "...", "email": "..." },
      "isActive": true, "archivedAt": null,
      "createdAt": "...", "updatedAt": "..."
    }
  ],
  "page":  1,
  "limit": 20,
  "total": 1
}
```

#### Get-by-id response

```json
{ "workspace": { "..." : "..." }, "memberCount": 7 }
```

#### Update body (partial)

```json
{
  "name":        "New name",
  "slug":        "new-slug",
  "description": "Updated description",
  "metadata":    { "theme": "dark" }
}
```

#### Errors

- `400 Invalid workspace id`, `400 name is required`, `400 creatorRoleId is required`, `400 initialMembers must be an array`, `400 Each initialMembers entry must include userId and roleId`.
- `400 creatorRoleId is invalid or not a WORKSPACE-scoped role for this organisation`.
- `400 User <id> is not an active member of this organisation` (during create).
- `404 Workspace not found` (cross-tenant probe).
- `400 Workspace is archived. Restore it before performing this action.`
- `400 Workspace is already archived` / `400 Workspace is not archived`.
- `409 Duplicate value for organisation, slug` / `organisation, name`.

---

### 5.6 Workspace members

All require `authenticate` + `requireWorkspaceContext`. `:memberId`
accepts either `WorkspaceMember._id` (preferred — it's what the list
endpoint returns) or the underlying `User._id`.

| Method | Path                                                  | Workspace permission              | What it does                                                                |
|--------|-------------------------------------------------------|-----------------------------------|-----------------------------------------------------------------------------|
| GET    | `/api/workspaces/:id/members`                         | `read:workspace` (or org bypass)  | Paginated list of members. Query: `?status=ACTIVE|SUSPENDED|INVITED&page&limit`. Default `limit=50`, max `200`. |
| POST   | `/api/workspaces/:id/members`                         | `manage:workspace_members`        | Add a member.                                                               |
| PUT    | `/api/workspaces/:id/members/:memberId`               | `manage:workspace_members`        | Change member role.                                                         |
| DELETE | `/api/workspaces/:id/members/:memberId`               | `manage:workspace_members`        | Remove member (hard-delete the membership row).                              |

#### Add body
```json
{ "userId": "<orgMemberUserId>", "roleId": "<workspace-scoped role _id>" }
```
> The `userId` must be the underlying `User._id` (the one inside an
> `OrganisationMember`), not the membership id.

#### Change-role body
```json
{ "roleId": "<workspace-scoped role _id>" }
```

#### Member document (list/add response)

```json
{
  "_id": "<workspaceMemberId>",
  "user":      { "_id": "...", "name": "...", "email": "...", "profilePic": "..." },
  "workspace": "<workspaceId>",
  "role":      { "_id": "...", "name": "...", "permissions": ["..."], "scope": "WORKSPACE", "isCustom": true },
  "status":    "ACTIVE|SUSPENDED|INVITED",
  "addedBy":   "<userId|null>",
  "createdAt": "...", "updatedAt": "..."
}
```

#### List response

```json
{ "items": [<member>, ...], "page": 1, "limit": 50, "total": 3 }
```

Errors:
- `400 userId is required`, `400 roleId is required`, `400 Invalid workspace id`.
- `400 roleId is invalid or not a WORKSPACE-scoped role for this organisation`.
- `400 User <id> is not an active member of this organisation`.
- `400 User is already a member of this workspace`.
- `404 Workspace not found`, `404 Workspace member not found`.
- `409 Duplicate value for user, workspace` (concurrent add race).

---

## 6. Suggested UI screens (phase 1 - everything implemented today)

Generate these as a starter set; each screen maps cleanly onto the
endpoints above.

### Public

1. **Login page**
   - Form: email + password.
   - On success, store `token` and (if `organisations.length === 1`) the org id; otherwise show an org-picker step.
2. **Register page**
   - Form: orgName, slug (auto-suggested from orgName), userName, userEmail, userPassword.
   - On success, auto-login and route to `/onboarding`.

### Onboarding wizard (post-register, OWNER only)

3. **Step 1 - Define workspace roles**
   - List: `GET /api/roles?scope=WORKSPACE`.
   - Pre-fill three create-role calls (`WORKSPACE_OWNER`, `WORKSPACE_ADMIN`, `WORKSPACE_MEMBER`) with the suggested permission lists from `docs/WORKSPACE_LAYER.md` 8.3.
   - "Skip" if the user wants to define roles later; the workspace step will then be blocked with a friendly message.
4. **Step 2 - Create your first workspace**
   - Same form as the workspace create modal below. On success, route to the workspace detail page.

### Authenticated app shell

5. **Top bar**
   - Org switcher (if `organisations.length > 1`) — sets `localStorage.activeOrgId` and reloads.
   - Avatar menu: "Profile", "Logout".
6. **Sidebar**
   - "Workspaces" (link to list).
   - "Members" (org members; visible if `read:user`).
   - "Roles" (visible if `read:role`).
   - "Organisation settings" (visible if `read:org`).

### Org-level pages

7. **Org settings page** — `GET /api/organisations/:id`, `PUT /api/organisations/:id`. Show buttons gated by `update:org`.
8. **Org members page**
   - List: `GET /api/users` (returns membership rows with `user`, `role`, `status`).
   - Create modal: `POST /api/users`. `roleId` populated from `GET /api/roles?scope=ORGANISATION`.
   - Per-row: change role (`PUT /api/users/:id/role`), remove (`DELETE /api/users/:id`).
9. **Roles page**
   - Tabs: "Organisation roles" (`?scope=ORGANISATION`), "Workspace roles" (`?scope=WORKSPACE`).
   - Create / edit / delete via the role endpoints. Hide edit/delete on rows where `isCustom === false` or `organisation == null`.

### Workspace pages

10. **Workspaces list** - `GET /api/workspaces`. Paginator + "Show archived" toggle. "New workspace" CTA gated by `create:workspace`.
11. **Create workspace modal**
    - Fields: `name`, optional `slug` (live preview from `slugify(name)`), `description`, `creatorRoleId` (from `GET /api/roles?scope=WORKSPACE`), repeating `initialMembers` rows (user picker from `GET /api/users` + role picker from same workspace-role list).
12. **Workspace detail page** (`/workspaces/:id`)
    - Header with name, slug, archived banner if `!isActive`.
    - Tabs: "Overview" (`GET /api/workspaces/:id` -> `memberCount`), "Members".
    - Action menu: Edit, Archive (or Restore), gated by hybrid perms.
13. **Workspace members tab**
    - `GET /api/workspaces/:id/members` + filter by `status`.
    - Add modal: `POST /api/workspaces/:id/members`.
    - Per-row: change role (`PUT /api/workspaces/:id/members/:memberId`), remove (`DELETE /api/workspaces/:id/members/:memberId`).
    - Confirmation dialog on self-removal: "You'll lose access to this workspace."

### Cross-cutting concerns

14. **Toast / error host** that interprets the standard envelope.
15. **Permission helper** (`can(perm)`) used by every CTA — see section 4.

---

## 7. Edge cases the UI should handle (cheat-sheet)

- `:id` invalid -> `400 Invalid id format`. Render an inline form error or 404 page.
- Cross-tenant probe -> `404 Workspace not found` / `Resource not found`. Redirect to safety.
- Editing a role that's a system/global role -> backend returns `400 Cannot modify system/global roles`. Hide edit/delete in the UI for non-custom rows.
- Deleting a role still assigned to members -> backend returns `400 Cannot delete role: it is still assigned to N member(s)`. Surface this and offer a "Reassign members" link.
- Duplicate slug/name on workspace create -> `409`. Highlight the offending field.
- Adding an org-scoped role as `creatorRoleId` -> `400`. Filter the picker to `?scope=WORKSPACE` only.
- Archived workspace -> `400 Workspace is archived` on every endpoint except `PATCH /:id/restore`. Show a banner with a Restore CTA.
- Self-removal at org level -> `400`. Disable the row's remove button when `member.user._id === currentUser._id`.
- Self-removal at workspace level -> allowed, but show a confirmation modal.
- Multi-org users -> if `organisations.length > 1` after login, force them to pick one before any other call.

---

## 8. Out of scope (don't generate UI for these yet)

- Tasks, Statuses, Priorities, Labels, Comments, Attachments — the
  models exist, but no routes are wired yet.
- Notifications, Activity feed UI — the `ActivityLog` is being written
  on every RBAC mutation, but no `GET /api/activity` route exists yet.
- Email invitations (the schema supports `status: 'INVITED'`, but
  there's no invite-by-email flow).
- Cross-org workspace transfer.
- Stripe / billing flows (org has `subscriptionPlan` / `subscriptionStatus` fields but no webhook routes).
