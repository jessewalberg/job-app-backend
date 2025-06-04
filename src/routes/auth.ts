import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword, generateToken, requireAuth } from '../lib/auth';
import { validateRequestBody, ValidationError } from '../lib/validationHelper';
import { registerSchema, loginSchema, updateUserSchema } from '../lib/validation';
import { users } from '../db/schema';
import { databaseMiddleware } from '../middleware/database';
import { sendSuccess, sendError, sendValidationError, sendUnauthorized, handleError } from '../lib/responses';
import { getConfig } from '../lib/config';
import type { AppEnv } from '../types/env';

const auth = new Hono<AppEnv>();

// Apply database middleware to all routes
auth.use('*', databaseMiddleware);

// Register new user
auth.post('/register', async (c) => {
  try {
    const db = c.get('db');
    if (!db) {
      throw new Error('Database not available');
    }
    
    const body = await validateRequestBody(c, registerSchema);
    const { email, password, name } = body;

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
    if (existingUser) {
      return sendValidationError(c, 'User with this email already exists');
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const userId = crypto.randomUUID();
    
    const newUser = await db.insert(users).values({
      id: userId,
      email,
      passwordHash: hashedPassword,
      name,
      plan: 'free',
      credits: 10, // Free tier credits
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).returning();

    // Generate JWT token
    const config = getConfig();
    const token = await generateToken({
      userId: newUser[0].id,
      email: newUser[0].email,
      plan: newUser[0].plan || 'free'
    }, config.jwt.secret);

    return sendSuccess(c, {
      token,
      user: {
        id: newUser[0].id,
        email: newUser[0].email,
        name: newUser[0].name,
        plan: newUser[0].plan || 'free',
        credits: newUser[0].credits || 0
      }
    }, 201);

  } catch (error) {
    if (error instanceof ValidationError) {
      return sendValidationError(c, error.message, error.errors);
    }
    return handleError(c, error, 'Registration failed');
  }
});

// Login user
auth.post('/login', async (c) => {
  try {
    const db = c.get('db');
    if (!db) {
      throw new Error('Database not available');
    }
    
    const body = await validateRequestBody(c, loginSchema);
    const { email, password } = body;

    // Find user
    const user = await db.select().from(users).where(eq(users.email, email)).get();
    if (!user) {
      return sendUnauthorized(c, 'Invalid email or password');
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      return sendUnauthorized(c, 'Invalid email or password');
    }

    // Generate JWT token
    const config = getConfig();
    const token = await generateToken({
      userId: user.id,
      email: user.email,
      plan: user.plan || 'free'
    }, config.jwt.secret);

    return sendSuccess(c, {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan || 'free',
        credits: user.credits || 0
      }
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return sendValidationError(c, error.message, error.errors);
    }
    return handleError(c, error, 'Login failed');
  }
});

// Get current user profile
auth.get('/me', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const db = c.get('db');
    
    if (!db) {
      throw new Error('Database not available');
    }

    // Get fresh user data
    const userData = await db.select().from(users).where(eq(users.id, user.userId)).get();
    if (!userData) {
      return sendUnauthorized(c, 'User not found');
    }

    return sendSuccess(c, {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      plan: userData.plan || 'free',
      credits: userData.credits || 0
    });

  } catch (error) {
    return handleError(c, error, 'Failed to get user data');
  }
});

// Update user profile
auth.put('/me', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const db = c.get('db');
    
    if (!db) {
      throw new Error('Database not available');
    }
    
    const body = await validateRequestBody(c, updateUserSchema);

    const updatedUser = await db.update(users)
      .set({
        ...body,
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.userId))
      .returning();

    if (!updatedUser[0]) {
      return sendUnauthorized(c, 'User not found');
    }

    return sendSuccess(c, {
      id: updatedUser[0].id,
      email: updatedUser[0].email,
      name: updatedUser[0].name,
      plan: updatedUser[0].plan || 'free',
      credits: updatedUser[0].credits || 0
    });

  } catch (error) {
    if (error instanceof ValidationError) {
      return sendValidationError(c, error.message, error.errors);
    }
    return handleError(c, error, 'Failed to update user');
  }
});

export { auth };