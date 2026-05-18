import { SessionMode } from '../../types/enum.types.js';
import { logger } from '../../utils/logger.js';

export class CooldownManager {
  private cooldownUntil: Date | null = null;

  startCooldown(minutes: number = 30) {
    this.cooldownUntil = new Date(Date.now() + minutes * 60 * 1000);
    logger.warn({ until: this.cooldownUntil }, 'System entered COOLDOWN mode');
  }

  isCooldownActive(): boolean {
    if (!this.cooldownUntil) return false;
    const active = new Date() < this.cooldownUntil;
    if (!active) this.cooldownUntil = null;
    return active;
  }

  getRemainingMinutes(): number {
    if (!this.cooldownUntil) return 0;
    return Math.max(0, (this.cooldownUntil.getTime() - Date.now()) / 60000);
  }
}

export const cooldownManager = new CooldownManager();
