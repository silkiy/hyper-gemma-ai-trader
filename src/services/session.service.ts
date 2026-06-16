import { sessionRepository } from '../database/repositories/session.repository.js';
import type { ISession } from '../database/models/session.model.js';
import { SessionMode } from '../types/enum.types.js';
import { logger } from '../utils/logger.js';

export class SessionService {
  private currentSessionId: string | null = null;
  private peakEquity: number = 0;

  async startNewSession(mode: SessionMode = SessionMode.NORMAL): Promise<string> {
    const session = await sessionRepository.create({
      current_mode: mode,
      started_at: new Date(),
    });
    this.currentSessionId = (session._id as any).toString();
    this.peakEquity = 0; // Reset for new session
    logger.info({ sessionId: this.currentSessionId, mode }, 'New trading session started');
    return this.currentSessionId as string;
  }

  getCurrentSessionId(): string {
    if (!this.currentSessionId) {
      throw new Error('No active session found. Call startNewSession() first.');
    }
    return this.currentSessionId as string;
  }

  async updateStats(trades: number, pnl: number, currentEquity: number, lossStreak: number = 0, winStreak: number = 0) {
    if (!this.currentSessionId) return;

    // Update Peak Equity and Calculate Drawdown
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    }

    const drawdown = this.peakEquity > 0 
      ? ((this.peakEquity - currentEquity) / this.peakEquity) * 100 
      : 0;

    await sessionRepository.update(this.currentSessionId, {
      total_trades: trades,
      daily_pnl: parseFloat(pnl.toFixed(6)),
      peak_equity: this.peakEquity,
      drawdown_percent: parseFloat(drawdown.toFixed(2)),
      loss_streak: lossStreak,
      win_streak: winStreak
    });
  }
}

export const sessionService = new SessionService();
