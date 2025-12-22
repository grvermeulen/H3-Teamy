import { readFileSync } from 'fs';
import { join } from 'path';

function getDatabaseUrl(): string {
  // For migrations, prefer DIRECT_DATABASE_URL (direct PostgreSQL connection)
  // Accelerate URLs don't work with migrations
  if (process.env.DIRECT_DATABASE_URL) {
    return process.env.DIRECT_DATABASE_URL;
  }
  
  // Try DATABASE_URL environment variable
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    // Check if it's an Accelerate URL
    if (url.startsWith('prisma://')) {
      throw new Error(
        'Prisma Accelerate URLs are not supported for migrations.\n' +
        'Please set DIRECT_DATABASE_URL environment variable with a direct PostgreSQL connection string.\n' +
        'You can find your direct connection string in the Prisma Console: https://console.prisma.io\n' +
        'More info: https://pris.ly/d/accelerate-limitations'
      );
    }
    return url;
  }
  
  // Fallback to prisma_url.txt file
  try {
    const urlPath = join(process.cwd(), 'prisma_url.txt');
    const url = readFileSync(urlPath, 'utf-8').trim();
    // Check if it's an Accelerate URL
    if (url.startsWith('prisma://')) {
      throw new Error(
        'The URL in prisma_url.txt is a Prisma Accelerate URL, which is not supported for migrations.\n' +
        'Please set DIRECT_DATABASE_URL environment variable with a direct PostgreSQL connection string.\n' +
        'You can find your direct connection string in the Prisma Console: https://console.prisma.io\n' +
        'More info: https://pris.ly/d/accelerate-limitations'
      );
    }
    return url;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Accelerate')) {
      throw error;
    }
    throw new Error('DATABASE_URL or DIRECT_DATABASE_URL environment variable is not set and prisma_url.txt file not found');
  }
}

export default {
  datasource: {
    url: getDatabaseUrl(),
  },
}

