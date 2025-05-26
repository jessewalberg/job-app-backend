import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

export const extractJobSchema = z.object({
  html: z.string().min(100, 'HTML content too short'),
  url: z.string().url('Invalid URL'),
  title: z.string().min(1, 'Title is required'),
  maxTokens: z.number().optional().default(15000)
});

export const generateCoverLetterSchema = z.object({
  extractedContent: z.object({
    title: z.string().optional(),
    company: z.string().optional(),
    location: z.string().optional(),
    description: z.string().optional(),
    salary: z.string().optional(),
    requirements: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    pageType: z.string(),
    confidence: z.number(),
    url: z.string().url(),
    domain: z.string()
  }),
  resumeId: z.string().uuid('Invalid resume ID'),
  preferences: z.object({
    tone: z.enum(['professional', 'casual', 'enthusiastic']).optional(),
    focus: z.enum(['experience', 'skills', 'achievements']).optional(),
    length: z.enum(['short', 'medium', 'long']).optional()
  }).optional()
});

export const uploadResumeSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  fileSize: z.number().positive('File size must be positive')
});

export const updateUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  email: z.string().email('Invalid email address').optional()
});

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20)
});

export const createPaymentIntentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().default('usd'),
  metadata: z.record(z.string()).optional()
});

export const webhookSchema = z.object({
  type: z.string(),
  data: z.object({
    object: z.any()
  })
});