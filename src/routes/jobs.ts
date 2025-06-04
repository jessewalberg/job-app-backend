import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { AIService } from '../lib/ai';
import { CreditManager } from '../lib/credits';
import { extractJobSchema, paginationSchema } from '../lib/validation';
import { extractedJobs } from '../db/schema';
import { authContextMiddleware, getAuthContext } from '../middleware/authContext';
import { creditCheckMiddleware, deductCreditsAfterOperation } from '../middleware/creditCheck';
import { sendSuccess, sendError, sendNotFound, handleError } from '../lib/responses';
import type { AppEnv } from '../types/env';
import type { ExtractedJob, FormattedExtractedJob } from '../types/database';

const jobs = new Hono<AppEnv>();

// All routes require authentication
jobs.use('*', authContextMiddleware);

// Extract job information from HTML content
jobs.post('/extract-from-html', 
  creditCheckMiddleware.jobExtraction,
  zValidator('json', extractJobSchema), 
  async (c) => {
    const startTime = Date.now();
    
    try {
      const { html, url, title, maxTokens } = c.req.valid('json');
      const { user, db } = getAuthContext(c);

      // Extract job information using AI
      const ai = new AIService();
      const result = await ai.extractJobFromHTML(html, url, title, maxTokens);

      if (!result.success || !result.jobData) {
        return sendError(c, result.error || 'Failed to extract job information', 400, 
          [{ field: 'html', message: 'The AI service was unable to extract meaningful job information from the provided content.' }]);
      }

      // Save extracted job to database
      const jobId = crypto.randomUUID();
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

      // Deduct credits and get remaining
      const responseTime = Date.now() - startTime;
      const remainingCredits = await deductCreditsAfterOperation(
        c,
        CreditManager.COSTS.JOB_EXTRACTION,
        'extract-from-html',
        responseTime
      );

      return sendSuccess(c, {
        id: jobId,
        ...result.jobData,
        confidence: result.confidence,
        extractedFields: result.extractedFields,
        tokensUsed: result.tokensUsed,
        remainingCredits
      });

    } catch (error) {
      return handleError(c, error, 'Job extraction failed');
    }
  }
);

// Get user's extracted jobs with pagination
jobs.get('/extracted', zValidator('query', paginationSchema), async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const { page, limit } = c.req.valid('query');

    const offset = (page - 1) * limit;

    const jobs = await db.select()
      .from(extractedJobs)
      .where(eq(extractedJobs.userId, user.userId))
      .orderBy(desc(extractedJobs.extractedAt))
      .limit(limit)
      .offset(offset);

    // Parse JSON fields
    const formattedJobs: FormattedExtractedJob[] = jobs.map((job: ExtractedJob) => ({
      ...job,
      requirements: job.requirements ? JSON.parse(job.requirements) : [],
      benefits: job.benefits ? JSON.parse(job.benefits) : [],
      skills: job.skills ? JSON.parse(job.skills) : []
    }));

    return sendSuccess(c, {
      jobs: formattedJobs,
      pagination: {
        page,
        limit,
        total: jobs.length,
        hasMore: jobs.length === limit
      }
    });

  } catch (error) {
    return handleError(c, error, 'Failed to fetch extracted jobs');
  }
});

// Get specific extracted job by ID
jobs.get('/extracted/:id', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const jobId = c.req.param('id');

    const job = await db.select()
      .from(extractedJobs)
      .where(eq(extractedJobs.id, jobId))
      .get();

    if (!job || job.userId !== user.userId) {
      return sendNotFound(c, 'Job not found');
    }

    // Parse JSON fields
    const formattedJob: FormattedExtractedJob = {
      ...job,
      requirements: job.requirements ? JSON.parse(job.requirements) : [],
      benefits: job.benefits ? JSON.parse(job.benefits) : [],
      skills: job.skills ? JSON.parse(job.skills) : []
    };

    return sendSuccess(c, formattedJob);

  } catch (error) {
    return handleError(c, error, 'Failed to fetch job');
  }
});

// Delete extracted job
jobs.delete('/extracted/:id', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const jobId = c.req.param('id');

    const result = await db.delete(extractedJobs)
      .where(eq(extractedJobs.id, jobId))
      .returning();

    if (result.length === 0 || result[0].userId !== user.userId) {
      return sendNotFound(c, 'Job not found');
    }

    return sendSuccess(c, { message: 'Job deleted successfully' });

  } catch (error) {
    return handleError(c, error, 'Failed to delete job');
  }
});

export { jobs };