import { getConfig } from './config';
import type { JobExtractionData, CoverLetterPreferences } from '../types/database';

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

export class AIService {
    private readonly apiKey: string;

    constructor() {
      const config = getConfig();
      this.apiKey = config.openai.apiKey;
    }
  
    async extractJobFromHTML(html: string, url: string, title: string, maxTokens = 15000) {
      const cleanedHtml = this.cleanHTML(html, maxTokens);
      
      const prompt = `
Analyze this job posting content and extract structured information. Return ONLY valid JSON with these exact fields:

{
  "title": "exact job title",
  "company": "company name",
  "location": "location (city, state/country)",
  "salary": "salary range or compensation",
  "jobType": "full-time/part-time/contract/internship",
  "experience": "experience level required",
  "requirements": ["requirement 1", "requirement 2"],
  "description": "brief job description (2-3 sentences)",
  "benefits": ["benefit 1", "benefit 2"],
  "skills": ["skill 1", "skill 2"],
  "industry": "industry/sector",
  "remote": "remote/hybrid/on-site",
  "pageType": "job" or "general",
  "confidence": 0.8,
  "url": "${url}",
  "domain": "${new URL(url).hostname}"
}

Content to analyze:
Title: ${title}
URL: ${url}
Content: ${cleanedHtml}

Use your best judgement to extract the information. Use null for missing fields. Set pageType to "job" if this is clearly a job posting, "general" otherwise.
`;
  
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4-turbo-preview',
            messages: [
              {
                role: 'system',
                content: 'You are a precise content analyzer. Extract only accurate information that is clearly stated in the content. Return valid JSON only.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.1,
            max_tokens: 1000,
            response_format: { type: 'json_object' }
          })
        });
  
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
  
        const result = await response.json() as OpenAIResponse;
        const extractedText = result.choices[0].message.content;
  
        // Parse JSON response
        let jobData: JobExtractionData;
        try { 
          jobData = JSON.parse(extractedText);
        } catch (parseError) {
          console.error('JSON parsing error:', parseError);
          // Try to extract JSON from response if parsing fails
          const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jobData = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error('Failed to parse AI response as JSON');
          }
        }
  
        // Calculate confidence score based on extracted fields
        const fields = Object.keys(jobData).filter(key => 
          jobData[key as keyof JobExtractionData] !== null && 
          jobData[key as keyof JobExtractionData] !== '' && 
          jobData[key as keyof JobExtractionData] !== undefined &&
          !(Array.isArray(jobData[key as keyof JobExtractionData]) && (jobData[key as keyof JobExtractionData] as unknown[]).length === 0)
        );
        
        // Higher confidence for more fields and job-specific content
        let confidence = Math.min(fields.length / 10, 1);
        if (jobData.title && jobData.company) confidence += 0.1;
        if (jobData.pageType === 'job') confidence += 0.2;
        confidence = Math.min(confidence, 1);
  
        return {
          success: true,
          jobData,
          confidence: Math.round(confidence * 100) / 100,
          extractedFields: fields,
          tokensUsed: result.usage?.total_tokens || 0
        };
  
      } catch (error) {
        console.error('AI extraction error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'AI extraction failed',
          jobData: null,
          confidence: 0,
          tokensUsed: 0
        };
      }
    }
  
    async generateCoverLetter(jobData: JobExtractionData, resumeText: string, preferences: CoverLetterPreferences = {}) {
      // Truncate resume text to avoid token limits
      const truncatedResume = resumeText.substring(0, 8000);
      
      const prompt = `
You are an expert cover letter writer with 15+ years of experience. Create a personalized, compelling cover letter based on the job information and candidate's resume.

Job Information:
${JSON.stringify(jobData, null, 2)}

Resume Content:
${truncatedResume}

Writing Preferences:
- Tone: ${preferences.tone || 'professional'}
- Focus: ${preferences.focus || 'experience'}
- Length: ${preferences.length || 'medium'}

Create a compelling cover letter that:
1. Opens with enthusiasm for the specific role and company
2. Connects the candidate's experience directly to job requirements
3. Highlights 2-3 most relevant achievements with quantifiable results
4. Shows genuine knowledge of the company/industry
5. Uses the specified tone throughout
6. Ends with a confident call to action
7. Length guidelines:
   - Short: 2-3 paragraphs (200-300 words)
   - Medium: 3-4 paragraphs (300-450 words)
   - Long: 4-5 paragraphs (450-600 words)

Important guidelines:
- Write in first person as the candidate
- Be specific and avoid generic phrases
- Match the company's culture and tone if evident
- Include relevant keywords from the job posting
- Format as clean, readable text
- No placeholder text or brackets
- Professional closing with candidate's interest in next steps

Generate the cover letter now:
`;
  
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4-turbo-preview',
            messages: [
              {
                role: 'system',
                content: 'You are an expert cover letter writer who creates compelling, personalized cover letters that get results. Write professionally but with personality that matches the specified tone.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 800
          })
        });
  
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
  
        const result = await response.json() as OpenAIResponse;
        const coverLetterContent = result.choices[0].message.content;
  
        return {
          content: coverLetterContent,
          tokensUsed: result.usage?.total_tokens || 0
        };
  
      } catch (error) {
        console.error('Cover letter generation error:', error);
        throw new Error('Failed to generate cover letter: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    }
  
    async extractTextFromResume(fileContent: string, mimeType: string): Promise<string> {
      if (mimeType.includes('pdf')) {
        // For PDFs, we need a proper PDF parser. For now, return a placeholder
        // In production, you would use a library like pdf-parse or pdf2pic + OCR
        console.warn('PDF text extraction not fully implemented. Consider using a PDF parsing library.');
        return `[PDF Resume Content - ${mimeType}]\n\nNote: This is a PDF file. Text extraction from PDFs requires additional processing. Please ensure your resume content is accessible for the best cover letter generation results.`;
      } else if (mimeType.includes('word')) {
        // For Word documents, return as-is for now (would need proper parser)
        return fileContent;
      } else {
        // Plain text or other formats
        return fileContent;
      }
    }
  
    private cleanHTML(html: string, maxTokens: number): string {
      // Remove script tags, style tags, and comments
      let cleaned = html
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<!--.*?-->/gs, '')
        .replace(/<[^>]+>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/&[a-zA-Z0-9#]+;/g, ' ') // Remove HTML entities
        .trim();
  
      // Truncate to maxTokens (rough estimate: 1 token ≈ 4 characters)
      const maxChars = maxTokens * 3.5; // Be conservative with token estimation
      if (cleaned.length > maxChars) {
        cleaned = cleaned.substring(0, maxChars) + '...';
      }
  
      return cleaned;
    }
  }