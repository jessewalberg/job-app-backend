import { MiddlewareHandler } from 'hono';
import { getConfig } from '../lib/config';
import type { AppEnv } from '../types/env';

interface RequestMetrics {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  responseTime: number;
  extensionId?: string;
  extensionVersion?: string;
  userAgent?: string;
  ip?: string;
  error?: string;
}

interface MonitoringConfig {
  enabled: boolean;
  sampleRate: number; // 0-1, percentage of requests to log
  logErrors: boolean;
  logSlowRequests: boolean;
  slowRequestThreshold: number; // milliseconds
}

function getMonitoringConfig(environment: string): MonitoringConfig {
  switch (environment) {
    case 'production':
      return {
        enabled: true,
        sampleRate: 0.1, // Log 10% of requests
        logErrors: true,
        logSlowRequests: true,
        slowRequestThreshold: 2000
      };
    case 'staging':
      return {
        enabled: true,
        sampleRate: 0.5, // Log 50% of requests
        logErrors: true,
        logSlowRequests: true,
        slowRequestThreshold: 1000
      };
    default: // development
      return {
        enabled: true,
        sampleRate: 1.0, // Log all requests
        logErrors: true,
        logSlowRequests: true,
        slowRequestThreshold: 500
      };
  }
}

async function storeMetrics(kv: KVNamespace | undefined, metrics: RequestMetrics): Promise<void> {
  if (!kv) {
    // KV not available, warn about it
    console.warn('⚠️  KV storage not available - metrics will not be persisted');
    return;
  }
  
  try {
    const key = `metrics:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    await kv.put(key, JSON.stringify(metrics), {
      expirationTtl: 86400 * 7 // Keep for 7 days
    });
  } catch (error) {
    console.error('Failed to store metrics:', error);
  }
}

export const monitoringMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = getConfig();
  const monitoringConfig = getMonitoringConfig(config.environment);
  
  if (!monitoringConfig.enabled) {
    await next();
    return;
  }

  const startTime = Date.now();
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  
  try {
    await next();
  } catch (error) {
    // Log error and re-throw
    if (monitoringConfig.logErrors) {
      const errorMetrics: RequestMetrics = {
        timestamp: new Date().toISOString(),
        method,
        path,
        status: 500,
        responseTime: Date.now() - startTime,
        extensionId: c.get('extensionId'),
        extensionVersion: c.get('extensionVersion'),
        userAgent: c.req.header('User-Agent'),
        ip: c.req.header('CF-Connecting-IP'),
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      console.error('Request error:', errorMetrics);
      
      // Store error metrics
      storeMetrics(config.storage.extensionKV, errorMetrics).catch(err => {
        console.error('Failed to store error metrics:', err);
      });
    }
    
    throw error;
  }

  const responseTime = Date.now() - startTime;
  const status = c.res.status;

  // Decide whether to log this request
  const shouldLog = Math.random() < monitoringConfig.sampleRate ||
                   (monitoringConfig.logErrors && status >= 400) ||
                   (monitoringConfig.logSlowRequests && responseTime > monitoringConfig.slowRequestThreshold);

  if (shouldLog) {
    const metrics: RequestMetrics = {
      timestamp: new Date().toISOString(),
      method,
      path,
      status,
      responseTime,
      extensionId: c.get('extensionId'),
      extensionVersion: c.get('extensionVersion'),
      userAgent: c.req.header('User-Agent'),
      ip: c.req.header('CF-Connecting-IP')
    };

    // Log to console in development
    if (config.environment === 'development') {
      console.log(`${method} ${path} - ${status} (${responseTime}ms)`);
    }

    // Store metrics in KV
    storeMetrics(config.storage.extensionKV, metrics).catch(error => {
      console.error('Failed to store request metrics:', error);
    });
  }
};

// Lightweight monitoring for production
export const lightMonitoringMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = getConfig();
  const startTime = Date.now();
  
  try {
    await next();
  } catch (error) {
    // Only log errors in light mode
    const responseTime = Date.now() - startTime;
    console.error(`Error: ${c.req.method} ${new URL(c.req.url).pathname} - ${responseTime}ms`, error);
    throw error;
  }
  
  // Only log slow requests or errors
  const responseTime = Date.now() - startTime;
  const status = c.res.status;
  
  if (status >= 400 || responseTime > 2000) {
    console.log(`${c.req.method} ${new URL(c.req.url).pathname} - ${status} (${responseTime}ms)`);
  }
};