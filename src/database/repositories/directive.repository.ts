import { BattleDirective } from '../models/directive.model.js';
import type { IBattleDirective } from '../models/directive.model.js';

export class DirectiveRepository {
  async getLatest(): Promise<IBattleDirective | null> {
    return await BattleDirective.findOne().sort({ last_updated: -1 });
  }

  async create(data: Partial<IBattleDirective>): Promise<IBattleDirective> {
    return await BattleDirective.create({
      ...data,
      last_updated: new Date()
    });
  }
}

export const directiveRepository = new DirectiveRepository();
