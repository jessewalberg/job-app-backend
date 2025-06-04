import { MiddlewareHandler } from 'hono';
import { createDB } from '../lib/db';
import type { AppEnv } from '../types/env';

/**
 * Database middleware that automatically creates and provides a database instance
 * to all handlers via c.var.db or c.get('db')
 */
export const databaseMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const db = createDB(c.env);
  c.set('db', db);
  await next();
}; 