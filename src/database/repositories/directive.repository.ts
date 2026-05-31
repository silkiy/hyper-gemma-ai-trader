import { BattleDirective } from '../models/directive.model.js';
import type { IBattleDirective } from '../models/directive.model.js';

export class DirectiveRepository {
  async getLatest(): Promise<IBattleDirective | null> {
    return await BattleDirective.findOne().sort({ last_updated: -1 });
  }

  async update(data: Partial<IBattleDirective>): Promise<IBattleDirective> {
    return await BattleDirective.findOneAndUpdate(
      {}, 
      { ...data, last_updated: new Date() }, 
      { upsert: true, returnDocument: 'after' }
    );
  }
}

export const directiveRepository = new DirectiveRepository();
