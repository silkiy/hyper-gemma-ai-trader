import { Memory } from '../../database/models/memory.model.js';
import { Trade } from '../../database/models/trade.model.js';
import { logger } from '../../utils/logger.js';
import { MemoryCategory } from '../../types/enum.types.js';

export class LearningEngine {
  async consolidateMemory() {
    logger.info('Starting memory consolidation process');
    
    // In a real implementation, this would:
    // 1. Fetch recent trades.
    // 2. Identify common mistakes using Gemma.
    // 3. Update the Memory collection in MongoDB.
    
    logger.info('Memory consolidation completed (simulated)');
  }

  async recordLesson(category: MemoryCategory, mistake: string, lesson: string, marketCondition: string) {
    logger.info({ category, mistake }, 'Recording new lesson in memory');
    
    try {
      await Memory.findOneAndUpdate(
        { mistake, category },
        { 
          $set: { lesson, market_condition: marketCondition, last_triggered_at: new Date() },
          $inc: { occurrence_count: 1 }
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      logger.error({ error }, 'Failed to record lesson');
    }
  }
}

export const learningEngine = new LearningEngine();
