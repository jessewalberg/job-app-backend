export interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    OPENAI_API_KEY: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    JWT_SECRET: string;
    ENVIRONMENT: 'development' | 'staging' | 'production';
    [key: string]: any;
  }
  
  export interface JWTPayload {
    userId: string;
    email: string;
    plan: 'free' | 'starter' | 'pro' | 'enterprise';
    iat?: number;
    exp?: number;
  }