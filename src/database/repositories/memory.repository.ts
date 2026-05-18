import { Memory } from '../models/memory.model.js';
import type { IMemory } from '../models/memory.model.js';
import { MemoryCategory } from '../../types/enum.types.js';

export class MemoryRepository {
  async saveLesson(category: MemoryCategory, mistake: string, lesson: string, marketCondition: string) {
    return await Memory.findOneAndUpdate(
      { mistake, category },
      { 
        $set: { lesson, market_condition: marketCondition, last_triggered_at: new Date() },
        $inc: { occurrence_count: 1 }
      },
      { upsert: true, new: true }
    );
  }

  async findTopMistakes(limit: number = 5): Promise<IMemory[]> {
    return await Memory.find().sort({ occurrence_count: -1 }).limit(limit);
  }
}

export const memoryRepository = new MemoryRepository();
