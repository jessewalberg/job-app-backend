import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { createDB } from '../lib/db';
import { StripeService, PRICING_PLANS } from '../lib/stripe';
import { CreditManager } from '../lib/credits';
import { users, payments, subscriptions } from '../db/schema';
import { getConfig } from '../lib/config';
import type { Env } from '../types/env';
import type { Database } from '../lib/db';

const webhooks = new Hono<{ Bindings: Env }>();

// Stripe webhook handler
webhooks.post('/stripe', async (c) => {
  try {
    const signature = c.req.header('stripe-signature');
    if (!signature) {
      return c.json({ error: 'Missing stripe signature' }, 400);
    }

    const body = await c.req.text();
    const config = getConfig();
    const stripe = new Stripe(config.stripe.secretKey);
    
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, config.stripe.webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return c.json({ error: 'Invalid signature' }, 400);
    }

    const db = createDB(c.env);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, db);
        break;
      
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, db);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, db);
        break;
      
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice, db);
        break;
      
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, db);
        break;
      
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, db);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, db);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return c.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// Webhook handlers
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, db: Database) {
  try {
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;
    
    if (!customerId) {
      console.error('No customer ID in checkout session');
      return;
    }

    // Find user by Stripe customer ID
    const user = await db.select().from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .get();

    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    // Update user with subscription info
    await db.update(users)
      .set({
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: 'active',
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.id));

    console.log('Checkout session completed for user:', user.id);
  } catch (error) {
    console.error('Error handling checkout session completed:', error);
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, db: Database) {
  try {
    const customerId = subscription.customer as string;
    
    // Find user by Stripe customer ID
    const user = await db.select().from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .get();

    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    // Update subscription status
    await db.update(users)
      .set({
        subscriptionStatus: subscription.status as any,
        subscriptionCurrentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
        subscriptionCurrentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.id));

    // If subscription is active, reset credits based on plan
    if (subscription.status === 'active') {
      const planCredits = getPlanCredits(subscription.items.data[0]?.price?.id);
      if (planCredits > 0) {
        await CreditManager.resetCreditsForPlan(
          db, 
          user.id, 
          planCredits, 
          'subscription_updated'
        );
      }
    }

    console.log('Subscription updated for user:', user.id, 'Status:', subscription.status);
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, db: Database) {
  try {
    const customerId = subscription.customer as string;
    
    // Find user by Stripe customer ID
    const user = await db.select().from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .get();

    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    // Update user to free plan
    await db.update(users)
      .set({
        plan: 'free',
        subscriptionStatus: 'canceled',
        stripeSubscriptionId: null,
        subscriptionCurrentPeriodStart: null,
        subscriptionCurrentPeriodEnd: null,
        updatedAt: new Date().toISOString()
      })
      .where(eq(users.id, user.id));

    console.log('Subscription deleted for user:', user.id);
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
  }
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice, db: Database) {
  try {
    const customerId = invoice.customer as string;
    const subscriptionId = invoice.subscription as string;
    
    // Find user by Stripe customer ID
    const user = await db.select().from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .get();

    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    // Record payment
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      userId: user.id,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: 'succeeded',
      type: subscriptionId ? 'subscription' : 'one_time',
      description: `Invoice payment: ${invoice.id}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // If this is a subscription renewal, reset credits
    if (subscriptionId && invoice.billing_reason === 'subscription_cycle') {
      const planCredits = getPlanCredits(invoice.lines.data[0]?.price?.id);
      if (planCredits > 0) {
        await CreditManager.resetCreditsForPlan(
          db, 
          user.id, 
          planCredits, 
          'subscription_renewal'
        );
      }
    }

    console.log('Invoice payment succeeded for user:', user.id);
  } catch (error) {
    console.error('Error handling invoice payment succeeded:', error);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, db: Database) {
  try {
    const customerId = invoice.customer as string;
    
    // Find user by Stripe customer ID
    const user = await db.select().from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .get();

    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    // Record failed payment
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      userId: user.id,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_due,
      currency: invoice.currency,
      status: 'failed',
      type: 'subscription',
      description: `Failed invoice payment: ${invoice.id}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    console.log('Invoice payment failed for user:', user.id);
  } catch (error) {
    console.error('Error handling invoice payment failed:', error);
  }
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent, db: Database) {
  try {
    const customerId = paymentIntent.customer as string;
    
    if (!customerId) {
      console.error('No customer ID in payment intent');
      return;
    }

    // Find user by Stripe customer ID
    const user = await db.select().from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .get();

    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    // This would be for one-time credit purchases
    const creditsToAdd = getCreditsFromAmount(paymentIntent.amount);
    if (creditsToAdd > 0) {
      await CreditManager.addCredits(
        db,
        user.id,
        creditsToAdd,
        'purchase',
        paymentIntent.id,
        `Credit purchase: ${creditsToAdd} credits`
      );
    }

    console.log('Payment intent succeeded for user:', user.id);
  } catch (error) {
    console.error('Error handling payment intent succeeded:', error);
  }
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent, db: Database) {
  try {
    const customerId = paymentIntent.customer as string;
    
    if (!customerId) {
      console.error('No customer ID in payment intent');
      return;
    }

    // Find user by Stripe customer ID
    const user = await db.select().from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .get();

    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    console.log('Payment intent failed for user:', user.id);
  } catch (error) {
    console.error('Error handling payment intent failed:', error);
  }
}

// Helper functions
function getPlanCredits(priceId?: string): number {
  const planCredits: Record<string, number> = {
    'price_starter': 50,
    'price_pro': 150,
    'price_enterprise': 500
  };
  
  return planCredits[priceId || ''] || 0;
}

function getCreditsFromAmount(amount: number): number {
  // Convert cents to credits (example: $10 = 1000 cents = 100 credits)
  return Math.floor(amount / 10);
}

export { webhooks };