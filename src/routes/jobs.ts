import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { createDB } from '../lib/db';
import { requireAuth, generateUUID } from '../lib/auth';
import { AIService } from '../lib/ai';
import { CreditManager } from '../lib/credits';
import { extractJobSchema, paginationSchema } from '../lib/validation';
import { extractedJobs } from '../db/schema';
import type { Env, JWTPayload } from '../types/env';

const jobs = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

// All routes require authentication
jobs.use('*', requireAuth);

// Extract job information from HTML content
jobs.post('/extract-from-html', zValidator('json', extractJobSchema), async (c) => {
  const startTime = Date.now();
  
  try {
    const { html, url, title, maxTokens } = c.req.valid('json');
    const user = c.get('user');
    const db = createDB(c.env);

    // Check if user has enough credits
    const hasCredits = await CreditManager.checkCredits(
      db, 
      user.userId, 
      CreditManager.COSTS.JOB_EXTRACTION
    );
    
    if (!hasCredits) {
      return c.json({ 
        success: false, 
        error: 'Insufficient credits. Please upgrade your plan or purchase more credits.' 
      }, 402);
    }

    // Extract job information using AI
    const ai = new AIService(c.env.OPENAI_API_KEY);
    const result = await ai.extractJobFromHTML(html, url, title, maxTokens);

    if (!result.success || !result.jobData) {
      return c.json({
        success: false,
        error: result.error || 'Failed to extract job information',
        details: 'The AI service was unable to extract meaningful job information from the provided content.'
      }, 400);
    }

    // Save extracted job to database
    const jobId = generateUUID();
    const extractedJob = await db.insert(extractedJobs).values({
      id: jobId,
      userId: user.userId,
      url,
      title: result.jobData.title || null,
      company: result.jobData.company || null,
      location: result.jobData.location || null,
      salary: result.jobData.salary || null,
      jobType: result.jobData.jobType || null,
      experience: result.jobData.experience || null,
      requirements: result.jobData.requirements ? JSON.stringify(result.jobData.requirements) : null,
      description: result.jobData.description || null,
      benefits: result.jobData.benefits ? JSON.stringify(result.jobData.benefits) : null,
      skills: result.jobData.skills ? JSON.stringify(result.jobData.skills) : null,
      industry: result.jobData.industry || null,
      remote: result.jobData.remote || null,
      pageType: result.jobData.pageType || 'general',
      confidence: result.confidence,
      extractedAt: new Date().toISOString()
    }).returning();

    // Deduct credits and log usage
    const responseTime = Date.now() - startTime;
    await CreditManager.deductCredits(
      db, 
      user.userId, 
      CreditManager.COSTS.JOB_EXTRACTION, 
      'extract-from-html',
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent'),
      responseTime.toString()
    );

    // Get updated user credits
    const remainingCredits = await CreditManager.getUserCredits(db, user.userId);

    return c.json({
      success: true,
      data: {
        id: jobId,
        ...result.jobData,
        confidence: result.confidence,
        extractedFields: result.extractedFields,
        tokensUsed: result.tokensUsed,
        remainingCredits
      }
    });

  } catch (error) {
    console.error('Job extraction error:', error);
    
    // Log failed usage for analytics
    const responseTime = Date.now() - startTime;
    try {
      const user = c.get('user');
      const db = createDB(c.env);
      await db.insert(require('../db/schema').apiUsage).values({
        id: generateUUID(),
        userId: user.userId,
        endpoint: 'extract-from-html',
        creditsUsed: 0,
        success: false,
        responseTime,
        createdAt: new Date().toISOString()
      });
    } catch (logError) {
      console.error('Failed to log error usage:', logError);
    }

    return c.json({ 
      success: false, 
      error: 'Job extraction failed',
      details: error instanceof Error ? error.message : 'Unknown error occurred'
    }, 500);
  }
});

// Get user's extracted jobs with pagination
jobs.get('/extracted', zValidator('query', paginationSchema), async (c) => {
  try {
    const user = c.get('user');
    const { page, limit } = c.req.valid('query');
    const db = createDB(c.env);

    const offset = (page - 1) * limit;

    const jobs = await db.select()
      .from(extractedJobs)
      .where(eq(extractedJobs.userId, user.userId))
      .orderBy(desc(extractedJobs.extractedAt))
      .limit(limit)
      .offset(offset);

    // Parse JSON fields
    const formattedJobs = jobs.map(job => ({
      ...job,
      requirements: job.requirements ? JSON.parse(job.requirements) : [],
      benefits: job.benefits ? JSON.parse(job.benefits) : [],
      skills: job.skills ? JSON.parse(job.skills) : []
    }));

    return c.json({
      success: true,
      data: {
        jobs: formattedJobs,
        pagination: {
          page,
          limit,
          total: jobs.length,
          hasMore: jobs.length === limit
        }
      }
    });

  } catch (error) {
    console.error('Error fetching extracted jobs:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch extracted jobs' 
    }, 500);
  }
});

// Get specific extracted job by ID
jobs.get('/extracted/:id', async (c) => {
  try {
    const user = c.get('user');
    const jobId = c.req.param('id');
    const db = createDB(c.env);

    const job = await db.select()
      .from(extractedJobs)
      .where(eq(extractedJobs.id, jobId))
      .get();

    if (!job || job.userId !== user.userId) {
      return c.json({ 
        success: false, 
        error: 'Job not found' 
      }, 404);
    }

    // Parse JSON fields
    const formattedJob = {
      ...job,
      requirements: job.requirements ? JSON.parse(job.requirements) : [],
      benefits: job.benefits ? JSON.parse(job.benefits) : [],
      skills: job.skills ? JSON.parse(job.skills) : []
    };

    return c.json({
      success: true,
      data: formattedJob
    });

  } catch (error) {
    console.error('Error fetching job:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch job' 
    }, 500);
  }
});

// Delete extracted job
jobs.delete('/extracted/:id', async (c) => {
  try {
    const user = c.get('user');
    const jobId = c.req.param('id');
    const db = createDB(c.env);

    const result = await db.delete(extractedJobs)
      .where(eq(extractedJobs.id, jobId))
      .returning();

    if (!result[0] || result[0].userId !== user.userId) {
      return c.json({ 
        success: false, 
        error: 'Job not found' 
      }, 404);
    }

    return c.json({
      success: true,
      message: 'Job deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting job:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to delete job' 
    }, 500);
  }
});

export { jobs };