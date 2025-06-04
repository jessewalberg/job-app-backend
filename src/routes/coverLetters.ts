import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { AIService } from '../lib/ai';
import { CreditManager } from '../lib/credits';
import { generateCoverLetterSchema, paginationSchema } from '../lib/validation';
import { coverLetters, resumes } from '../db/schema';
import { authContextMiddleware, getAuthContext } from '../middleware/authContext';
import { creditCheckMiddleware, deductCreditsAfterOperation } from '../middleware/creditCheck';
import { sendSuccess, sendError, sendNotFound, handleError } from '../lib/responses';
import { getConfig } from '../lib/config';
import type { AppEnv } from '../types/env';

const coverLetterRoutes = new Hono<AppEnv>();

// All routes require authentication
coverLetterRoutes.use('*', authContextMiddleware);

// Generate cover letter
coverLetterRoutes.post('/generate', 
  creditCheckMiddleware.coverLetterGeneration,
  zValidator('json', generateCoverLetterSchema), 
  async (c) => {
    const startTime = Date.now();
    
    try {
      const { extractedContent, resumeId, preferences } = c.req.valid('json');
      const { user, db } = getAuthContext(c);
      const config = getConfig();

      // Get resume
      const resume = await db.select()
        .from(resumes)
        .where(eq(resumes.id, resumeId))
        .get();

      if (!resume || resume.userId !== user.userId) {
        return sendNotFound(c, 'Resume not found');
      }

      // Get resume content from R2
      console.log(config.storage.bucket)
      const resumeFile = await config.storage.bucket.get(resume.fileKey);
      if (!resumeFile) {
        return sendError(c, 'Resume file not found', 404);
      }

      // Check MIME type and read file appropriately
      const ai = new AIService();
      let resumeText: string;
      if (resume.mimeType.includes('pdf')) {
        // For PDFs, we need to extract text using AI service
        const fileBuffer = await resumeFile.arrayBuffer();
        // Convert ArrayBuffer to base64 using Web APIs
        const uint8Array = new Uint8Array(fileBuffer);
        const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
        const base64Content = btoa(binaryString);
        resumeText = await ai.extractTextFromResume(base64Content, resume.mimeType);
      } else {
        // For text-based files, we can read as text
        resumeText = await resumeFile.text();
      }

      // Generate cover letter using AI
      const result = await ai.generateCoverLetter(extractedContent, resumeText, preferences);

      // Save cover letter to database
      const coverLetterId = crypto.randomUUID();
      const newCoverLetter = await db.insert(coverLetters).values({
        id: coverLetterId,
        userId: user.userId,
        resumeId,
        jobTitle: extractedContent.title || null,
        company: extractedContent.company || null,
        content: result.content,
        creditsUsed: CreditManager.COSTS.COVER_LETTER_GENERATION,
        preferences: preferences ? JSON.stringify(preferences) : null,
        createdAt: new Date().toISOString()
      }).returning();

      // Deduct credits and get remaining
      const responseTime = Date.now() - startTime;
      const remainingCredits = await deductCreditsAfterOperation(
        c,
        CreditManager.COSTS.COVER_LETTER_GENERATION,
        'generate-cover-letter',
        responseTime
      );

      return sendSuccess(c, {
        coverLetter: newCoverLetter[0],
        tokensUsed: result.tokensUsed,
        remainingCredits
      }, 201);

    } catch (error) {
      return handleError(c, error, 'Cover letter generation failed');
    }
  }
);

// Get user's cover letters
coverLetterRoutes.get('/', zValidator('query', paginationSchema), async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const { page, limit } = c.req.valid('query');

    const offset = (page - 1) * limit;

    const userCoverLetters = await db.select()
      .from(coverLetters)
      .where(eq(coverLetters.userId, user.userId))
      .orderBy(desc(coverLetters.createdAt))
      .limit(limit)
      .offset(offset);

    return sendSuccess(c, {
      coverLetters: userCoverLetters,
      pagination: {
        page,
        limit,
        total: userCoverLetters.length,
        hasMore: userCoverLetters.length === limit
      }
    });

  } catch (error) {
    return handleError(c, error, 'Failed to fetch cover letters');
  }
});

// Get specific cover letter
coverLetterRoutes.get('/:id', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const coverLetterId = c.req.param('id');

    const coverLetter = await db.select()
      .from(coverLetters)
      .where(eq(coverLetters.id, coverLetterId))
      .get();

    if (!coverLetter || coverLetter.userId !== user.userId) {
      return sendNotFound(c, 'Cover letter not found');
    }

    return sendSuccess(c, coverLetter);

  } catch (error) {
    return handleError(c, error, 'Failed to fetch cover letter');
  }
});

// Delete cover letter
coverLetterRoutes.delete('/:id', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const coverLetterId = c.req.param('id');

    const result = await db.delete(coverLetters)
      .where(eq(coverLetters.id, coverLetterId))
      .returning();

    if (result.length === 0 || result[0].userId !== user.userId) {
      return sendNotFound(c, 'Cover letter not found');
    }

    return sendSuccess(c, { message: 'Cover letter deleted successfully' });

  } catch (error) {
    return handleError(c, error, 'Failed to delete cover letter');
  }
});

export { coverLetterRoutes };