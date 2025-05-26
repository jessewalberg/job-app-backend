import jwt from '@tsndr/cloudflare-worker-jwt';
import bcrypt from 'bcryptjs';
import type { Context } from 'hono';
import type { Env, JWTPayload } from '../types/env';

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export async function generateToken(payload: JWTPayload, secret: string): Promise<string> {
  const tokenPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
  };

  return await jwt.sign(tokenPayload, secret, { algorithm: 'HS256' });
}

export async function verifyToken(token: string, secret: string): Promise<JWTPayload> {
  const isValid = await jwt.verify(token, secret, { algorithm: 'HS256' });
  if (!isValid) {
    throw new Error('Invalid token');
  }
  
  const decoded = jwt.decode(token);
  return decoded.payload as JWTPayload;
}

export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: JWTPayload } }>, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ 
      success: false, 
      error: 'Authentication required' 
    }, 401);
  }

  try {
    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    
    // Check if token is expired
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return c.json({ 
        success: false,
        error: 'Token expired' 
      }, 401);
    }
    
    c.set('user', payload);
    await next();
  } catch (error) {
    console.error('Auth error:', error);
    return c.json({ 
      success: false, 
      error: 'Invalid token' 
    }, 401);
  }
}

export function generateUUID(): string {
  return crypto.randomUUID();
}