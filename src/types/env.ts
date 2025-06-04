import type { Database } from '../lib/db';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  RATE_LIMIT_KV: KVNamespace; // KV for rate limiting
  EXTENSION_KV: KVNamespace;   // KV for extension data
  OPENAI_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_SECRET: string;
  EXTENSION_SECRET: string;
  VALID_EXTENSION_IDS: string; // JSON string array
  TEST_API_KEY?: string;       // Optional for development
  ENVIRONMENT: 'development' | 'staging' | 'production';
  [key: string]: unknown;
}
  
export interface JWTPayload {
  userId: string;
  email: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  iat?: number;
  exp?: number;
}

// Shared Hono environment types
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: JWTPayload;
    db?: Database; // Will be set by database middleware
    extensionId?: string;
    extensionVersion?: string;
    requestType?: string;
  };
};

// Type for routes that require authentication
export type AuthenticatedEnv = {
  Bindings: Env;
  Variables: {
    user: JWTPayload;
    db: Database;
  };
};

// Type for public routes (no auth required)
export type PublicEnv = {
  Bindings: Env;
  Variables: {
    db?: Database;
  };
};