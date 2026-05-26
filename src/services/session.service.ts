import { sessionRepository } from '../database/repositories/session.repository.js';
import type { ISession } from '../database/models/session.model.js';
import { SessionMode } from '../types/enum.types.js';
import { logger } from '../utils/logger.js';

export class SessionService {
  private currentSessionId: string | null = null;

  async startNewSession(mode: SessionMode = SessionMode.NORMAL): Promise<string> {
    const session = await sessionRepository.create({
      current_mode: mode,
      started_at: new Date(),
    });
    this.currentSessionId = (session._id as any).toString();
    logger.info({ sessionId: this.currentSessionId, mode }, 'New trading session started');
    return this.currentSessionId as string;
  }

  getCurrentSessionId(): string {
    if (!this.currentSessionId) {
      throw new Error('No active session found. Call startNewSession() first.');
    }
    return this.currentSessionId as string;
  }

  async updateStats(trades: number, pnl: number) {
    if (!this.currentSessionId) return;
    await sessionRepository.update(this.currentSessionId, {
      total_trades: trades,
      daily_pnl: pnl
    });
  }
}

export const sessionService = new SessionService();
