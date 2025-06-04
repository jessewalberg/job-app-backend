import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, sum, count } from 'drizzle-orm';
import { createDB } from '../lib/db';
import { requireAuth } from '../lib/auth';
import { CreditManager } from '../lib/credits';
import { updateUserSchema } from '../lib/validation';
import { users, apiUsage, coverLetters, resumes, extractedJobs, creditTransactions } from '../db/schema';
import type { Env, JWTPayload } from '../types/env';

const userRoutes = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

userRoutes.use('*', requireAuth);

userRoutes.get('/profile', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    const userData = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      credits: users.credits,
      plan: users.plan,
      stripeCustomerId: users.stripeCustomerId,
      stripeSubscriptionId: users.stripeSubscriptionId,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionCurrentPeriodStart: users.subscriptionCurrentPeriodStart,
      subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt
    }).from(users).where(eq(users.id, user.userId)).get();

    if (!userData) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      success: true,
      data: userData
    });

  } catch (error) {
    console.error('Get profile error:', error);
    return c.json({ error: 'Failed to get profile' }, 500);
  }
});

userRoutes.put('/profile', zValidator('json', updateUserSchema), async (c) => {
  try {
    const user = c.get('user');
    const { name, email } = c.req.valid('json');
    const db = createDB(c.env);

    // Validate input
    if (!name && !email) {
      return c.json({ error: 'At least one field (name or email) is required' }, 400);
    }

    if (name && name.length < 2) {
      return c.json({ error: 'Name must be at least 2 characters' }, 400);
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: 'Invalid email format' }, 400);
    }

    // Check if email is already taken
    if (email) {
      const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
      
      if (existingUser && existingUser.id !== user.userId) {
        return c.json({ error: 'Email already taken' }, 409);
      }
    }

    // Update user - create proper typed update object
    interface UserUpdateData {
      updatedAt: string;
      name?: string;
      email?: string;
    }
    
    const updateData: UserUpdateData = {
      updatedAt: new Date().toISOString()
    };
    
    if (name) updateData.name = name;
    if (email) updateData.email = email;

    await db.update(users)
      .set(updateData)
      .where(eq(users.id, user.userId));

    // Get updated user data
    const updatedUser = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      credits: users.credits,
      plan: users.plan,
      updatedAt: users.updatedAt
    }).from(users).where(eq(users.id, user.userId)).get();

    return c.json({
      success: true,
      data: updatedUser
    });

  } catch (error) {
    console.error('Update profile error:', error);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

userRoutes.get('/stats', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    // Get usage statistics
    const [
      totalCreditsUsed,
      totalCoverLetters,
      totalResumes,
      totalJobExtractions,
      recentActivity,
      creditStats
    ] = await Promise.all([
      // Total credits used
      db.select({ total: sum(apiUsage.creditsUsed) })
        .from(apiUsage)
        .where(eq(apiUsage.userId, user.userId))
        .get(),
      
      // Total cover letters
      db.select({ count: count() })
        .from(coverLetters)
        .where(eq(coverLetters.userId, user.userId))
        .get(),
      
      // Total resumes
      db.select({ count: count() })
        .from(resumes)
        .where(eq(resumes.userId, user.userId))
        .get(),
      
      // Total job extractions
      db.select({ count: count() })
        .from(extractedJobs)
        .where(eq(extractedJobs.userId, user.userId))
        .get(),
      
      // Recent activity
      db.select({
        endpoint: apiUsage.endpoint,
        creditsUsed: apiUsage.creditsUsed,
        success: apiUsage.success,
        responseTime: apiUsage.responseTime,
        createdAt: apiUsage.createdAt
      })
      .from(apiUsage)
      .where(eq(apiUsage.userId, user.userId))
      .orderBy(desc(apiUsage.createdAt))
      .limit(10),

      // Credit statistics
      CreditManager.getCreditStats(db, user.userId)
    ]);

    // Get current credits
    const currentCredits = await CreditManager.getUserCredits(db, user.userId);

    return c.json({
      success: true,
      data: {
        currentCredits,
        totalCreditsUsed: totalCreditsUsed?.total || 0,
        totalCoverLetters: totalCoverLetters?.count || 0,
        totalResumes: totalResumes?.count || 0,
        totalJobExtractions: totalJobExtractions?.count || 0,
        recentActivity,
        creditStats: {
          currentBalance: creditStats.currentBalance,
          totalEarned: creditStats.totalEarned,
          totalSpent: creditStats.totalSpent,
          thisMonthSpent: creditStats.thisMonthSpent
        }
      }
    });

  } catch (error) {
    console.error('Get stats error:', error);
    return c.json({ error: 'Failed to get statistics' }, 500);
  }
});

userRoutes.get('/usage', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);
    
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const usage = await db.select()
      .from(apiUsage)
      .where(eq(apiUsage.userId, user.userId))
      .orderBy(desc(apiUsage.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      success: true,
      data: usage
    });

  } catch (error) {
    console.error('Get usage error:', error);
    return c.json({ error: 'Failed to get usage history' }, 500);
  }
});

userRoutes.get('/credits/history', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);
    
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    const history = await CreditManager.getCreditHistory(db, user.userId, limit);

    return c.json({
      success: true,
      data: history.map(transaction => ({
        ...transaction,
        metadata: transaction.metadata ? JSON.parse(transaction.metadata) : null
      }))
    });

  } catch (error) {
    console.error('Get credit history error:', error);
    return c.json({ error: 'Failed to get credit history' }, 500);
  }
});

userRoutes.get('/credits/stats', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    const stats = await CreditManager.getCreditStats(db, user.userId);

    return c.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Get credit stats error:', error);
    return c.json({ error: 'Failed to get credit statistics' }, 500);
  }
});

userRoutes.post('/credits/purchase', async (c) => {
  try {
    const user = c.get('user');
    const { amount } = await c.req.json();
    
    if (!amount || amount <= 0) {
      return c.json({ error: 'Invalid credit amount' }, 400);
    }

    // This would integrate with Stripe for actual payment processing
    // For now, we'll return a mock response
    return c.json({
      success: true,
      message: 'Credit purchase should be handled via /api/billing/purchase-credits endpoint',
      data: {
        amount,
        userId: user.userId,
        redirectTo: '/api/billing/purchase-credits'
      }
    });

  } catch (error) {
    console.error('Purchase credits error:', error);
    return c.json({ error: 'Failed to purchase credits' }, 500);
  }
});

userRoutes.delete('/account', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    // This would typically require additional confirmation
    // For now, we'll just mark the account for deletion
    await db.update(users)
      .set({ 
        email: `deleted_${Date.now()}@deleted.com`,
        name: 'Deleted User',
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.userId));

    return c.json({
      success: true,
      message: 'Account deletion initiated'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    return c.json({ error: 'Failed to delete account' }, 500);
  }
});

export { userRoutes };