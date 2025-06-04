import { MiddlewareHandler, Context } from 'hono';
import { requireAuth } from '../lib/auth';
import { createDB } from '../lib/db';
import type { AppEnv } from '../types/env';

/**
 * Combined middleware that provides both authentication and database access
 * This eliminates the need to manually get user and db in every handler
 */
export const authContextMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Create and set database instance
  const db = createDB(c.env);
  c.set('db', db);
  
  // Apply auth middleware
  await requireAuth(c, next);
};

/**
 * Helper function to get authenticated user and database from context
 * This provides type safety and eliminates repetitive code
 */
export function getAuthContext(c: Context<AppEnv>) {
  const user = c.get('user');
  const db = c.get('db');
  
  if (!user) {
    throw new Error('User not found in context. Make sure authContextMiddleware is applied.');
  }
  
  if (!db) {
    throw new Error('Database not found in context. Make sure authContextMiddleware is applied.');
  }
  
  return { user, db };
} 