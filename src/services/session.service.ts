import { sessionRepository } from '../database/repositories/session.repository.js';
import type { ISession } from '../database/models/session.model.js';
import { SessionMode } from '../types/enum.types.js';
import { logger } from '../utils/logger.js';

export class SessionService {
  private currentSessionId: string | null = null;
  private peakEquity: number = 0;
  private initialized: boolean = false;

  async startNewSession(mode: SessionMode = SessionMode.NORMAL): Promise<string> {
    const session = await sessionRepository.create({
      current_mode: mode,
      started_at: new Date(),
    });
    this.currentSessionId = (session._id as any).toString();
    this.peakEquity = 0; // Reset for new session
    this.initialized = false; // Will be initialized on first updateStats call
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

    // Initialize peak equity on first call (from current equity)
    if (!this.initialized || this.peakEquity === 0) {
      this.peakEquity = currentEquity;
      this.initialized = true;
    }

    // Update Peak Equity if current is higher
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    }

    // Calculate Drawdown from peak
    const drawdown = this.peakEquity > 0 
      ? Math.max(0, ((this.peakEquity - currentEquity) / this.peakEquity) * 100)
      : 0;

    // Log stats for debugging
    logger.debug({
      sessionId: this.currentSessionId,
      trades,
      pnl: pnl.toFixed(4),
      equity: currentEquity.toFixed(4),
      peak: this.peakEquity.toFixed(4),
      drawdown: `${drawdown.toFixed(2)}%`,
      lossStreak,
      winStreak
    }, 'Session stats update');

    await sessionRepository.update(this.currentSessionId, {
      total_trades: trades,
      daily_pnl: parseFloat(pnl.toFixed(6)),
      peak_equity: parseFloat(this.peakEquity.toFixed(6)),
      drawdown_percent: parseFloat(drawdown.toFixed(2)),
      loss_streak: lossStreak,
      win_streak: winStreak
    });
  }

  /**
   * Force update session with current equity (for initialization)
   */
  async initializeEquity(equity: number) {
    if (!this.currentSessionId) return;
    
    if (this.peakEquity === 0 || equity > this.peakEquity) {
      this.peakEquity = equity;
      this.initialized = true;
      
      await sessionRepository.update(this.currentSessionId, {
        peak_equity: parseFloat(equity.toFixed(6)),
        drawdown_percent: 0
      });
    }
  }
}

export const sessionService = new SessionService();
