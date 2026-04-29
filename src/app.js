import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import roleRoutes from './routes/roleRoutes.js';
import organisationRoutes from './routes/organisationRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import statusRoutes from './routes/statusRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/organisations', organisationRoutes);
app.use('/api/workspaces', workspaceRoutes);
// Task routes are nested under a workspace. Mounting at the prefix
// below keeps RBAC simple: every task route has a workspace context.
app.use('/api/workspaces/:id/tasks', taskRoutes);
// Statuses are workspace-scoped Kanban columns. Same `:id` pattern as
// tasks so requireWorkspaceContext can resolve `req.workspace`.
app.use('/api/workspaces/:id/statuses', statusRoutes);

// Root Endpoint
app.get('/', (req, res) => {
    res.send('B2B SaaS API is running...');
});

// Error Handling Middleware
app.use(errorHandler);

export default app;
