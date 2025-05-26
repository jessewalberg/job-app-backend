import Stripe from 'stripe';
import type { Env } from '../types/env';

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  credits: number;
  stripePriceId: string;
  features: string[];
  popular?: boolean;
}

export const PRICING_PLANS: Record<string, PricingPlan> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic features',
    price: 0,
    credits: 3,
    stripePriceId: '',
    features: [
      '3 free credits',
      'Basic cover letter generation',
      'Job extraction from web pages',
      'Resume upload and processing'
    ]
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for job seekers',
    price: 9.99,
    credits: 50,
    stripePriceId: 'price_starter_monthly', // Replace with actual Stripe price ID
    features: [
      '50 credits per month',
      'Advanced AI cover letters',
      'Multiple resume management',
      'Job extraction history',
      'Email support'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Professional',
    description: 'For active job hunters',
    price: 19.99,
    credits: 150,
    stripePriceId: 'price_pro_monthly', // Replace with actual Stripe price ID
    features: [
      '150 credits per month',
      'Premium AI models',
      'Unlimited resume storage',
      'Advanced customization options',
      'Priority support',
      'Usage analytics'
    ],
    popular: true
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For teams and recruiters',
    price: 49.99,
    credits: 500,
    stripePriceId: 'price_enterprise_monthly', // Replace with actual Stripe price ID
    features: [
      '500 credits per month',
      'Team collaboration',
      'Bulk operations',
      'API access',
      'Custom integrations',
      'Dedicated support',
      'Advanced analytics'
    ]
  }
};

export const CREDIT_PACKAGES = {
  credits_10: {
    id: 'credits_10',
    name: '10 Credits',
    credits: 10,
    price: 2.99,
    stripePriceId: 'price_credits_10' // Replace with actual Stripe price ID
  },
  credits_25: {
    id: 'credits_25',
    name: '25 Credits',
    credits: 25,
    price: 6.99,
    stripePriceId: 'price_credits_25' // Replace with actual Stripe price ID
  },
  credits_50: {
    id: 'credits_50',
    name: '50 Credits',
    credits: 50,
    price: 12.99,
    stripePriceId: 'price_credits_50' // Replace with actual Stripe price ID
  },
  credits_100: {
    id: 'credits_100',
    name: '100 Credits',
    credits: 100,
    price: 24.99,
    stripePriceId: 'price_credits_100' // Replace with actual Stripe price ID
  }
};

export class StripeService {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2023-10-16'
    });
  }

  async createCustomer(email: string, name: string, userId: string): Promise<Stripe.Customer> {
    return await this.stripe.customers.create({
      email,
      name,
      metadata: {
        userId
      }
    });
  }

  async createSubscription(customerId: string, priceId: string): Promise<Stripe.Subscription> {
    return await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent']
    });
  }

  async createPaymentIntent(amount: number, customerId: string, metadata: Record<string, string>): Promise<Stripe.PaymentIntent> {
    return await this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      customer: customerId,
      metadata,
      automatic_payment_methods: {
        enabled: true
      }
    });
  }

  async createCheckoutSession({
    customerId,
    priceId,
    successUrl,
    cancelUrl,
    mode = 'subscription',
    metadata = {}
  }: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    mode?: 'subscription' | 'payment';
    metadata?: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata
    };

    if (mode === 'subscription') {
      sessionConfig.subscription_data = {
        metadata
      };
    }

    return await this.stripe.checkout.sessions.create(sessionConfig);
  }

  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return await this.stripe.subscriptions.cancel(subscriptionId);
  }

  async updateSubscription(subscriptionId: string, priceId: string): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    
    return await this.stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: priceId
        }
      ]
    });
  }

  async constructEvent(payload: string, signature: string, webhookSecret: string): Promise<Stripe.Event> {
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    return await this.stripe.customers.retrieve(customerId) as Stripe.Customer;
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return await this.stripe.subscriptions.retrieve(subscriptionId);
  }

  async createBillingPortalSession(customerId: string, returnUrl: string): Promise<Stripe.BillingPortal.Session> {
    return await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });
  }

  async getUpcomingInvoice(customerId: string, subscriptionId?: string): Promise<Stripe.UpcomingInvoice> {
    const params: Stripe.InvoiceRetrieveUpcomingParams = {
      customer: customerId
    };
    
    if (subscriptionId) {
      params.subscription = subscriptionId;
    }

    return await this.stripe.invoices.retrieveUpcoming(params);
  }
}