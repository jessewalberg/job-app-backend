import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';

import { auth } from './routes/auth';
import { jobs } from './routes/jobs';
import { coverLetterRoutes } from './routes/coverLetters';
import { resumeRoutes } from './routes/resumes';
import { userRoutes } from './routes/users';
import { billing } from './routes/billing';
import { webhooks } from './routes/webhooks';
import type { Env, JWTPayload } from './types/env';

const app = new Hono<{ Bindings: Env; Variables?: { user?: JWTPayload } }>();

// Middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: ['https://applying-myself.ai', 'https://applying-myself-dev.pages.dev', 'chrome-extension://*'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: c.env?.ENVIRONMENT || 'unknown',
    version: '1.0.0'
  });
});

// API Routes
app.route('/api/auth', auth);
app.route('/api/jobs', jobs);
app.route('/api/cover-letters', coverLetterRoutes);
app.route('/api/resumes', resumeRoutes);
app.route('/api/users', userRoutes);
app.route('/api/billing', billing);
app.route('/api/webhooks', webhooks);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'applying-myself API',
    version: '1.0.0',
    description: 'AI-powered cover letter generation API',
    environment: c.env?.ENVIRONMENT || 'unknown',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/*',
      jobs: '/api/jobs/*',
      coverLetters: '/api/cover-letters/*',
      resumes: '/api/resumes/*',
      users: '/api/users/*',
      billing: '/api/billing/*',
      webhooks: '/api/webhooks/*'
    }
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ 
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
    timestamp: new Date().toISOString()
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  
  const isDevelopment = c.env?.ENVIRONMENT === 'development';
  
  return c.json({ 
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: err.stack })
  }, 500);
});

export default app;