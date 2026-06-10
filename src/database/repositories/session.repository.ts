import { Session } from '../models/session.model.js';
import type { ISession } from '../models/session.model.js';

export class SessionRepository {
  async create(data: Partial<ISession>): Promise<ISession> {
    return await Session.create(data);
  }

  async findLatest(): Promise<ISession | null> {
    return await Session.findOne().sort({ started_at: -1 });
  }

  async update(id: string, data: Partial<ISession>): Promise<ISession | null> {
    return await Session.findByIdAndUpdate(id, data, { new: true });
  }

  async updateStats(id: string, pnl: number, isWin: boolean, equity: number) {
    const update: any = {
      $inc: {
        total_trades: 1,
        daily_pnl: pnl,
        win_streak: isWin ? 1 : 0,
        loss_streak: isWin ? 0 : 1
      },
      $max: { peak_equity: equity }
    };

    // If it's a win, we reset loss_streak. If loss, we reset win_streak.
    // Using atomic $set for resets.
    if (isWin) {
      update.$set = { loss_streak: 0 };
    } else {
      update.$set = { win_streak: 0 };
    }

    return await Session.findByIdAndUpdate(id, update, { new: true });
  }
}

export const sessionRepository = new SessionRepository();
