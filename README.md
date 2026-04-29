# B2B SaaS Backend API

A robust, multi-tenant B2B SaaS backend built with Node.js, Express, and MongoDB. This project is structured with scalability and best practices in mind, featuring Role-Based Access Control (RBAC), secure authentication, and AI integrations.

## Features

- **Multi-Tenancy**: Built-in support for `Organisations` representing individual tenants.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions via the `Role` model. Middleware enforces access based on specific permission strings (e.g., `create:user`).
- **Secure Authentication**: JWT-based authentication and Bcrypt password hashing.
- **Future-Proof Schemas**: Extended fields like `metadata` maps, subscription tracking, and user statuses built directly into Mongoose schemas.
- **AI Integration**: Boilerplate for Google Generative AI (Gemini 1.5 Flash) included as a dedicated service.
- **Clean Architecture**: Separation of concerns across Routes, Controllers, and modular Services.
- **Task Management Engine**: Comprehensive models for Workspaces, Tasks, Assignments, Comments, Activity Logs, and Notifications.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose ODM)
- **Security**: JWT (jsonwebtoken), bcryptjs, CORS
- **AI**: Google Generative AI (`@google/generative-ai`)

## Getting Started

### Prerequisites
- Node.js (v16+)
- MongoDB (Local or Atlas)

### Installation

1. Clone the repository and navigate to the project directory:
   ```bash
   cd taskmanager-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Create a `.env` file in the root directory based on `.env.example` (if present), or define the following:
   ```env
   NODE_ENV=development
   PORT=5000
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRE=30d
   GEMINI_API_KEY=your_gemini_api_key
   ```

4. Run the Application:
   - For Development (with auto-reload):
     ```bash
     npm run dev
     ```
   - For Production:
     ```bash
     npm start
     ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new Organisation and its first Admin/Owner user.
- `POST /api/auth/login` - Login to receive a JWT payload.

### Users (Requires Auth & Permissions)
- `POST /api/users` - Create a new user within the current organisation (Requires `create:user` permission).
- `GET /api/users` - List members of the current organisation.
- `GET /api/users/:id` - Fetch a member by `OrganisationMember._id` or `User._id`.
- `PUT /api/users/:id/role` - Change a member's role.
- `DELETE /api/users/:id` - Remove a member from the organisation (Requires `delete:user` permission).

### Roles (Requires Auth & Permissions)
- `POST /api/roles` - Create a custom role. Body supports `scope: 'ORGANISATION' | 'WORKSPACE'` (default `ORGANISATION`).
- `GET /api/roles?scope=WORKSPACE` - List roles, optionally filtered by scope.
- `GET /api/roles/:id` - Fetch a role.
- `PUT /api/roles/:id` - Update a custom role's permissions/description.
- `DELETE /api/roles/:id` - Delete a custom role (rejected if any member still uses it).

### Workspaces (Requires Auth & Permissions)
See [docs/WORKSPACE_LAYER.md](docs/WORKSPACE_LAYER.md) for the full
reference, including the hybrid permission model and edge-case matrix.

- `POST /api/workspaces` - Create a workspace. The creator picks their own workspace-scoped role and may add initial members.
- `GET /api/workspaces` - List workspaces (paginated; only workspaces you're a member of unless you have `*` or `manage:workspace`).
- `GET /api/workspaces/:id` - Fetch a workspace with member count.
- `PUT /api/workspaces/:id` - Rename / re-slug / edit description.
- `DELETE /api/workspaces/:id` - Archive (soft-delete).
- `PATCH /api/workspaces/:id/restore` - Restore an archived workspace.
- `GET|POST /api/workspaces/:id/members` - List or add members.
- `PUT|DELETE /api/workspaces/:id/members/:memberId` - Change role or remove member.

### Tasks (Requires Auth & Workspace Permissions)
See [docs/TASK_LAYER.md](docs/TASK_LAYER.md) for the full reference,
including the drag-and-drop algorithm and edge-case matrix.

- `POST /api/workspaces/:id/tasks` - Create a task (subtasks via `parentTask`, initial assignees supported).
- `GET /api/workspaces/:id/tasks` - Paginated, filterable flat list.
- `GET /api/workspaces/:id/tasks/board` - Kanban view, tasks bucketed by status and ordered by `order`.
- `GET /api/workspaces/:id/tasks/:taskId` - Single task with assignments and subtask count.
- `PUT /api/workspaces/:id/tasks/:taskId` - Update task fields.
- `DELETE /api/workspaces/:id/tasks/:taskId` - Archive (cascades down subtasks).
- `PATCH /api/workspaces/:id/tasks/:taskId/restore` - Un-archive a task.
- `PATCH /api/workspaces/:id/tasks/:taskId/move` - Drag-and-drop move (status / order / parent).
- `GET /api/workspaces/:id/tasks/:taskId/subtasks` - Direct children, ordered.
- `GET|POST /api/workspaces/:id/tasks/:taskId/assignments` - List or add task assignments.
- `PUT|DELETE /api/workspaces/:id/tasks/:taskId/assignments/:assignmentId` - Change role or remove an assignment.

### Statuses (Kanban columns, workspace-scoped)
A workspace needs at least one `Status` to render real Kanban columns.
Reads use `read:task`; mutations require the new `manage:status`
permission. See [docs/API_REFERENCE.md §5.9](docs/API_REFERENCE.md) for
request/response shapes and the delete-with-`reassignTo` migration.

- `GET /api/workspaces/:id/statuses` - List statuses (`?withTaskCounts=true` for column badges).
- `POST /api/workspaces/:id/statuses` - Create a status (`{ name, color? }`).
- `GET /api/workspaces/:id/statuses/:statusId` - Single status + active task count.
- `PUT /api/workspaces/:id/statuses/:statusId` - Rename / re-color.
- `DELETE /api/workspaces/:id/statuses/:statusId` - Delete (use `?reassignTo=<id|null>` if it's still in use).

## Project Structure

```text
├── src/
│   ├── config/          # Database and external integrations setup
│   ├── controllers/     # Route logic handling HTTP requests
│   ├── middleware/      # Custom express middlewares (Auth, Error handling)
│   ├── models/          # Mongoose database schemas (Organisation, User, Workspace, Task, etc.)
│   ├── routes/          # Express route definitions
│   ├── services/        # Business logic and external API integrations
│   ├── app.js           # Express app instance and global middlewares
│   └── server.js        # Main entry point to bootstrap the API
├── .env                 # Environment configuration
├── .gitignore
└── package.json
```

## Core Models

The backend includes a comprehensive set of Mongoose schemas tailored for a scalable task management SaaS:
- **Core Platform**: `Organisation`, `User`, `Role`, `OrganisationMember`
- **Workspace Layer**: `Workspace`, `WorkspaceMember`
- **Task Engine**: `Task`, `TaskAssignment`, `Status`, `Priority`
- **Collaboration**: `Comment`, `Attachment`
- **Organization**: `Label`, `TaskLabel`
- **System Actions**: `ActivityLog`, `Notification`

## Future Roadmap

- Expand AI services with Gemini for automated content generation.
- Implement Subscription Billing Webhooks (Stripe/Paddle).
- Create automated database seeders for standard roles.
