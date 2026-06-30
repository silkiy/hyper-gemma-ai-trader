import { SessionMode } from '../../types/enum.types.js';
import { logger } from '../../utils/logger.js';
import { Cooldown } from '../../database/models/cooldown.model.js';

export class CooldownManager {
  private cooldownUntil: Date | null = null;
  private isLoaded = false;

  async loadCooldown() {
    if (this.isLoaded) return;
    
    try {
      const activeCooldown = await Cooldown.findOne({ 
        cooldown_until: { $gt: new Date() } 
      }).sort({ cooldown_until: -1 });
      
      if (activeCooldown) {
        this.cooldownUntil = activeCooldown.cooldown_until;
        const remaining = this.getRemainingMinutes().toFixed(1);
        logger.info({ until: this.cooldownUntil, remaining }, 'Loaded active cooldown from database');
      }
      this.isLoaded = true;
    } catch (error) {
      logger.error({ error }, 'Failed to load cooldown from database');
      this.isLoaded = true;
    }
  }

  async startCooldown(minutes: number = 30, reason: string = 'Circuit breaker triggered') {
    this.cooldownUntil = new Date(Date.now() + minutes * 60 * 1000);
    logger.warn({ until: this.cooldownUntil, reason }, 'System entered COOLDOWN mode');
    
    try {
      await Cooldown.create({
        cooldown_until: this.cooldownUntil,
        reason
      });
    } catch (error) {
      logger.error({ error }, 'Failed to save cooldown to database');
    }
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
