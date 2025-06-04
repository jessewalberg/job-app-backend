import { MiddlewareHandler } from 'hono';
import { getConfig } from '../lib/config';
import type { AppEnv } from '../types/env';

export const extensionRateLimitMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = getConfig();
  const isDevelopment = config.environment === 'development';
  
  // Skip rate limiting in development
  if (isDevelopment) {
    await next();
    return;
  }

  const extensionId = c.req.header('X-Extension-ID');
  if (!extensionId) {
    return c.json({ error: 'Extension ID required for rate limiting' }, 400);
  }

  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 100; // Max requests per minute per extension
  
  const rateLimitKey = `rate_limit:${extensionId}:${Math.floor(now / windowMs)}`;

  try {
    // Get current request count for this window
    const currentDataStr = await config.storage.rateLimitKV.get(rateLimitKey);
    let currentData = currentDataStr ? JSON.parse(currentDataStr) : { count: 0, resetTime: now + windowMs };

    // Check if we're in a new window
    if (now >= currentData.resetTime) {
      currentData = { count: 0, resetTime: now + windowMs };
    }

    // Check rate limit
    if (currentData.count >= maxRequests) {
      const resetIn = Math.ceil((currentData.resetTime - now) / 1000);
      return c.json({
        error: 'Rate limit exceeded',
        limit: maxRequests,
        window: '1 minute',
        resetIn: `${resetIn} seconds`
      }, 429);
    }

    // Increment counter
    currentData.count++;

    // Store updated count with TTL
    await config.storage.rateLimitKV.put(
      rateLimitKey,
      JSON.stringify(currentData),
      { expirationTtl: Math.ceil(windowMs / 1000) + 10 } // Add 10 seconds buffer
    );

    // Add rate limit headers
    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', (maxRequests - currentData.count).toString());
    c.header('X-RateLimit-Reset', Math.ceil(currentData.resetTime / 1000).toString());

    await next();

  } catch (error) {
    console.error('Rate limiting error:', error);
    // If rate limiting fails, allow the request to continue
    await next();
  }
};