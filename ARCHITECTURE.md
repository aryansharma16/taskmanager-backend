# Backend Architecture & Schema Documentation

This document explains the structural decisions, schema designs, and middleware logic for the Task Manager SaaS backend.

## 1. Overview of the Architecture

This backend is designed as a **Multi-Tenant SaaS** (Software as a Service) application using **Node.js, Express, and MongoDB (Mongoose)**. The architecture separates concerns across different layers:
- **Routes**: Define the API endpoints and map them to controllers.
- **Middleware**: Handles cross-cutting concerns like Authentication, Authorization (RBAC), and Error Handling.
- **Controllers**: Handle HTTP requests/responses and orchestrate business logic.
- **Models**: Define the MongoDB schemas and database relationships.
- **Services**: Encapsulate reusable business logic and external integrations (e.g., AI integration, email sending).

---

## 2. Middleware Architecture

The application relies heavily on customized Express middleware to secure routes and enforce permissions.

### Authentication Middleware (`authenticate`)
- **How it works**: It intercepts incoming requests, looks for a `Bearer` token in the `Authorization` header, and verifies the JWT.
- **What it does**: If the token is valid, it decodes the payload (usually containing the user ID) and queries the database for the user. It populates the user's `Role` object so that permissions are readily available. Finally, it attaches the `user` object to the Express `req` object (`req.user`) and calls `next()`.
- **Security benefit**: It ensures that only active, authenticated users can access protected endpoints.

### Role-Based Access Control (RBAC) Middleware (`requirePermissions`)
- **How it works**: This is a factory function that takes an array of required permission strings (e.g., `requirePermissions('create:task', 'delete:task')`).
- **What it does**: It checks the `req.user.role.permissions` array (populated by the authentication middleware) to see if the user has **all** the required permissions to perform the action.
- **Why it's used**: Hardcoding roles (e.g., "ADMIN", "USER") is rigid. Using discrete permission strings allows for extreme flexibility. You can create custom roles (e.g., "Project Manager", "Guest Viewer") simply by grouping different permission strings together without changing the code.

---

## 3. Database Schema Design & Rationale

The database is built on MongoDB, utilizing Mongoose references (`ObjectId`) to build relational-like connections while maintaining NoSQL scalability. 

### Core Platform Models (Multi-Tenancy & Auth)

- **`Organisation`**: The top-level tenant. Every user and workspace belongs to an organisation. This is what makes the app a B2B SaaS. Billing and subscriptions are usually tied to this model.
- **`User`**: Represents a physical person. Contains authentication details. Decoupled from organisations to allow a user to belong to multiple tenants (e.g., agencies/consultants).
- **`OrganisationMember`**: The critical join model mapping a `User` to an `Organisation` and assigning them an org-level `Role`.
- **`Role`**: Stores a set of permission strings (e.g., `["read:task", "write:task"]`). Scoped to either `ORGANISATION` or `WORKSPACE`, ensuring custom roles don't conflict globally.

### Workspace Layer

- **`Workspace`**: Represents a project, team, or department within an `Organisation`. This acts as a silo for tasks and statuses.
- **`WorkspaceMember`**: A join table (mapping) between `User` and `Workspace`. 
  - **Why this model?** A user might be part of an organisation but not necessarily part of every workspace. This model tracks *which* users are in *which* workspaces. It references the `Role` model directly to unify the RBAC engine for both workspace-level and org-level permissions.

### Task Engine

- **`Task`**: The core entity. Contains references to the `Workspace`, `User` (creator), `Status`, and `Priority`. It includes an `assignees` array for blazing-fast "assigned to me" read queries and a `parentTask` reference for subtasks.
- **`TaskAssignment`**: A join table mapping `User` to `Task`.
  - **Why this model?** While the `assignees` array on `Task` handles fast filtering, this collection tracks *metadata* about the assignment (e.g., "LEADER" vs "WATCHER"). This prevents huge document sizes from heavy metadata while still maintaining read optimization on the `Task` itself.
- **`Status` & `Priority`**: Look-up tables linked to a `Workspace`.
  - **Why separate models?** Instead of hardcoding statuses (e.g., "To Do", "In Progress"), giving them their own model allows each Workspace to define custom workflows (e.g., "In QA", "Awaiting Client").

### Collaboration & Organization

- **`Comment`**: A threaded discussion model linked to a `Task`. Uses a `parentComment` self-reference to support infinite threading (replies to replies).
- **`Attachment`**: Stores metadata and URLs for uploaded files (AWS S3, Cloudinary) linked to a `Task`.
- **`Label` & `TaskLabel`**: 
  - **`Label`**: A custom tag (with a color) defined at the Workspace level.
  - **`TaskLabel`**: A mapping collection to link Tasks to Labels. 
  - **Why many-to-many?** Keeping a separate mapping document allows for easy querying and prevents array bloat inside the `Task` model when dealing with heavy indexing or huge numbers of labels.

### System Actions

- **`ActivityLog`**: An audit trail. Every time a user updates a task or adds a comment, an entry is added here. 
  - **Why this model?** It uses polymorphic relations (`entityType` and `entityId`) to log actions. It also includes a `workspace` reference, heavily indexed to allow O(1) query performance for generating real-time "Workspace Activity Feeds" at scale.
- **`Notification`**: Represents an alert for a user. It uses `isRead` to track state and `referenceId` to link back to the trigger event (e.g., being mentioned in a comment).

---

## 4. Key Design Principles Followed

1. **Scalability over Simplicity**: Instead of shoving everything into massive arrays on the `Task` document (e.g., `comments: []`), rich data is normalized into separate collections (`Comment`, `TaskAssignment`). However, simple reference arrays (like `assignees: [ObjectId]`) are intentionally denormalized on the `Task` to optimize read-heavy filtering without hitting the 16MB limit.
2. **Compound Indexing**: Almost all join models (`WorkspaceMember`, `TaskAssignment`) have unique compound indexes. This enforces database-level integrity (e.g., a user cannot be assigned as the "LEADER" of the same task twice).
3. **Soft Deletions & Archiving**: Models use `isActive` or `isArchived` booleans. In a SaaS, you rarely `DELETE` records because it destroys analytical data and audit logs. You flag them as archived instead.
4. **Time-Stamping**: Every schema includes `{ timestamps: true }`, automatically generating `createdAt` and `updatedAt` fields—vital for sorting, syncing, and caching.

## 5. Extensibility

Because the system avoids hardcoded enums for core workflows (like Statuses, Labels, and Permissions) and relies on reference models, adding features like **Custom Fields**, **Automations**, or **Client Portals** in the future will require minimal structural refactoring.

---

## 6. API Route Modules (RBAC & Tenancy)

The routing architecture is modularized, mapping directly to specific business entities. All endpoints (excluding public auth) evaluate an injected `x-org-id` header via middleware to establish the tenant context before any logic executes.

### `authRoutes` (Public / Registration)
- **Purpose**: Issues JWTs and handles initial tenant onboarding.
- **Key Flow**: When registering, it simultaneously creates an `Organisation`, a base `Role` (OWNER), a `User`, and binds them via an `OrganisationMember` join document. The JWT payload returned strictly encodes user identification (and basic info to avoid DB round-trips), not roles.

### `organisationRoutes` (SaaS & Tenant Levels)
- **SaaS Level (SUPER_ADMIN)**: Routes like `POST /` and `GET /` globally manage instances. They require the wildcard `*` permission, which immediately bypasses all other granular checks in the `requirePermissions` middleware.
- **Tenant Level**: Routes like `GET /:id` or `PUT /:id` allow a tenant to manage their own specific organisation. The controller enforces that the requested `:id` strictly matches the `req.user.organisation` resolved from their header, preventing cross-tenant leakage.

### `roleRoutes` (Custom RBAC)
- **Purpose**: Allows tenants to craft custom roles within their organisation.
- **Key Flow**: Requires `create:role` or `update:role` permissions. When fetching roles, it returns both global default roles (where `organisation: null`) and custom roles scoped to the active tenant.

### `userRoutes` (Membership Management)
- **Purpose**: Manages `OrganisationMember` links.
- **Key Flow**: Creating or removing a user under this module does not mutate the core `User` document. Instead, it assigns them to the tenant or sets their membership `status` to `SUSPENDED`, preserving soft-delete tracking. Invoking `PUT /:id/role` securely migrates a user between defined tenant roles.
