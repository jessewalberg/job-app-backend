import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { createDB } from '../lib/db';
import { StripeService, PRICING_PLANS } from '../lib/stripe';
import { CreditManager } from '../lib/credits';
import { users, payments, subscriptions } from '../db/schema';
import type { Env } from '../types/env';

const webhooks = new Hono<{ Bindings: Env }>();

// Stripe webhook handler
webhooks.post('/stripe', async (c) => {
  try {
    const body = await c.req.text();
    const signature = c.req.header('stripe-signature');

    if (!signature) {
      return c.json({ error: 'No signature provided' }, 400);
    }

    const stripe = new StripeService(c.env.STRIPE_SECRET_KEY);
    const event = await stripe.constructEvent(body, signature, c.env.STRIPE_WEBHOOK_SECRET);

    console.log('Received Stripe webhook:', event.type);

    const db = createDB(c.env);

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, db);
        break;

      case 'customer.subscription.created':
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
    return c.json({ error: 'Webhook handler failed' }, 400);
  }
});

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, db: any) {
  const userId = session.metadata?.userId;
  if (!userId) return;

  console.log('Processing checkout session completed for user:', userId);

  // Create payment record
  await db.insert(payments).values({
    id: crypto.randomUUID(),
    userId,
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent as string,
    amount: session.amount_total || 0,
    currency: session.currency || 'usd',
    status: 'succeeded',
    type: session.mode === 'subscription' ? 'subscription' : 'credits',
    metadata: JSON.stringify(session.metadata),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  // Handle credit purchase
  if (session.mode === 'payment' && session.metadata?.type === 'credits') {
    const credits = parseInt(session.metadata.credits || '0');
    if (credits > 0) {
      await CreditManager.addCredits(db, userId, credits);
      
      // Update payment record with granted credits
      await db.update(payments)
        .set({ 
          creditsGranted: credits,
          updatedAt: new Date().toISOString()
        })
        .where(eq(payments.stripeSessionId, session.id));
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, db: any) {
  const customerId = subscription.customer as string;
  
  // Find user by Stripe customer ID
  const user = await db.select().from(users)
    .where(eq(users.stripeCustomerId, customerId)).get();
  
  if (!user) return;

  console.log('Processing subscription updated for user:', user.id);

  // Get price ID to determine plan
  const priceId = subscription.items.data[0]?.price.id;
  let planId = 'free';
  
  // Find matching plan
  for (const [key, plan] of Object.entries(PRICING_PLANS)) {
    if (plan.stripePriceId === priceId) {
      planId = key;
      break;
    }
  }

  // Update user subscription info
  await db.update(users)
    .set({
      plan: planId,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      subscriptionCurrentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
      subscriptionCurrentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      updatedAt: new Date().toISOString()
    })
    .where(eq(users.id, user.id));

  // Upsert subscription record
  const existingSubscription = await db.select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .get();

  const subscriptionData = {
    userId: user.id,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    status: subscription.status,
    currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    updatedAt: new Date().toISOString()
  };

  if (existingSubscription) {
    await db.update(subscriptions)
      .set(subscriptionData)
      .where(eq(subscriptions.id, existingSubscription.id));
  } else {
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      ...subscriptionData,
      createdAt: new Date().toISOString()
    });
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, db: any) {
  const customerId = subscription.customer as string;
  
  // Find user by Stripe customer ID
  const user = await db.select().from(users)
    .where(eq(users.stripeCustomerId, customerId)).get();
  
  if (!user) return;

  console.log('Processing subscription deleted for user:', user.id);

  // Update user to free plan
  await db.update(users)
    .set({
      plan: 'free',
      subscriptionStatus: 'canceled',
      updatedAt: new Date().toISOString()
    })
    .where(eq(users.id, user.id));

  // Update subscription record
  await db.update(subscriptions)
    .set({
      status: 'canceled',
      canceledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice, db: any) {
  const customerId = invoice.customer as string;
  const subscriptionId = invoice.subscription as string;

  // Find user by Stripe customer ID
  const user = await db.select().from(users)
    .where(eq(users.stripeCustomerId, customerId)).get();
  
  if (!user) return;

  console.log('Processing invoice payment succeeded for user:', user.id);

  // Get subscription details to determine credits to grant
  const subscription = await db.select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
    .get();

  if (subscription) {
    // Find the plan to get credit amount
    let creditsToGrant = 0;
    for (const plan of Object.values(PRICING_PLANS)) {
      if (plan.stripePriceId === subscription.stripePriceId) {
        creditsToGrant = plan.credits;
        break;
      }
    }

    // Grant monthly credits
    if (creditsToGrant > 0) {
      await db.update(users)
        .set({
          credits: creditsToGrant, // Reset to plan amount each billing period
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, user.id));
    }
  }

  // Create payment record
  await db.insert(payments).values({
    id: crypto.randomUUID(),
    userId: user.id,
    stripePaymentIntentId: invoice.payment_intent as string,
    amount: invoice.amount_paid,
    currency: invoice.currency,
    status: 'succeeded',
    type: 'subscription',
    creditsGranted: 0, // Credits are granted via subscription logic above
    metadata: JSON.stringify({
      invoiceId: invoice.id,
      subscriptionId
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, db: any) {
  const customerId = invoice.customer as string;

  // Find user by Stripe customer ID
  const user = await db.select().from(users)
    .where(eq(users.stripeCustomerId, customerId)).get();
  
  if (!user) return;

  console.log('Processing invoice payment failed for user:', user.id);

  // Update subscription status
  await db.update(users)
    .set({
      subscriptionStatus: 'past_due',
      updatedAt: new Date().toISOString()
    })
    .where(eq(users.id, user.id));

  // Create payment record
  await db.insert(payments).values({
    id: crypto.randomUUID(),
    userId: user.id,
    stripePaymentIntentId: invoice.payment_intent as string,
    amount: invoice.amount_due,
    currency: invoice.currency,
    status: 'failed',
    type: 'subscription',
    metadata: JSON.stringify({
      invoiceId: invoice.id,
      failureReason: 'payment_failed'
    }),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent, db: any) {
  const customerId = paymentIntent.customer as string;
  
  if (!customerId) return;

  // Find user by Stripe customer ID
  const user = await db.select().from(users)
    .where(eq(users.stripeCustomerId, customerId)).get();
  
  if (!user) return;

  console.log('Processing payment intent succeeded for user:', user.id);

  // Update existing payment record or create new one
  const existingPayment = await db.select()
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, paymentIntent.id))
    .get();

  if (existingPayment) {
    await db.update(payments)
      .set({
        status: 'succeeded',
        updatedAt: new Date().toISOString()
      })
      .where(eq(payments.id, existingPayment.id));
  }
}

async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent, db: any) {
  const customerId = paymentIntent.customer as string;
  
  if (!customerId) return;

  // Find user by Stripe customer ID
  const user = await db.select().from(users)
    .where(eq(users.stripeCustomerId, customerId)).get();
  
  if (!user) return;

  console.log('Processing payment intent failed for user:', user.id);

  // Update existing payment record
  const existingPayment = await db.select()
    .from(payments)
    .where(eq(payments.stripePaymentIntentId, paymentIntent.id))
    .get();

  if (existingPayment) {
    await db.update(payments)
      .set({
        status: 'failed',
        metadata: JSON.stringify({
          ...JSON.parse(existingPayment.metadata || '{}'),
          failureReason: paymentIntent.last_payment_error?.message || 'payment_failed'
        }),
        updatedAt: new Date().toISOString()
      })
      .where(eq(payments.id, existingPayment.id));
  }
}

export { webhooks };