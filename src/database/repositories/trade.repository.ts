import { Trade } from '../models/trade.model.js';
import type { ITrade } from '../models/trade.model.js';

export class TradeRepository {
  async create(data: Partial<ITrade>): Promise<ITrade> {
    return await Trade.create(data);
  }

  async findRecent(limit: number = 10): Promise<ITrade[]> {
    return await Trade.find().sort({ created_at: -1 }).limit(limit);
  }

  async getStats() {
    return await Trade.aggregate([
      {
        $group: {
          _id: '$result',
          count: { $sum: 1 },
          totalPnL: { $sum: '$profit_loss' }
        }
      }
    ]);
  }
}

export const tradeRepository = new TradeRepository();
