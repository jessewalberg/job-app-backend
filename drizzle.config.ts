import type { Config } from 'drizzle-kit';

// const isLocal = process.env.NODE_ENV === 'local' || process.env.DRIZZLE_LOCAL === 'true';
const isLocal = false
console.log(isLocal, 'isLocal')
export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  ...(isLocal 
    ? {
        // Local SQLite file for development
        dbCredentials: {
          url: './.wrangler/state/v3/d1/miniflare-D1DatabaseObject/6ff6a6a0c8116722897c9a9d795375c26862193d470f86fc5c90b1a61bbd31fd.sqlite'
        }
      }
    : {
        // Remote D1 for production/staging
        driver: 'd1-http',
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
          token: process.env.CLOUDFLARE_API_TOKEN!
        }
      }
  )
} satisfies Config;