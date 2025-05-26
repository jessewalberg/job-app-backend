import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { createDB } from '../lib/db';
import { hashPassword, verifyPassword, generateToken, generateUUID, requireAuth } from '../lib/auth';
import { registerSchema, loginSchema, updateUserSchema } from '../lib/validation';
import { users } from '../db/schema';
import type { Env } from '../types/env';

const auth = new Hono<{ Bindings: Env }>();

// Register new user
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  console.log('register', c.env)
  try {
    const { name, email, password } = c.req.valid('json');
    const db = createDB(c.env);
    console.log(c.env)
    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
    console.log('existingUser', existingUser);
    if (existingUser) {
      return c.json({ 
        success: false, 
        error: 'User already exists with this email' 
      }, 409);
    }

    // Create new user
    const passwordHash = await hashPassword(password);
    const userId = generateUUID();
    
    const newUser = await db.insert(users).values({
      id: userId,
      email,
      name,
      passwordHash,
      credits: 3, // Free tier starts with 3 credits
      plan: 'free',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }).returning();

    // Generate JWT token
    const token = await generateToken({ 
      userId, 
      email, 
      plan: 'free' 
    }, c.env.JWT_SECRET);

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: userId,
          email,
          name,
          credits: 3,
          plan: 'free',
          createdAt: newUser[0].createdAt
        }
      }
    }, 201);

  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ 
      success: false, 
      error: 'Registration failed' 
    }, 500);
  }
});

// Login user
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  console.log(c.env)
  try {
    const { email, password } = c.req.valid('json');
    const db = createDB(c.env);

    // Find user by email
    const user = await db.select().from(users).where(eq(users.email, email)).get();
    if (!user) {
      return c.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, 401);
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      return c.json({ 
        success: false, 
        error: 'Invalid email or password' 
      }, 401);
    }

    // Generate JWT token
    const token = await generateToken({
      userId: user.id,
      email: user.email,
      plan: user.plan || 'free'
    }, c.env.JWT_SECRET);

    return c.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          credits: user.credits,
          plan: user.plan,
          stripeCustomerId: user.stripeCustomerId,
          createdAt: user.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return c.json({ 
      success: false, 
      error: 'Login failed' 
    }, 500);
  }
});

// Get current user profile
auth.get('/profile', requireAuth, async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    const userProfile = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      credits: users.credits,
      plan: users.plan,
      stripeCustomerId: users.stripeCustomerId,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    }).from(users).where(eq(users.id, user.userId)).get();

    if (!userProfile) {
      return c.json({ 
        success: false, 
        error: 'User not found' 
      }, 404);
    }

    return c.json({
      success: true,
      data: userProfile
    });

  } catch (error) {
    console.error('Profile fetch error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch profile' 
    }, 500);
  }
});

// Update user profile
auth.put('/profile', requireAuth, zValidator('json', updateUserSchema), async (c) => {
  try {
    const user = c.get('user');
    const updateData = c.req.valid('json');
    const db = createDB(c.env);

    // Check if new email already exists (if email is being updated)
    if (updateData.email) {
      const existingUser = await db.select().from(users)
        .where(eq(users.email, updateData.email)).get();
      
      if (existingUser && existingUser.id !== user.userId) {
        return c.json({ 
          success: false, 
          error: 'Email already in use' 
        }, 409);
      }
    }

    // Update user
    const updatedUser = await db.update(users)
      .set({
        ...updateData,
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.userId))
      .returning();

    if (!updatedUser[0]) {
      return c.json({ 
        success: false, 
        error: 'User not found' 
      }, 404);
    }

    const { passwordHash, ...userWithoutPassword } = updatedUser[0];

    return c.json({
      success: true,
      data: userWithoutPassword
    });

  } catch (error) {
    console.error('Profile update error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to update profile' 
    }, 500);
  }
});

export { auth };