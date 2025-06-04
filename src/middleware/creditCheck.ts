import { MiddlewareHandler, Context } from 'hono';
import { CreditManager } from '../lib/credits';
import { sendInsufficientCredits } from '../lib/responses';
import type { AppEnv } from '../types/env';

/**
 * Middleware factory that creates credit checking middleware for specific operations
 */
export function createCreditCheckMiddleware(cost: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    const db = c.get('db');
    
    if (!user || !db) {
      throw new Error('Credit check middleware requires user and db in context');
    }
    
    const hasCredits = await CreditManager.checkCredits(db, user.userId, cost);
    
    if (!hasCredits) {
      return sendInsufficientCredits(c);
    }
    
    await next();
  };
}

/**
 * Pre-configured credit check middleware for common operations
 */
export const creditCheckMiddleware = {
  jobExtraction: createCreditCheckMiddleware(CreditManager.COSTS.JOB_EXTRACTION),
  coverLetterGeneration: createCreditCheckMiddleware(CreditManager.COSTS.COVER_LETTER_GENERATION),
  resumeUpload: createCreditCheckMiddleware(CreditManager.COSTS.RESUME_UPLOAD),
};

/**
 * Helper function to deduct credits after successful operation
 */
export async function deductCreditsAfterOperation(
  c: Context<AppEnv>,
  cost: number,
  endpoint: string,
  responseTime?: number
) {
  const user = c.get('user');
  const db = c.get('db');
  
  if (!user || !db) {
    throw new Error('Cannot deduct credits: user and db required in context');
  }
  
  await CreditManager.deductCredits(
    db,
    user.userId,
    cost,
    endpoint,
    c.req.header('CF-Connecting-IP'),
    c.req.header('User-Agent'),
    responseTime?.toString()
  );
  
  return await CreditManager.getUserCredits(db, user.userId);
} 