import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { createDB } from '../lib/db';
import { requireAuth } from '../lib/auth';
import { AIService } from '../lib/ai';
import { CreditManager } from '../lib/credits';
import { uploadResumeSchema } from '../lib/validation';
import { resumes } from '../db/schema';
import type { Env, JWTPayload } from '../types/env';

const resumeRoutes = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

resumeRoutes.use('*', requireAuth);

resumeRoutes.post('/upload', zValidator('json', uploadResumeSchema), async (c) => {
  try {
    const { filename, mimeType, fileSize } = c.req.valid('json');
    const user = c.get('user');
    const db = createDB(c.env);

    // Check credits for upload processing
    const hasCredits = await CreditManager.checkCredits(db, user.userId, CreditManager.COSTS.RESUME_UPLOAD);
    if (!hasCredits) {
      return c.json({ error: 'Insufficient credits' }, 402);
    }

    // Generate unique file key
    const fileKey = `resumes/${user.userId}/${crypto.randomUUID()}-${filename}`;
    const resumeId = crypto.randomUUID();

    // Generate pre-signed URL for file upload
    const uploadUrl = await c.env.BUCKET.createMultipartUpload(fileKey);

    // Save resume metadata
    await db.insert(resumes).values({
      id: resumeId,
      userId: user.userId,
      filename,
      fileKey,
      fileSize,
      mimeType,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return c.json({
      success: true,
      data: {
        resumeId,
        uploadUrl: uploadUrl.uploadId, // This would be the actual upload URL in production
        fileKey
      }
    });

  } catch (error) {
    console.error('Resume upload error:', error);
    return c.json({ error: 'Failed to initiate resume upload' }, 500);
  }
});

resumeRoutes.post('/:id/process', async (c) => {
  try {
    const resumeId = c.req.param('id');
    const user = c.get('user');
    const db = createDB(c.env);

    // Get resume
    const resume = await db.select().from(resumes)
      .where(eq(resumes.id, resumeId)).get();
    
    if (!resume || resume.userId !== user.userId) {
      return c.json({ error: 'Resume not found' }, 404);
    }

    // Check if already processed
    if (resume.extractedText) {
      return c.json({
        success: true,
        data: {
          resumeId,
          extractedText: resume.extractedText
        }
      });
    }

    // Check credits for processing
    const hasCredits = await CreditManager.checkCredits(db, user.userId, CreditManager.COSTS.RESUME_ANALYSIS);
    if (!hasCredits) {
      return c.json({ error: 'Insufficient credits' }, 402);
    }

    // Get file from R2
    const resumeFile = await c.env.BUCKET.get(resume.fileKey);
    if (!resumeFile) {
      return c.json({ error: 'Resume file not found' }, 404);
    }

    const fileContent = await resumeFile.text();

    // Extract text using AI
    const ai = new AIService(c.env.OPENAI_API_KEY);
    const extractedText = await ai.extractTextFromResume(fileContent, resume.mimeType);

    // Update resume with extracted text
    await db.update(resumes)
      .set({ 
        extractedText,
        updatedAt: new Date().toISOString()
      })
      .where(eq(resumes.id, resumeId));

    // Deduct credits
    await CreditManager.deductCredits(
      db, 
      user.userId, 
      CreditManager.COSTS.RESUME_ANALYSIS, 
      'process-resume',
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({
      success: true,
      data: {
        resumeId,
        extractedText,
        creditsUsed: CreditManager.COSTS.RESUME_ANALYSIS
      }
    });

  } catch (error) {
    console.error('Resume processing error:', error);
    return c.json({ error: 'Failed to process resume' }, 500);
  }
});

resumeRoutes.get('/', async (c) => {
  try {
    const user = c.get('user');
    const db = createDB(c.env);

    const userResumes = await db.select({
      id: resumes.id,
      filename: resumes.filename,
      fileSize: resumes.fileSize,
      mimeType: resumes.mimeType,
      extractedText: resumes.extractedText,
      createdAt: resumes.createdAt,
      updatedAt: resumes.updatedAt
    })
    .from(resumes)
    .where(eq(resumes.userId, user.userId))
    .orderBy(desc(resumes.createdAt));

    return c.json({
      success: true,
      data: userResumes.map(resume => ({
        ...resume,
        hasExtractedText: !!resume.extractedText,
        extractedText: resume.extractedText ? resume.extractedText.substring(0, 200) + '...' : null
      }))
    });

  } catch (error) {
    console.error('Get resumes error:', error);
    return c.json({ error: 'Failed to get resumes' }, 500);
  }
});

resumeRoutes.get('/:id', async (c) => {
  try {
    const resumeId = c.req.param('id');
    const user = c.get('user');
    const db = createDB(c.env);

    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return c.json({ error: 'Resume not found' }, 404);
    }

    return c.json({
      success: true,
      data: resume
    });

  } catch (error) {
    console.error('Get resume error:', error);
    return c.json({ error: 'Failed to get resume' }, 500);
  }
});

resumeRoutes.get('/:id/download', async (c) => {
  try {
    const resumeId = c.req.param('id');
    const user = c.get('user');
    const db = createDB(c.env);

    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return c.json({ error: 'Resume not found' }, 404);
    }

    // Get file from R2
    const resumeFile = await c.env.BUCKET.get(resume.fileKey);
    if (!resumeFile) {
      return c.json({ error: 'Resume file not found' }, 404);
    }

    // Return file with appropriate headers
    return new Response(resumeFile.body, {
      headers: {
        'Content-Type': resume.mimeType,
        'Content-Disposition': `attachment; filename="${resume.filename}"`,
        'Content-Length': resume.fileSize.toString()
      }
    });

  } catch (error) {
    console.error('Download resume error:', error);
    return c.json({ error: 'Failed to download resume' }, 500);
  }
});

resumeRoutes.delete('/:id', async (c) => {
  try {
    const resumeId = c.req.param('id');
    const user = c.get('user');
    const db = createDB(c.env);

    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return c.json({ error: 'Resume not found' }, 404);
    }

    // Delete file from R2
    await c.env.BUCKET.delete(resume.fileKey);

    // Delete from database
    await db.delete(resumes)
      .where(eq(resumes.id, resumeId));

    return c.json({
      success: true,
      message: 'Resume deleted successfully'
    });

  } catch (error) {
    console.error('Delete resume error:', error);
    return c.json({ error: 'Failed to delete resume' }, 500);
  }
});

export { resumeRoutes };