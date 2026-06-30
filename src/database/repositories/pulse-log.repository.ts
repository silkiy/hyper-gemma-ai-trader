import { PulseLog } from '../models/pulse-log.model.js';
import type { IPulseLog } from '../models/pulse-log.model.js';

export class PulseLogRepository {
  async create(data: Partial<IPulseLog>): Promise<IPulseLog> {
    return await PulseLog.create(data);
  }

  async findRecent(limit: number = 100): Promise<IPulseLog[]> {
    return await PulseLog.find().sort({ timestamp: -1 }).limit(limit);
  }

  async findBySymbol(symbol: string, limit: number = 50): Promise<IPulseLog[]> {
    return await PulseLog.find({ symbol }).sort({ timestamp: -1 }).limit(limit);
  }

  async findSignals(limit: number = 50): Promise<IPulseLog[]> {
    return await PulseLog.find({ decision: { $ne: null } })
      .sort({ timestamp: -1 })
      .limit(limit);
  }

  async findSkipped(limit: number = 50): Promise<IPulseLog[]> {
    return await PulseLog.find({ decision: null })
      .sort({ timestamp: -1 })
      .limit(limit);
  }

  async getStats() {
    const total = await PulseLog.countDocuments();
    const signals = await PulseLog.countDocuments({ decision: { $ne: null } });
    const skipped = await PulseLog.countDocuments({ decision: null });

    return { total, signals, skipped };
  }

  async getSkipReasonsStats() {
    return await PulseLog.aggregate([
      { $unwind: '$skipReasons' },
      { $group: { _id: '$skipReasons', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
  }
}

export const pulseLogRepository = new PulseLogRepository();
