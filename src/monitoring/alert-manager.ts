import { logger } from '../utils/logger.js';

export class AlertManager {
  async sendAlert(message: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM') {
    logger.error({ severity, message }, 'SYSTEM ALERT');
    
    // In production, this would send Telegram/Discord/Slack alerts
    if (severity === 'HIGH') {
      console.error(`🚨 CRITICAL ALERT: ${message}`);
    }
  }

  async checkBalanceAlert(balance: number, threshold: number = 1) {
    if (balance < threshold) {
      await this.sendAlert(`Low balance detected: $${balance}`, 'HIGH');
    }
  }
}

export const alertManager = new AlertManager();
