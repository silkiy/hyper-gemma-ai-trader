import mongoose from 'mongoose';
import { Trade } from '../models/trade.model.js';
import type { ITrade } from '../models/trade.model.js';

export class TradeRepository {
  async create(data: Partial<ITrade>): Promise<ITrade> {
    return await Trade.create(data);
  }

  async findRecent(limit: number = 10): Promise<ITrade[]> {
    return await Trade.find().sort({ created_at: -1 }).limit(limit);
  }

  async findOpenTradeByPair(pair: string): Promise<ITrade | null> {
    return await Trade.findOne({ pair: pair, result: { $exists: false } }).sort({ created_at: -1 });
  }

  async update(id: string, data: Partial<ITrade>): Promise<ITrade | null> {
    return await Trade.findByIdAndUpdate(id, data, { returnDocument: 'after' });
  }

  async findActiveTrades(): Promise<ITrade[]> {
    return await Trade.find({ result: null });
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

  async getDailyStats(sessionId?: string) {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const matchFilter: any = { 
      created_at: { $gte: startOfToday },
      result: { $ne: null }
    };
    
    // When sessionId is provided, filter per-session (for circuit breaker)
    // When not provided, aggregate all trades today (for session display stats)
    if (sessionId) {
      matchFilter.session_id = new mongoose.Types.ObjectId(sessionId);
    }

    const stats = await Trade.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          dailyPnL: { $sum: '$profit_loss' },
          tradeCount: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'WIN'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'LOSS'] }, 1, 0] } }
        }
      }
    ]);

    return stats[0] || { dailyPnL: 0, tradeCount: 0, wins: 0, losses: 0 };
  }

  async getConsecutiveLosses(sessionId?: string): Promise<number> {
    const filter: any = { result: { $ne: null } };
    // Only count losses from current session to avoid old system's history poisoning
    if (sessionId) {
      filter.session_id = new mongoose.Types.ObjectId(sessionId);
    }
    const recentTrades = await Trade.find(filter)
    .sort({ created_at: -1 })
    .limit(10);

    let streak = 0;
    for (const trade of recentTrades) {
      if (trade.result === 'LOSS') {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }
}

export const tradeRepository = new TradeRepository();
