import { Context } from 'hono';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validate request body against a Zod schema
 * Returns parsed data or throws with formatted error response
 */
export async function validateRequestBody<T>(
  c: Context,
  schema: ZodSchema<T>
): Promise<T> {
  try {
    const body = await c.req.json();
    const result = schema.parse(body);
    return result;
  } catch (error) {
    if (error instanceof ZodError) {
      // Format Zod errors nicely
      const errorMessages = error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      
      throw new ValidationError('Invalid request data', errorMessages);
    }
    throw new ValidationError('Invalid JSON body');
  }
}

/**
 * Validate request query parameters against a Zod schema
 */
export function validateQueryParams<T>(
  c: Context,
  schema: ZodSchema<T>
): T {
  try {
    const query = c.req.query();
    const result = schema.parse(query);
    return result;
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      
      throw new ValidationError('Invalid query parameters', errorMessages);
    }
    throw new ValidationError('Invalid query parameters');
  }
}

/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  public readonly errors?: Array<{ field: string; message: string }>;
  
  constructor(message: string, errors?: Array<{ field: string; message: string }>) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}