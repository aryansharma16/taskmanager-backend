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
- `DELETE /api/users/:id` - Delete a user (Requires `delete:user` permission).

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
