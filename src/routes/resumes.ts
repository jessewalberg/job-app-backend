import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc } from 'drizzle-orm';
import { AIService } from '../lib/ai';
import { CreditManager } from '../lib/credits';
import { uploadResumeSchema, paginationSchema } from '../lib/validation';
import { resumes } from '../db/schema';
import { authContextMiddleware, getAuthContext } from '../middleware/authContext';
import { creditCheckMiddleware, deductCreditsAfterOperation } from '../middleware/creditCheck';
import { sendSuccess, sendError, sendNotFound, handleError } from '../lib/responses';
import { getConfig } from '../lib/config';
import type { AppEnv } from '../types/env';

const resumeRoutes = new Hono<AppEnv>();

// All routes require authentication
resumeRoutes.use('*', authContextMiddleware);

// Upload resume
resumeRoutes.post('/upload', 
  creditCheckMiddleware.resumeUpload,
  zValidator('json', uploadResumeSchema), 
  async (c) => {
    const startTime = Date.now();
    
    try {
      const { filename, mimeType, fileSize } = c.req.valid('json');
      const { user, db } = getAuthContext(c);
      const config = getConfig();

      // Generate unique file key
      const fileKey = `resumes/${user.userId}/${crypto.randomUUID()}-${filename}`;
      
      // Store resume metadata in database first
      const resumeId = crypto.randomUUID();
      const newResume = await db.insert(resumes).values({
        id: resumeId,
        userId: user.userId,
        filename,
        fileKey,
        fileSize,
        mimeType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }).returning();

      // Deduct credits and get remaining
      const responseTime = Date.now() - startTime;
      const remainingCredits = await deductCreditsAfterOperation(
        c,
        CreditManager.COSTS.RESUME_UPLOAD,
        'resume-upload',
        responseTime
      );

      // Return the resume info and file key for client-side upload
      // The client will need to send the file data in a separate request
      return sendSuccess(c, {
        resume: newResume[0],
        fileKey,
        uploadEndpoint: `/api/resumes/${resumeId}/upload`,
        remainingCredits
      }, 201);

    } catch (error) {
      return handleError(c, error, 'Resume upload failed');
    }
  }
);

// Upload file data to R2
resumeRoutes.post('/:id/upload', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const resumeId = c.req.param('id');
    const config = getConfig();

    // Verify the resume belongs to the user
    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return sendNotFound(c, 'Resume not found');
    }

    // Get the file data from the request
    const fileData = await c.req.arrayBuffer();
    
    if (!fileData || fileData.byteLength === 0) {
      return sendError(c, 'No file data provided', 400);
    }

    // Upload to R2
    await config.storage.bucket.put(resume.fileKey, fileData, {
      httpMetadata: {
        contentType: resume.mimeType,
      }
    });

    return sendSuccess(c, {
      message: 'File uploaded successfully',
      fileKey: resume.fileKey,
      size: fileData.byteLength
    });

  } catch (error) {
    return handleError(c, error, 'File upload failed');
  }
});

// Get user's resumes
resumeRoutes.get('/', zValidator('query', paginationSchema), async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const { page, limit } = c.req.valid('query');

    const offset = (page - 1) * limit;

    const userResumes = await db.select()
      .from(resumes)
      .where(eq(resumes.userId, user.userId))
      .orderBy(desc(resumes.createdAt))
      .limit(limit)
      .offset(offset);

    return sendSuccess(c, {
      resumes: userResumes,
      pagination: {
        page,
        limit,
        total: userResumes.length,
        hasMore: userResumes.length === limit
      }
    });

  } catch (error) {
    return handleError(c, error, 'Failed to fetch resumes');
  }
});

// Get resume content for cover letter generation
resumeRoutes.get('/:id/content', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const resumeId = c.req.param('id');
    const config = getConfig();

    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return sendNotFound(c, 'Resume not found');
    }

    // Get file from R2
    const resumeFile = await config.storage.bucket.get(resume.fileKey);
    if (!resumeFile) {
      return sendNotFound(c, 'Resume file not found');
    }

    // Extract text content using AI - handle different file types properly
    const ai = new AIService();
    let fileContent: string;
    
    if (resume.mimeType.includes('pdf')) {
      // For PDFs, read as binary and convert to base64 using Web APIs
      const fileBuffer = await resumeFile.arrayBuffer();
      const uint8Array = new Uint8Array(fileBuffer);
      const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
      fileContent = btoa(binaryString);
    } else {
      // For text-based files, read as text
      fileContent = await resumeFile.text();
    }
    
    const extractedText = await ai.extractTextFromResume(fileContent, resume.mimeType);

    return sendSuccess(c, {
      id: resume.id,
      filename: resume.filename,
      content: extractedText,
      extractedAt: new Date().toISOString()
    });

  } catch (error) {
    return handleError(c, error, 'Failed to get resume content');
  }
});

// Get specific resume
resumeRoutes.get('/:id', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const resumeId = c.req.param('id');

    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return sendNotFound(c, 'Resume not found');
    }

    return sendSuccess(c, resume);

  } catch (error) {
    return handleError(c, error, 'Failed to fetch resume');
  }
});

// Update resume
resumeRoutes.put('/:id', zValidator('json', uploadResumeSchema), async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const resumeId = c.req.param('id');
    const { filename } = c.req.valid('json');

    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return sendNotFound(c, 'Resume not found');
    }

    const updatedResume = await db.update(resumes)
      .set({
        filename,
        updatedAt: new Date().toISOString()
      })
      .where(eq(resumes.id, resumeId))
      .returning();

    return sendSuccess(c, updatedResume[0]);

  } catch (error) {
    return handleError(c, error, 'Failed to update resume');
  }
});

// Delete resume
resumeRoutes.delete('/:id', async (c) => {
  try {
    const { user, db } = getAuthContext(c);
    const resumeId = c.req.param('id');
    const config = getConfig();

    const resume = await db.select()
      .from(resumes)
      .where(eq(resumes.id, resumeId))
      .get();

    if (!resume || resume.userId !== user.userId) {
      return sendNotFound(c, 'Resume not found');
    }

    // Delete file from R2
    await config.storage.bucket.delete(resume.fileKey);

    // Delete from database
    await db.delete(resumes)
      .where(eq(resumes.id, resumeId));

    return sendSuccess(c, { message: 'Resume deleted successfully' });

  } catch (error) {
    return handleError(c, error, 'Failed to delete resume');
  }
});

export { resumeRoutes };