import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  credits: integer('credits').default(3),
  plan: text('plan', { enum: ['free', 'starter', 'pro', 'enterprise'] }).default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStatus: text('subscription_status', { 
    enum: ['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid'] 
  }),
  subscriptionCurrentPeriodStart: text('subscription_current_period_start'),
  subscriptionCurrentPeriodEnd: text('subscription_current_period_end'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const resumes = sqliteTable('resumes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  fileKey: text('file_key').notNull(), // R2 storage key
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  extractedText: text('extracted_text'), // Cached extracted text
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const extractedJobs = sqliteTable('extracted_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title'),
  company: text('company'),
  location: text('location'),
  salary: text('salary'),
  jobType: text('job_type'),
  experience: text('experience'),
  requirements: text('requirements'), // JSON array
  description: text('description'),
  benefits: text('benefits'), // JSON array
  skills: text('skills'), // JSON array
  industry: text('industry'),
  remote: text('remote'),
  pageType: text('page_type'),
  confidence: real('confidence'),
  extractedAt: text('extracted_at').default(sql`CURRENT_TIMESTAMP`)
});

export const coverLetters = sqliteTable('cover_letters', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  extractedJobId: text('extracted_job_id').references(() => extractedJobs.id, { onDelete: 'set null' }),
  resumeId: text('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
  jobTitle: text('job_title'),
  company: text('company'),
  content: text('content').notNull(),
  creditsUsed: integer('credits_used').notNull(),
  preferences: text('preferences'), // JSON object with tone, focus, length
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const apiUsage = sqliteTable('api_usage', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  creditsUsed: integer('credits_used').default(0),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  responseTime: integer('response_time'), // milliseconds
  success: integer('success', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  stripePriceId: text('stripe_price_id').notNull(),
  status: text('status', { 
    enum: ['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid'] 
  }).notNull(),
  currentPeriodStart: text('current_period_start').notNull(),
  currentPeriodEnd: text('current_period_end').notNull(),
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).default(false),
  canceledAt: text('canceled_at'),
  trialStart: text('trial_start'),
  trialEnd: text('trial_end'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stripePaymentIntentId: text('stripe_payment_intent_id').unique(),
  stripeSessionId: text('stripe_session_id').unique(),
  stripeInvoiceId: text('stripe_invoice_id'),
  amount: integer('amount').notNull(), // Amount in cents
  currency: text('currency').default('usd'),
  status: text('status', { 
    enum: ['pending', 'succeeded', 'failed', 'canceled', 'refunded'] 
  }).notNull(),
  type: text('type', { enum: ['subscription', 'credits', 'one_time'] }).notNull(),
  creditsGranted: integer('credits_granted').default(0),
  description: text('description'),
  metadata: text('metadata'), // JSON string for additional data
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

export const creditTransactions = sqliteTable('credit_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['earned', 'spent', 'refunded', 'expired'] }).notNull(),
  amount: integer('amount').notNull(), // Positive for earned, negative for spent
  balance: integer('balance').notNull(), // Balance after transaction
  source: text('source').notNull(), // 'subscription', 'purchase', 'api_usage', etc.
  sourceId: text('source_id'), // Related payment ID, API usage ID, etc.
  description: text('description'),
  metadata: text('metadata'), // JSON string
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});