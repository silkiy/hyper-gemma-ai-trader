import { logger } from '../../utils/logger.js';

/**
 * Per-symbol cooldown manager to prevent revenge trading.
 * After a LOSS on a symbol, blocks re-entry for a configurable duration.
 */
export class SymbolCooldown {
  private cooldowns: Map<string, number> = new Map();

  addCooldown(symbol: string, minutes: number = 30) {
    const until = Date.now() + minutes * 60000;
    this.cooldowns.set(symbol, until);
    logger.warn({ symbol, minutes }, `[SYMBOL COOLDOWN] ${symbol} blocked for ${minutes} minutes after LOSS`);
  }

  isOnCooldown(symbol: string): boolean {
    const until = this.cooldowns.get(symbol);
    if (!until) return false;
    if (Date.now() >= until) {
      this.cooldowns.delete(symbol);
      return false;
    }
    return true;
  }

  getRemainingMinutes(symbol: string): number {
    const until = this.cooldowns.get(symbol);
    if (!until) return 0;
    return Math.max(0, (until - Date.now()) / 60000);
  }
}

export const symbolCooldown = new SymbolCooldown();
