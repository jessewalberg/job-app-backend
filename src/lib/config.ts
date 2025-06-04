import type { AppEnv } from '../types/env';

export interface AppConfig {
  environment: 'development' | 'staging' | 'production';
  jwt: {
    secret: string;
  };
  openai: {
    apiKey: string;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
  };
  extension: {
    secret: string;
    validIds: string[];
  };
  database: {
    binding: D1Database;
  };
  storage: {
    bucket: R2Bucket;
    rateLimitKV: KVNamespace;
    extensionKV: KVNamespace;
  };
  features: {
    testApiKey?: string;
  };
}

// Module-level state for config initialization
let configInstance: AppConfig | null = null;
let isInitialized = false;

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public missingVars: string[] = []
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

// Configuration schema - defines what we need and how to validate it
interface EnvVarConfig {
  key: keyof AppEnv['Bindings'];
  description: string;
  required: boolean;
  validator?: (value: string) => { valid: boolean; error?: string };
}

interface BindingConfig {
  key: keyof AppEnv['Bindings'];
  description: string;
  required: boolean;
}

// Define all environment variables we need
const ENV_VAR_SCHEMA: EnvVarConfig[] = [
  {
    key: 'ENVIRONMENT',
    description: 'Application environment',
    required: true,
    validator: (value) => ({
      valid: ['development', 'staging', 'production'].includes(value),
      error: 'Must be development, staging, or production'
    })
  },
  {
    key: 'JWT_SECRET',
    description: 'JWT signing secret',
    required: true
  },
  {
    key: 'OPENAI_API_KEY',
    description: 'OpenAI API key',
    required: true
  },
  {
    key: 'STRIPE_SECRET_KEY',
    description: 'Stripe secret key',
    required: true
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    description: 'Stripe webhook secret',
    required: true
  },
  {
    key: 'EXTENSION_SECRET',
    description: 'Extension authentication secret',
    required: true
  },
  {
    key: 'VALID_EXTENSION_IDS',
    description: 'Valid extension IDs JSON array',
    required: true,
    validator: (value) => {
      try {
        const parsed = JSON.parse(value);
        const valid = Array.isArray(parsed) && parsed.every(id => typeof id === 'string');
        return {
          valid,
          error: valid ? undefined : 'Must be a JSON array of strings'
        };
      } catch {
        return { valid: false, error: 'Must be valid JSON' };
      }
    }
  },
  {
    key: 'TEST_API_KEY',
    description: 'Test API key for development',
    required: false
  }
];

// Define all bindings we need
const BINDING_SCHEMA: BindingConfig[] = [
  {
    key: 'DB',
    description: 'D1 database binding',
    required: true
  },
  {
    key: 'BUCKET',
    description: 'R2 bucket binding',
    required: true
  },
  {
    key: 'RATE_LIMIT_KV',
    description: 'KV namespace for rate limiting',
    required: false // Optional for now
  },
  {
    key: 'EXTENSION_KV',
    description: 'KV namespace for extension data',
    required: false // Optional for now
  }
];

/**
 * Validates and creates a typed configuration object from environment variables
 * Throws ConfigValidationError if any required variables are missing
 */
export function validateConfig(env: AppEnv['Bindings']): AppConfig {
  const missingVars: string[] = [];
  const errors: string[] = [];
  const validatedVars: Record<string, any> = {};

  // Validate environment variables
  for (const config of ENV_VAR_SCHEMA) {
    const value = env[config.key] as string;
    const isEmpty = !value || value.trim() === '';
    
    if (config.required && isEmpty) {
      missingVars.push(String(config.key));
      errors.push(`${String(config.key)} (${config.description})`);
      continue;
    }
    
    if (!isEmpty) {
      // Run custom validator if provided
      if (config.validator) {
        const validation = config.validator(value.trim());
        if (!validation.valid) {
          errors.push(`${String(config.key)} - ${validation.error}`);
          continue;
        }
      }
      
      validatedVars[String(config.key)] = value.trim();
    }
  }

  // Validate bindings
  for (const config of BINDING_SCHEMA) {
    const binding = env[config.key];
    
    if (config.required && !binding) {
      missingVars.push(String(config.key));
      errors.push(`${String(config.key)} (${config.description})`);
    } else if (!binding) {
      console.warn(`⚠️  ${String(config.key)} binding not found - ${config.description} will be disabled`);
    }
  }

  // Throw error if any required vars are missing
  if (missingVars.length > 0) {
    const message = `Missing required environment variables:\n${errors.map(e => `  - ${e}`).join('\n')}`;
    throw new ConfigValidationError(message, missingVars);
  }

  // Parse extension IDs
  const validExtensionIds = validatedVars.VALID_EXTENSION_IDS 
    ? JSON.parse(validatedVars.VALID_EXTENSION_IDS)
    : [];

  // Return validated config using the validated values
  return {
    environment: validatedVars.ENVIRONMENT as 'development' | 'staging' | 'production',
    jwt: {
      secret: validatedVars.JWT_SECRET,
    },
    openai: {
      apiKey: validatedVars.OPENAI_API_KEY,
    },
    stripe: {
      secretKey: validatedVars.STRIPE_SECRET_KEY,
      webhookSecret: validatedVars.STRIPE_WEBHOOK_SECRET,
    },
    extension: {
      secret: validatedVars.EXTENSION_SECRET,
      validIds: validExtensionIds,
    },
    database: {
      binding: env.DB,
    },
    storage: {
      bucket: env.BUCKET,
      rateLimitKV: env.RATE_LIMIT_KV,
      extensionKV: env.EXTENSION_KV,
    },
    features: {
      testApiKey: validatedVars.TEST_API_KEY,
    },
  };
}
/**
 * Initialize the global config - call this once at app startup
 */
export function initializeConfig(env: AppEnv['Bindings']): AppConfig {
  if (isInitialized && configInstance) {
    return configInstance;
  }

  configInstance = validateConfig(env);
  isInitialized = true;
  return configInstance;
}

/**
 * Get the validated config - throws if not initialized
 */
export function getConfig(): AppConfig {
  if (!isInitialized || !configInstance) {
    throw new Error('Config not initialized. Call initializeConfig() first.');
  }
  return configInstance;
}

/**
 * Check if config is initialized
 */
export function isConfigInitialized(): boolean {
  return isInitialized;
}

/**
 * Get the configuration schema for external tools (like validation scripts)
 */
export function getConfigSchema() {
  return {
    envVars: ENV_VAR_SCHEMA,
    bindings: BINDING_SCHEMA
  };
} 