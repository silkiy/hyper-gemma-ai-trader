import { SessionMode } from '../../types/enum.types.js';
import { logger } from '../../utils/logger.js';

export class CooldownManager {
  private cooldownUntil: Date | null = null;
  private pairCooldowns: Map<string, Date> = new Map();

  startCooldown(minutes: number = 30) {
    this.cooldownUntil = new Date(Date.now() + minutes * 60 * 1000);
    logger.warn({ until: this.cooldownUntil }, 'System entered GLOBAL COOLDOWN mode');
  }

  startPairCooldown(pair: string, minutes: number = 30) {
    const until = new Date(Date.now() + minutes * 60 * 1000);
    this.pairCooldowns.set(pair, until);
    logger.info({ pair, until }, `Pair ${pair} entered cooldown`);
  }

  isCooldownActive(): boolean {
    if (!this.cooldownUntil) return false;
    const active = new Date() < this.cooldownUntil;
    if (!active) this.cooldownUntil = null;
    return active;
  }

  isPairInCooldown(pair: string): boolean {
    const until = this.pairCooldowns.get(pair);
    if (!until) return false;
    const active = new Date() < until;
    if (!active) this.pairCooldowns.delete(pair);
    return active;
  }

  getRemainingMinutes(): number {
    if (!this.cooldownUntil) return 0;
    return Math.max(0, (this.cooldownUntil.getTime() - Date.now()) / 60000);
  }
}

export const cooldownManager = new CooldownManager();
