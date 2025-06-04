import { sign, verify } from '@tsndr/cloudflare-worker-jwt';
import bcrypt from 'bcryptjs';
import type { Context, MiddlewareHandler } from 'hono';
import { getConfig } from './config';
import type { JWTPayload, AppEnv } from '../types/env';

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export async function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + (7 * 24 * 60 * 60) // 7 days
  };
  
  return await sign(fullPayload, secret);
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload> {
  const isValid = await verify(token, secret);
  if (!isValid) {
    throw new Error('Invalid token');
  }
  
  const payload = JSON.parse(atob(token.split('.')[1])) as JWTPayload;
  return payload;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  console.log('authHeader', authHeader);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }
  
  const token = authHeader.substring(7);
  
  try {
    const config = getConfig();
    const payload = await verifyToken(token, config.jwt.secret);
    
    // Check if token is expired
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return c.json({ error: 'Token expired' }, 401);
    }
    
    c.set('user', payload);
    await next();
  } catch (error) {
    console.error('Auth error:', error);
    return c.json({ error: 'Invalid token' }, 401);
  }
};