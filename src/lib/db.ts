import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types/env';

export function createDB(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Database = ReturnType<typeof createDB>;