import { Hono, Context } from 'hono';
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

// Import middleware
import { extensionAuthMiddleware } from './middleware/extensionAuth';
import { extensionRateLimitMiddleware } from './middleware/rateLimitExtension';
import { monitoringMiddleware, lightMonitoringMiddleware } from './middleware/monitoring';
import { databaseMiddleware } from './middleware/database';

// Import config validation
import { initializeConfig, getConfig, ConfigValidationError } from './lib/config';

import type { AppEnv } from './types/env';

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', secureHeaders());
app.use('*', databaseMiddleware); // Add database middleware globally
app.use('*', cors({
  origin: [
    'https://covercraft.ai', 
    'https://covercraft-dev.pages.dev', 
    'chrome-extension://*',
    'moz-extension://*', // Firefox support
    'http://localhost:3000', // Local development
    'http://localhost:8787'  // Wrangler dev
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Extension-Key', 'X-Extension-ID', 'X-Extension-Version', 'X-Test-Key'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));

// Health check (no auth required)
app.get('/api/health', (c) => {
  const config = getConfig();
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.environment,
    version: '1.0.0'
  });
});

// Debug endpoint for development
app.get('/api/debug/env', (c) => {
  const config = getConfig();
  
  if (config.environment !== 'development') {
    return c.json({ error: 'Not available in production' }, 403);
  }
  
  return c.json({
    environment: config.environment,
    hasJWT: !!config.jwt.secret,
    hasOpenAI: !!config.openai.apiKey,
    hasStripe: !!config.stripe.secretKey,
    hasExtensionSecret: !!config.extension.secret,
    hasValidIds: config.extension.validIds.length > 0,
    hasTestKey: !!config.features.testApiKey,
    hasDB: !!config.database.binding,
    hasKV: !!config.storage.rateLimitKV && !!config.storage.extensionKV,
    hasBucket: !!config.storage.bucket
  });
});

// Debug R2 bucket endpoint
app.get('/api/debug/r2', async (c) => {
  const config = getConfig();
  
  if (config.environment !== 'development') {
    return c.json({ error: 'Not available in production' }, 403);
  }
  
  try {
    // Test R2 bucket connectivity
    const testKey = 'test/connectivity-test.txt';
    const testData = 'R2 connectivity test';
    
    // Try to put a test file
    await config.storage.bucket.put(testKey, testData);
    
    // Try to get it back
    const retrieved = await config.storage.bucket.get(testKey);
    const content = retrieved ? await retrieved.text() : null;
    
    // Clean up
    await config.storage.bucket.delete(testKey);
    
    return c.json({
      status: 'success',
      message: 'R2 bucket is working',
      testResult: content === testData ? 'passed' : 'failed',
      bucketAvailable: true
    });
    
  } catch (error) {
    return c.json({
      status: 'error',
      message: 'R2 bucket test failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      bucketAvailable: false
    }, 500);
  }
});

// Test file upload to R2
app.post('/api/debug/upload-test', async (c) => {
  const config = getConfig();
  
  if (config.environment !== 'development') {
    return c.json({ error: 'Not available in production' }, 403);
  }
  
  try {
    const fileKey = `test-uploads/${Date.now()}-test-file.txt`;
    const testContent = 'This is a test file uploaded to R2!';
    
    // Upload to R2
    await config.storage.bucket.put(fileKey, testContent, {
      httpMetadata: {
        contentType: 'text/plain',
      }
    });
    
    // Verify it was uploaded
    const uploaded = await config.storage.bucket.get(fileKey);
    const retrievedContent = uploaded ? await uploaded.text() : null;
    
    return c.json({
      status: 'success',
      message: 'File uploaded to R2 successfully',
      fileKey,
      originalContent: testContent,
      retrievedContent,
      uploadWorked: retrievedContent === testContent,
      fileSize: testContent.length
    });
    
  } catch (error) {
    return c.json({
      status: 'error',
      message: 'File upload failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// List files in R2 bucket
app.get('/api/debug/r2-files', async (c) => {
  const config = getConfig();
  
  if (config.environment !== 'development') {
    return c.json({ error: 'Not available in production' }, 403);
  }
  
  try {
    // Test all local Worker services
    const results = {
      r2: { status: 'unknown' as string, files: [] as any[], error: null as string | null },
      rateLimitKV: { status: 'unknown' as string, keys: [] as string[], error: null as string | null },
      extensionKV: { status: 'unknown' as string, keys: [] as string[], error: null as string | null },
      database: { status: 'unknown' as string, tables: [] as string[], error: null as string | null }
    };

    // Test R2 bucket
    try {
      // Upload a test file to verify R2 is working
      const testKey = `debug/test-${Date.now()}.txt`;
      await config.storage.bucket.put(testKey, 'R2 test file');
      
      // Try to retrieve it
      const retrieved = await config.storage.bucket.get(testKey);
      if (retrieved) {
        results.r2.status = 'working';
        results.r2.files.push({
          key: testKey,
          size: retrieved.size,
          contentType: retrieved.httpMetadata?.contentType
        });
        
        // Clean up
        await config.storage.bucket.delete(testKey);
      }
    } catch (error) {
      results.r2.status = 'error';
      results.r2.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Test Rate Limit KV
    try {
      const testKey = `debug-test-${Date.now()}`;
      await config.storage.rateLimitKV.put(testKey, 'test-value', { expirationTtl: 60 });
      const value = await config.storage.rateLimitKV.get(testKey);
      
      if (value === 'test-value') {
        results.rateLimitKV.status = 'working';
        results.rateLimitKV.keys.push(testKey);
      }
      
      // Clean up
      await config.storage.rateLimitKV.delete(testKey);
    } catch (error) {
      results.rateLimitKV.status = 'error';
      results.rateLimitKV.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Test Extension KV
    try {
      const testKey = `debug-ext-${Date.now()}`;
      await config.storage.extensionKV.put(testKey, JSON.stringify({ test: true }), { expirationTtl: 60 });
      const value = await config.storage.extensionKV.get(testKey);
      
      if (value) {
        results.extensionKV.status = 'working';
        results.extensionKV.keys.push(testKey);
      }
      
      // Clean up
      await config.storage.extensionKV.delete(testKey);
    } catch (error) {
      results.extensionKV.status = 'error';
      results.extensionKV.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Test D1 Database
    try {
      // Try a simple query to test database connectivity
      const result = await config.database.binding.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      results.database.status = 'working';
      results.database.tables = result.results?.map((row: any) => row.name) || [];
    } catch (error) {
      results.database.status = 'error';
      results.database.error = error instanceof Error ? error.message : 'Unknown error';
    }

    return c.json({
      status: 'success',
      message: 'Local Worker services test results',
      environment: 'local development',
      services: results,
      summary: {
        r2Working: results.r2.status === 'working',
        rateLimitKVWorking: results.rateLimitKV.status === 'working',
        extensionKVWorking: results.extensionKV.status === 'working',
        databaseWorking: results.database.status === 'working',
        allServicesWorking: Object.values(results).every(service => service.status === 'working')
      }
    });
    
  } catch (error) {
    return c.json({
      status: 'error',
      message: 'Failed to test local services',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Public routes (no extension auth)
app.route('/api/auth', auth);
app.route('/api/webhooks', webhooks);

// Choose monitoring level based on environment
const chooseMonitoringMiddleware = (c: Context<AppEnv>) => {
  const config = getConfig();
  // You can make this even simpler - just remove monitoring entirely if you want
  return config.environment === 'production' 
    ? lightMonitoringMiddleware  // Minimal logging in production
    : monitoringMiddleware;      // Full logging in dev/staging
};

// Extension-protected routes with conditional monitoring
app.use('/api/jobs/*', (c, next) => chooseMonitoringMiddleware(c)(c, next));
app.use('/api/jobs/*', extensionRateLimitMiddleware, extensionAuthMiddleware);

app.use('/api/cover-letters/*', (c, next) => chooseMonitoringMiddleware(c)(c, next));
app.use('/api/cover-letters/*', extensionRateLimitMiddleware, extensionAuthMiddleware);

app.use('/api/resumes/*', (c, next) => chooseMonitoringMiddleware(c)(c, next));
app.use('/api/resumes/*', extensionRateLimitMiddleware, extensionAuthMiddleware);

// User and billing routes (require user auth, not extension auth)
app.route('/api/users', userRoutes);
app.route('/api/billing', billing);

// Apply routes
app.route('/api/jobs', jobs);
app.route('/api/cover-letters', coverLetterRoutes);
app.route('/api/resumes', resumeRoutes);

// Root endpoint
app.get('/', (c) => {
  const config = getConfig();
  return c.json({
    name: 'CoverCraft API',
    version: '1.0.0',
    description: 'AI-powered cover letter generation API',
    environment: config.environment,
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
  
  const config = getConfig();
  const isDevelopment = config.environment === 'development';
  
  return c.json({ 
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: err.stack })
  }, 500);
});

// Export the fetch handler with immediate config validation
export default {
  async fetch(request: Request, env: AppEnv['Bindings'], ctx: ExecutionContext): Promise<Response> {
    // Force config validation on EVERY request - this ensures it fails fast
    // In development, this will cause the worker to fail immediately
    try {
      initializeConfig(env);
    } catch (error) {
      console.error('❌ Configuration validation failed:', error);
      
      if (error instanceof ConfigValidationError) {
        const isDevelopment = env.ENVIRONMENT === 'development';
        
        // In development, we want to see the full error
        if (isDevelopment) {
          console.error('\n🚨 DEVELOPMENT SERVER CANNOT START');
          console.error('Missing required environment variables:');
          error.missingVars.forEach(varName => {
            console.error(`  - ${varName}`);
          });
          console.error('\nAdd these to your .dev.vars file to continue.\n');
        }
        
        return new Response(JSON.stringify({
          error: 'Configuration Error',
          message: 'The application is not properly configured',
          details: isDevelopment ? error.message : 'Please check server configuration',
          missingVars: isDevelopment ? error.missingVars : undefined,
          hint: isDevelopment ? 'Add missing variables to .dev.vars file' : undefined
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      throw error;
    }
    
    return app.fetch(request, env, ctx);
  }
};
