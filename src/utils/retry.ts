import { logger } from './logger.js';
import { sleep } from './helpers.js';

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn({ attempt: i + 1, error: error instanceof Error ? error.message : error }, 'Operation failed, retrying...');
      if (i < attempts - 1) await sleep(delay);
    }
  }
  
  throw lastError;
}
