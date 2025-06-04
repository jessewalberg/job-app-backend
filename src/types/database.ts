import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { users, resumes, extractedJobs, coverLetters, apiUsage, subscriptions, payments, creditTransactions } from '../db/schema';

// Select types (what you get when querying)
export type User = InferSelectModel<typeof users>;
export type Resume = InferSelectModel<typeof resumes>;
export type ExtractedJob = InferSelectModel<typeof extractedJobs>;
export type CoverLetter = InferSelectModel<typeof coverLetters>;
export type ApiUsage = InferSelectModel<typeof apiUsage>;
export type Subscription = InferSelectModel<typeof subscriptions>;
export type Payment = InferSelectModel<typeof payments>;
export type CreditTransaction = InferSelectModel<typeof creditTransactions>;

// Insert types (what you need when inserting)
export type NewUser = InferInsertModel<typeof users>;
export type NewResume = InferInsertModel<typeof resumes>;
export type NewExtractedJob = InferInsertModel<typeof extractedJobs>;
export type NewCoverLetter = InferInsertModel<typeof coverLetters>;
export type NewApiUsage = InferInsertModel<typeof apiUsage>;
export type NewSubscription = InferInsertModel<typeof subscriptions>;
export type NewPayment = InferInsertModel<typeof payments>;
export type NewCreditTransaction = InferInsertModel<typeof creditTransactions>;

// Formatted job type (with parsed JSON fields)
export interface FormattedExtractedJob extends Omit<ExtractedJob, 'requirements' | 'benefits' | 'skills'> {
  requirements: string[];
  benefits: string[];
  skills: string[];
}

// Cover letter generation preferences
export interface CoverLetterPreferences {
  tone?: 'professional' | 'casual' | 'enthusiastic';
  focus?: 'experience' | 'skills' | 'achievements';
  length?: 'short' | 'medium' | 'long';
}

// Job extraction data - matches what AI service expects/returns
export interface JobExtractionData {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  salary?: string;
  jobType?: string;
  experience?: string;
  requirements?: string[];
  skills?: string[];
  benefits?: string[];
  industry?: string;
  remote?: string;
  pageType: string;
  confidence: number;
  url: string;
  domain: string;
}

// Validation error details
export interface ValidationErrorDetail {
  field: string;
  message: string;
} 