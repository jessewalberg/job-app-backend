import { eq, and, sql, desc } from 'drizzle-orm';
import type { Database } from './db';
import { users, apiUsage, creditTransactions } from '../db/schema';
import type { CreditTransaction } from '../types/database';

interface CreditStats {
  currentBalance: number;
  totalEarned: number;
  totalSpent: number;
  thisMonthSpent: number;
}

interface PlanLimits {
  credits: number;
  monthlyCredits: number;
}

interface SubscriptionLimits {
  hasActiveSubscription: boolean;
  planLimits: PlanLimits;
  usage: {
    credits: number;
    monthlyCreditsUsed: number;
  };
}

export class CreditManager {
  static readonly COSTS = {
    COVER_LETTER_GENERATION: 3,
    JOB_EXTRACTION: 1,
    RESUME_ANALYSIS: 2,
    RESUME_UPLOAD: 1
  };

  static async checkCredits(db: Database, userId: string, requiredCredits: number): Promise<boolean> {
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    return user ? (user.credits ?? 0) >= requiredCredits : false;
  }

  static async deductCredits(
    db: Database, 
    userId: string, 
    amount: number, 
    endpoint: string, 
    ipAddress?: string, 
    userAgent?: string,
    sourceId?: string
  ): Promise<void> {
    // Get current balance
    const user = await db.select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!user || (user.credits ?? 0) < amount) {
      throw new Error('Insufficient credits');
    }

    const newBalance = (user.credits ?? 0) - amount;

    // Deduct credits from user
    await db.update(users)
      .set({ 
        credits: newBalance,
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, userId));

    // Log API usage
    const usageId = crypto.randomUUID();
    await db.insert(apiUsage).values({
      id: usageId,
      userId,
      endpoint,
      creditsUsed: amount,
      ipAddress,
      userAgent,
      success: true,
      createdAt: new Date().toISOString()
    });

    // Log credit transaction
    await db.insert(creditTransactions).values({
      id: crypto.randomUUID(),
      userId,
      type: 'spent',
      amount: -amount, // Negative for spent
      balance: newBalance,
      source: 'api_usage',
      sourceId: sourceId || usageId,
      description: `Credits used for ${endpoint}`,
      createdAt: new Date().toISOString()
    });
  }

  static async getUserCredits(db: Database, userId: string): Promise<number> {
    const user = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).get();
    return user?.credits ?? 0;
  }

  static async addCredits(
    db: Database, 
    userId: string, 
    amount: number, 
    source: string = 'purchase',
    sourceId?: string,
    description?: string
  ): Promise<void> {
    // Get current balance
    const user = await db.select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!user) {
      throw new Error('User not found');
    }

    const newBalance = (user.credits ?? 0) + amount;

    // Add credits to user
    await db.update(users)
      .set({ 
        credits: newBalance,
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, userId));

    // Log credit transaction
    await db.insert(creditTransactions).values({
      id: crypto.randomUUID(),
      userId,
      type: 'earned',
      amount: amount, // Positive for earned
      balance: newBalance,
      source,
      sourceId,
      description: description || `${amount} credits added from ${source}`,
      createdAt: new Date().toISOString()
    });
  }

  static async resetCreditsForPlan(
    db: Database, 
    userId: string, 
    planCredits: number,
    reason: string = 'subscription_renewal'
  ): Promise<void> {
    // Set credits to plan amount
    await db.update(users)
      .set({ 
        credits: planCredits,
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, userId));

    // Log credit transaction
    await db.insert(creditTransactions).values({
      id: crypto.randomUUID(),
      userId,
      type: 'earned',
      amount: planCredits,
      balance: planCredits,
      source: 'subscription',
      description: `Credits reset to ${planCredits} for ${reason}`,
      createdAt: new Date().toISOString()
    });
  }

  static async getCreditHistory(
    db: Database, 
    userId: string, 
    limit: number = 50
  ): Promise<CreditTransaction[]> {
    return await db.select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit);
  }

  static async getCreditStats(db: Database, userId: string): Promise<CreditStats> {
    const user = await db.select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!user) {
      return { currentBalance: 0, totalEarned: 0, totalSpent: 0, thisMonthSpent: 0 };
    }

    // Get all credit transactions
    const transactions = await db.select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));

    const totalEarned = transactions
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    const totalSpent = Math.abs(transactions
      .filter(t => t.amount < 0)
      .reduce((sum, t) => sum + t.amount, 0));

    // This month's spending
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const thisMonthSpent = Math.abs(transactions
      .filter(t => 
        t.amount < 0 && 
        t.createdAt &&
        new Date(t.createdAt) >= startOfMonth
      )
      .reduce((sum, t) => sum + t.amount, 0));

    return {
      currentBalance: user.credits ?? 0,
      totalEarned,
      totalSpent,
      thisMonthSpent
    };
  }

  static async checkSubscriptionLimits(db: Database, userId: string): Promise<SubscriptionLimits> {
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    
    if (!user || user.plan === 'free') {
      return {
        hasActiveSubscription: false,
        planLimits: { credits: 3, monthlyCredits: 3 },
        usage: { 
          credits: user?.credits ?? 0,
          monthlyCreditsUsed: 0
        }
      };
    }

    // Get current month usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyUsage = await db.select()
      .from(apiUsage)
      .where(
        and(
          eq(apiUsage.userId, userId),
          sql`datetime(${apiUsage.createdAt}) >= datetime(${startOfMonth.toISOString()})`
        )
      );

    const totalCreditsUsed = monthlyUsage.reduce((sum, usage) => sum + (usage.creditsUsed || 0), 0);

    return {
      hasActiveSubscription: ['starter', 'pro', 'enterprise'].includes(user.plan ?? 'free'),
      planLimits: this.getPlanLimits(user.plan ?? 'free'),
      usage: {
        credits: user.credits ?? 0,
        monthlyCreditsUsed: totalCreditsUsed
      }
    };
  }

  private static getPlanLimits(plan: string): PlanLimits {
    const limits = {
      free: { credits: 3, monthlyCredits: 3 },
      starter: { credits: 50, monthlyCredits: 50 },
      pro: { credits: 150, monthlyCredits: 150 },
      enterprise: { credits: 500, monthlyCredits: 500 }
    };
    
    return limits[plan as keyof typeof limits] || limits.free;
  }
}