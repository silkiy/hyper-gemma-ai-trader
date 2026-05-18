import type { AIDecision } from '../../types/ai.types.js';
import { TradeAction, RiskLevel, PositionSize, SessionMode } from '../../types/enum.types.js';
import { logger } from '../../utils/logger.js';
import type { AccountStatus } from '../../types/market.types.js';

export class RiskManager {
  private maxDailyLossPercent = 100; 
  private maxRiskPerTradePercent = 100; 
  private maxLeverage = 500; 
  private minConfidenceScore = 40; 

  validateDecision(decision: AIDecision, account: AccountStatus, currentMode: SessionMode): AIDecision {
    logger.info('Validating trade decision against risk rules (DYNAMIC LEVERAGE MODE)');

    // 0. Check for existing positions (Max 1 Rule)
    if (account.open_positions && account.open_positions.length > 0) {
      const pos = account.open_positions[0];
      const pnl = parseFloat(pos.unrealizedProfit || pos.pnl || '0');
      const entryPrice = parseFloat(pos.entryPrice || '0');
      const markPrice = parseFloat(pos.markPrice || pos.lastPrice || '0');
      
      // Calculate PnL % (Simplified)
      const pnlPct = entryPrice > 0 
        ? ((markPrice - entryPrice) / entryPrice * 100 * (pos.side === 'SELL' ? -1 : 1)).toFixed(2)
        : '0.00';

      logger.warn({
        symbol: pos.symbol,
        side: pos.side,
        size: pos.positionAmt || pos.size,
        leverage: pos.leverage,
        entryPrice: entryPrice,
        unrealizedPnL: `$${pnl.toFixed(4)}`,
        returnOnEquity: `${pnlPct}%`
      }, 'TRADING BLOCKED: You already have an active position.');

      return { ...decision, decision: TradeAction.SKIP, final_summary: `Blocked: Active trade on ${pos.symbol} (${pnlPct}%)` };
    }

    // 1. Force Leverage Limit (up to 500x)
    if (decision.leverage_suggestion > this.maxLeverage) {
      decision.leverage_suggestion = this.maxLeverage;
    }

    return decision;
  }

  calculatePositionSize(equity: number, positionSize: PositionSize): number {
    // Leave 80% of equity as buffer for fees and unrealized PnL
    const safeMargin = equity * (this.maxRiskPerTradePercent / 100);
    
    switch (positionSize) {
      case PositionSize.NORMAL:
        return safeMargin;
      case PositionSize.REDUCED:
        return safeMargin * 0.5;
      case PositionSize.SMALL:
        return safeMargin * 0.25;
      default:
        return safeMargin;
    }
  }
}

export const riskManager = new RiskManager();
