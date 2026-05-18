import { logger } from '../utils/logger.js';
import { learningEngine } from '../core/ai/learning-engine.js';

export async function runMemoryConsolidation() {
  logger.info('Running memory consolidation job');
  try {
    await learningEngine.consolidateMemory();
  } catch (error) {
    logger.error({ error }, 'Memory consolidation job failed');
  }
}
