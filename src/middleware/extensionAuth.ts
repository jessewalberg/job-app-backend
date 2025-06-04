import { MiddlewareHandler } from 'hono';
import { getConfig } from '../lib/config';
import type { AppEnv } from '../types/env';

async function incrementExtensionRequestCount(kv: KVNamespace, extensionId: string): Promise<number> {
  const key = `ext_requests:${extensionId}:${new Date().toISOString().split('T')[0]}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current) + 1 : 1;
  await kv.put(key, count.toString(), { expirationTtl: 86400 }); // 24 hours
  return count;
}

export const extensionAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = getConfig();
  const isDevelopment = config.environment === 'development';
  
  // Skip auth in development for localhost requests
  const isLocalRequest = isDevelopment && (
    c.req.header('host')?.includes('localhost') ||
    c.req.header('host')?.includes('127.0.0.1')
  );
  
  // Check for test API key in development
  const testKey = c.req.header('X-Test-Key');
  if (isLocalRequest || (testKey && testKey === config.features.testApiKey)) {
    await next();
    return;
  }

  // Get extension headers - only require ID, not the secret
  const extensionId = c.req.header('X-Extension-ID');
  const extensionVersion = c.req.header('X-Extension-Version');

  if (!extensionId) {
    return c.json({
      error: 'Missing extension authentication headers',
      required: ['X-Extension-ID']
    }, 401);
  }

  // Verify extension ID is in allowed list
  let validIds: string[] = [];
  try {
    validIds = config.extension.validIds;
  } catch (e) {
    console.error('Failed to parse VALID_EXTENSION_IDS:', e);
    return c.json({ error: 'Server configuration error' }, 500);
  }

  // Allow wildcard in development
  const isWildcardAllowed = isDevelopment && validIds.includes('*');
  
  if (!isWildcardAllowed && !validIds.includes(extensionId)) {
    return c.json({ 
      error: 'Extension ID not authorized',
      extensionId,
      hint: isDevelopment ? 'Add your extension ID to VALID_EXTENSION_IDS or use "*" for development' : undefined
    }, 403);
  }

  // Track extension usage
  try {
    const requestCount = await incrementExtensionRequestCount(config.storage.extensionKV, extensionId);
    
    // Store extension info in context for monitoring
    c.set('extensionId', extensionId);
    c.set('extensionVersion', extensionVersion);
    c.set('requestType', 'extension');

    // Store daily usage stats
    await config.storage.extensionKV.put(
      `ext_daily_stats:${extensionId}:${new Date().toISOString().split('T')[0]}`,
      JSON.stringify({
        extensionId,
        version: extensionVersion,
        requests: requestCount,
        lastRequest: new Date().toISOString()
      }),
      { expirationTtl: 86400 * 7 } // Keep for 7 days
    );

  } catch (error) {
    console.error('Extension tracking error:', error);
    // Don't fail the request for tracking errors
  }

  await next();
};