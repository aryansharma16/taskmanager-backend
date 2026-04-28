import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import roleRoutes from './routes/roleRoutes.js';
import organisationRoutes from './routes/organisationRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
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

// Root Endpoint
app.get('/', (req, res) => {
    res.send('B2B SaaS API is running...');
});

// Error Handling Middleware
app.use(errorHandler);

export default app;
