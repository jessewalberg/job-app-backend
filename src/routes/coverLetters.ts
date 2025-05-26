import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { createDB } from '../lib/db';
import { requireAuth } from '../lib/auth';
import { AIService } from '../lib/ai';
import { CreditManager } from '../lib/credits';
import { generateCoverLetterSchema } from '../lib/validation';
import { coverLetters, resumes, users } from '../db/schema';
import type { Env, JWTPayload } from '../types/env';

const coverLetterRoutes = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

coverLetterRoutes.use('*', requireAuth);

coverLetterRoutes.post('/generate-from-content', zValidator('json', generateCoverLetterSchema), async (c) => {
  try {
    const { extractedContent, resumeId, preferences } = c.req.valid('json');
    const user = c.get('user');
    const db = createDB(c.env);

    // Check credits
    const hasCredits = await CreditManager.checkCredits(db, user.userId, CreditManager.COSTS.COVER_LETTER_GENERATION);
    if (!hasCredits) {
      return c.json({ error: 'Insufficient credits' }, 402);
    }

    // Get resume
    const resume = await db.select().from(resumes)
      .where(eq(resumes.id, resumeId)).get();
    
    if (!resume || resume.userId !== user.userId) {
      return c.json({ error: 'Resume not found' }, 404);
    }

    // Get resume content from R2 or use extracted text
    let resumeContent = resume.extractedText;
    if (!resumeContent) {
      const resumeFile = await c.env.BUCKET.get(resume.fileKey);
      if (!resumeFile) {
        return c.json({ error: 'Resume file not found' }, 404);
      }
      resumeContent = await resumeFile.text();
    }

    // Generate cover letter
    const ai = new AIService(c.env.OPENAI_API_KEY);
    const coverLetterContent = await ai.generateCoverLetter(extractedContent, resumeContent, preferences);

    // Save cover letter
    const coverLetterId = crypto.randomUUID();
    await db.insert(coverLetters).values({
      id: coverLetterId,
      userId: user.userId,
      resumeId,
      content: coverLetterContent.content,
      creditsUsed: CreditManager.COSTS.COVER_LETTER_GENERATION,
      createdAt: new Date().toISOString()
    });

    // Deduct credits
    await CreditManager.deductCredits(
      db, 
      user.userId, 
      CreditManager.COSTS.COVER_LETTER_GENERATION, 
      'generate-from-content',
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    // Get updated user credits
    const updatedUser = await db.select().from(users).where(eq(users.id, user.userId)).get();

    return c.json({
      success: true,
      data: {
        id: coverLetterId,
        content: coverLetterContent.content,
        creditsUsed: CreditManager.COSTS.COVER_LETTER_GENERATION,
        remainingCredits: updatedUser?.credits || 0
      }
    });

  } catch (error) {
    console.error('Cover letter generation error:', error);
    return c.json({ error: 'Failed to generate cover letter' }, 500);
  }
});

coverLetterRoutes.get('/history', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    const coverLetterHistory = await db.select({
      id: coverLetters.id,
      content: coverLetters.content,
      creditsUsed: coverLetters.creditsUsed,
      createdAt: coverLetters.createdAt,
      resumeFilename: resumes.filename
    })
    .from(coverLetters)
    .leftJoin(resumes, eq(coverLetters.resumeId, resumes.id))
    .where(eq(coverLetters.userId, user.userId))
    .orderBy(desc(coverLetters.createdAt))
    .limit(50);

    return c.json({
      success: true,
      data: coverLetterHistory
    });

  } catch (error) {
    console.error('Get cover letter history error:', error);
    return c.json({ error: 'Failed to get cover letter history' }, 500);
  }
});

coverLetterRoutes.get('/:id', async (c) => {
  try {
    const coverLetterId = c.req.param('id');
    const user = c.get('user');
    const db = createDB(c.env);

    const coverLetter = await db.select()
      .from(coverLetters)
      .where(eq(coverLetters.id, coverLetterId))
      .get();

    if (!coverLetter || coverLetter.userId !== user.userId) {
      return c.json({ error: 'Cover letter not found' }, 404);
    }

    return c.json({
      success: true,
      data: coverLetter
    });

  } catch (error) {
    console.error('Get cover letter error:', error);
    return c.json({ error: 'Failed to get cover letter' }, 500);
  }
});

coverLetterRoutes.delete('/:id', async (c) => {
  try {
    const coverLetterId = c.req.param('id');
    const user = c.get('user');
    const db = createDB(c.env);

    const result = await db.delete(coverLetters)
      .where(eq(coverLetters.id, coverLetterId))
      .returning();

    if (result.length === 0) {
      return c.json({ error: 'Cover letter not found' }, 404);
    }

    if (result[0].userId !== user.userId) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    return c.json({
      success: true,
      message: 'Cover letter deleted successfully'
    });

  } catch (error) {
    console.error('Delete cover letter error:', error);
    return c.json({ error: 'Failed to delete cover letter' }, 500);
  }
});

export { coverLetterRoutes };