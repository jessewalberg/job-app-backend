import type { Context } from 'hono';
import type { ValidationErrorDetail } from '../types/database';

/**
 * Standardized response helpers to eliminate duplication
 */

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: ValidationErrorDetail[];
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

/**
 * Create a standardized success response
 */
export function successResponse<T>(data: T): SuccessResponse<T> {
  return {
    success: true,
    data
  };
}

/**
 * Create a standardized error response
 */
export function errorResponse(error: string, details?: ValidationErrorDetail[]): ErrorResponse {
  return {
    success: false,
    error,
    ...(details && { details })
  };
}

/**
 * Send a success response with data
 */
export function sendSuccess<T>(c: Context, data: T, status: number = 200) {
  return c.json(successResponse(data), status);
}

/**
 * Send an error response
 */
export function sendError(c: Context, error: string, status: number = 500, details?: ValidationErrorDetail[]) {
  return c.json(errorResponse(error, details), status);
}

/**
 * Send a validation error response
 */
export function sendValidationError(c: Context, error: string, details?: ValidationErrorDetail[]) {
  return sendError(c, error, 400, details);
}

/**
 * Send an unauthorized error response
 */
export function sendUnauthorized(c: Context, error: string = 'Unauthorized') {
  return sendError(c, error, 401);
}

/**
 * Send a forbidden error response
 */
export function sendForbidden(c: Context, error: string = 'Forbidden') {
  return sendError(c, error, 403);
}

/**
 * Send a not found error response
 */
export function sendNotFound(c: Context, error: string = 'Not found') {
  return sendError(c, error, 404);
}

/**
 * Send an insufficient credits error response
 */
export function sendInsufficientCredits(c: Context, error: string = 'Insufficient credits. Please upgrade your plan or purchase more credits.') {
  return sendError(c, error, 402);
}

/**
 * Handle and send error response based on error type
 */
export function handleError(c: Context, error: unknown, defaultMessage: string = 'An error occurred') {
  console.error(defaultMessage + ':', error);
  
  if (error instanceof Error) {
    return sendError(c, defaultMessage, 500);
  }
  
  return sendError(c, defaultMessage, 500);
} 