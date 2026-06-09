import { Trade } from '../models/trade.model.js';
import type { ITrade } from '../models/trade.model.js';

export class TradeRepository {
  async create(data: Partial<ITrade>): Promise<ITrade> {
    return await Trade.create(data);
  }

  async findRecent(limit: number = 10): Promise<ITrade[]> {
    return await Trade.find().sort({ created_at: -1 }).limit(limit);
  }

  async findOpenTrades(): Promise<ITrade[]> {
    return await Trade.find({ result: { $exists: false } });
  }

  async closeTradeRecord(tradeId: string, data: Partial<ITrade>): Promise<ITrade | null> {
    return await Trade.findByIdAndUpdate(tradeId, { $set: data }, { new: true });
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

  async aggregatePairPerformance() {
    return await Trade.aggregate([
      { $match: { result: { $exists: true } } },
      {
        $group: {
          _id: '$pair',
          totalTrades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'WIN'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'LOSS'] }, 1, 0] } },
          totalPnL: { $sum: '$realized_pnl' },
          avgWin: { $avg: { $cond: [{ $eq: ['$result', 'WIN'] }, '$realized_pnl', null] } },
          avgLoss: { $avg: { $cond: [{ $eq: ['$result', 'LOSS'] }, '$realized_pnl', null] } }
        }
      },
      {
        $project: {
          pair: '$_id',
          _id: 0,
          totalTrades: 1,
          wins: 1,
          losses: 1,
          totalPnL: 1,
          winRate: { $multiply: [{ $divide: ['$wins', '$totalTrades'] }, 100] },
          avgPnL: { $divide: ['$totalPnL', '$totalTrades'] },
          avgWin: { $ifNull: ['$avgWin', 0] },
          avgLoss: { $ifNull: ['$avgLoss', 0] },
          pnlRatio: {
            $cond: [
              { $eq: [{ $ifNull: ['$avgLoss', 0] }, 0] },
              10,
              { $min: [{ $divide: ['$avgWin', { $abs: '$avgLoss' }] }, 10] }
            ]
          }
        }
      },
      {
        $addFields: {
          score: {
            $add: [
              { $multiply: [{ $divide: ['$winRate', 100] }, 0.4] },
              { $multiply: [{ $divide: ['$pnlRatio', 10] }, 0.4] },
              { $multiply: [{ $min: [{ $divide: ['$totalTrades', 50] }, 1] }, 0.2] }
            ]
          }
        }
      }
    ]);
  }
}

export const tradeRepository = new TradeRepository();
