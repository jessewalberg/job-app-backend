import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDB } from '../lib/db';
import { requireAuth } from '../lib/auth';
import { StripeService, PRICING_PLANS, CREDIT_PACKAGES } from '../lib/stripe';
import { users, payments, subscriptions } from '../db/schema';
import type { Env, JWTPayload } from '../types/env';
import { getConfig } from '../lib/config';

const billing = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// Validation schemas
const createSubscriptionSchema = z.object({
  planId: z.enum(['starter', 'pro', 'enterprise']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

const purchaseCreditsSchema = z.object({
  packageId: z.enum(['credits_10', 'credits_25', 'credits_50', 'credits_100']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url()
});

const changePlanSchema = z.object({
  planId: z.enum(['starter', 'pro', 'enterprise'])
});

billing.use('*', requireAuth);

// Get pricing plans
billing.get('/plans', async (c) => {
  return c.json({
    success: true,
    data: {
      plans: Object.values(PRICING_PLANS),
      creditPackages: Object.values(CREDIT_PACKAGES)
    }
  });
});

// Get current subscription
billing.get('/subscription', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    const userData = await db.select({
      plan: users.plan,
      credits: users.credits,
      stripeCustomerId: users.stripeCustomerId,
      stripeSubscriptionId: users.stripeSubscriptionId,
      subscriptionStatus: users.subscriptionStatus,
      subscriptionCurrentPeriodStart: users.subscriptionCurrentPeriodStart,
      subscriptionCurrentPeriodEnd: users.subscriptionCurrentPeriodEnd
    }).from(users).where(eq(users.id, user.userId)).get();

    if (!userData) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get subscription details from our database
    let subscriptionDetails = null;
    if (userData.stripeSubscriptionId) {
      subscriptionDetails = await db.select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, userData.stripeSubscriptionId))
        .get();
    }

    return c.json({
      success: true,
      data: {
        currentPlan: PRICING_PLANS[userData.plan || 'free'],
        credits: userData.credits,
        subscription: {
          status: userData.subscriptionStatus,
          currentPeriodStart: userData.subscriptionCurrentPeriodStart,
          currentPeriodEnd: userData.subscriptionCurrentPeriodEnd,
          stripeSubscriptionId: userData.stripeSubscriptionId,
          details: subscriptionDetails
        }
      }
    });

  } catch (error) {
    console.error('Get subscription error:', error);
    return c.json({ error: 'Failed to get subscription' }, 500);
  }
});

// Create subscription checkout session
billing.post('/subscribe', zValidator('json', createSubscriptionSchema), async (c) => {
  try {
    const { planId, successUrl, cancelUrl } = c.req.valid('json');
    const user = c.get('user');
    const db = createDB(c.env);
    const config = getConfig();
    const stripe = new StripeService(config.stripe.secretKey);

    const plan = PRICING_PLANS[planId];
    if (!plan) {
      return c.json({ error: 'Invalid plan' }, 400);
    }

    // Get user data
    const userData = await db.select().from(users).where(eq(users.id, user.userId)).get();
    if (!userData) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Create Stripe customer if doesn't exist
    let customerId = userData.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.createCustomer(userData.email, userData.name, user.userId);
      customerId = customer.id;
      
      await db.update(users)
        .set({ 
          stripeCustomerId: customerId,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, user.userId));
    }

    // Create checkout session
    const session = await stripe.createCheckoutSession({
      customerId,
      priceId: plan.stripePriceId,
      successUrl,
      cancelUrl,
      mode: 'subscription',
      metadata: {
        userId: user.userId,
        planId
      }
    });

    return c.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url
      }
    });

  } catch (error) {
    console.error('Create subscription error:', error);
    return c.json({ error: 'Failed to create subscription' }, 500);
  }
});

// Purchase credits
billing.post('/purchase-credits', zValidator('json', purchaseCreditsSchema), async (c) => {
  try {
    const { packageId, successUrl, cancelUrl } = c.req.valid('json');
    const user = c.get('user');
    const db = createDB(c.env);
    const config = getConfig();
    const stripe = new StripeService(config.stripe.secretKey);

    const creditPackage = CREDIT_PACKAGES[packageId];
    if (!creditPackage) {
      return c.json({ error: 'Invalid credit package' }, 400);
    }

    // Get user data
    const userData = await db.select().from(users).where(eq(users.id, user.userId)).get();
    if (!userData) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Create Stripe customer if doesn't exist
    let customerId = userData.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.createCustomer(userData.email, userData.name, user.userId);
      customerId = customer.id;
      
      await db.update(users)
        .set({ 
          stripeCustomerId: customerId,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, user.userId));
    }

    // Create checkout session for one-time payment
    const session = await stripe.createCheckoutSession({
      customerId,
      priceId: creditPackage.stripePriceId,
      successUrl,
      cancelUrl,
      mode: 'payment',
      metadata: {
        userId: user.userId,
        packageId,
        credits: creditPackage.credits.toString(),
        type: 'credits'
      }
    });

    return c.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url
      }
    });

  } catch (error) {
    console.error('Purchase credits error:', error);
    return c.json({ error: 'Failed to create credit purchase' }, 500);
  }
});

// Change subscription plan
billing.post('/change-plan', zValidator('json', changePlanSchema), async (c) => {
  try {
    const { planId } = c.req.valid('json');
    const user = c.get('user');
    const db = createDB(c.env);
    const config = getConfig();
    const stripe = new StripeService(config.stripe.secretKey);

    const newPlan = PRICING_PLANS[planId];
    if (!newPlan) {
      return c.json({ error: 'Invalid plan' }, 400);
    }

    // Get user data
    const userData = await db.select().from(users).where(eq(users.id, user.userId)).get();
    if (!userData || !userData.stripeSubscriptionId) {
      return c.json({ error: 'No active subscription found' }, 404);
    }

    // Update subscription in Stripe
    const updatedSubscription = await stripe.updateSubscription(
      userData.stripeSubscriptionId,
      newPlan.stripePriceId
    );

    // Update user plan in database
    await db.update(users)
      .set({
        plan: planId,
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.userId));

    // Update subscription in database
    await db.update(subscriptions)
      .set({
        stripePriceId: newPlan.stripePriceId,
        updatedAt: new Date().toISOString()
      })
      .where(eq(subscriptions.stripeSubscriptionId, userData.stripeSubscriptionId));

    return c.json({
      success: true,
      data: {
        subscription: updatedSubscription,
        newPlan
      }
    });

  } catch (error) {
    console.error('Change plan error:', error);
    return c.json({ error: 'Failed to change plan' }, 500);
  }
});

// Cancel subscription
billing.post('/cancel-subscription', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);
    const config = getConfig();
    const stripe = new StripeService(config.stripe.secretKey);

    // Get user data
    const userData = await db.select().from(users).where(eq(users.id, user.userId)).get();
    if (!userData || !userData.stripeSubscriptionId) {
      return c.json({ error: 'No active subscription found' }, 404);
    }

    // Cancel subscription in Stripe
    const canceledSubscription = await stripe.cancelSubscription(userData.stripeSubscriptionId);

    // Update user in database
    await db.update(users)
      .set({
        subscriptionStatus: 'canceled',
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.userId));

    // Update subscription in database
    await db.update(subscriptions)
      .set({
        status: 'canceled',
        canceledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(subscriptions.stripeSubscriptionId, userData.stripeSubscriptionId));

    return c.json({
      success: true,
      data: {
        subscription: canceledSubscription
      }
    });

  } catch (error) {
    console.error('Cancel subscription error:', error);
    return c.json({ error: 'Failed to cancel subscription' }, 500);
  }
});

// Create billing portal session
billing.post('/portal', async (c) => {
  try {
    const user = c.get('user');
    const { returnUrl } = await c.req.json();
    const db = createDB(c.env);
    const config = getConfig();
    const stripe = new StripeService(config.stripe.secretKey);

    // Get user data
    const userData = await db.select().from(users).where(eq(users.id, user.userId)).get();
    if (!userData || !userData.stripeCustomerId) {
      return c.json({ error: 'No customer found' }, 404);
    }

    // Create billing portal session
    const session = await stripe.createBillingPortalSession(
      userData.stripeCustomerId,
      returnUrl || 'https://applying-myself.ai/dashboard'
    );

    return c.json({
      success: true,
      data: {
        url: session.url
      }
    });

  } catch (error) {
    console.error('Create portal session error:', error);
    return c.json({ error: 'Failed to create portal session' }, 500);
  }
});

// Get payment history
billing.get('/payments', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    const paymentHistory = await db.select()
      .from(payments)
      .where(eq(payments.userId, user.userId))
      .orderBy(payments.createdAt)
      .limit(50);

    return c.json({
      success: true,
      data: paymentHistory.map(payment => ({
        ...payment,
        metadata: payment.metadata ? JSON.parse(payment.metadata) : null
      }))
    });

  } catch (error) {
    console.error('Get payments error:', error);
    return c.json({ error: 'Failed to get payment history' }, 500);
  }
});

export { billing };