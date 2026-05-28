import type { AIDecision } from '../../types/ai.types.js';
import { TradeAction, RiskLevel, PositionSize, SessionMode, TradingStrategy } from '../../types/enum.types.js';
import { logger } from '../../utils/logger.js';
import type { AccountStatus } from '../../types/market.types.js';

import { env } from '../../config/env.js';

export class RiskManager {
  private maxDailyLossPercent = 100; 
  private maxRiskPerTradePercent = 100; 
  private maxLeverage = 500; 
  private minConfidenceScore = 40; 

  private getLiqSafetyThreshold(): number {
    return env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 15 : 30;
  }

  validateDecision(decision: AIDecision, account: AccountStatus, currentMode: SessionMode): AIDecision {
    logger.info('Validating trade decision against risk rules (DYNAMIC LEVERAGE MODE)');

    // 0. Check for existing positions (Dynamic Limit)
    const activePositions = account.open_positions || [];
    const threshold = this.getLiqSafetyThreshold();
    
    if (activePositions.length >= env.MAX_POSITIONS) {
      logger.warn({ 
        current: activePositions.length, 
        limit: env.MAX_POSITIONS 
      }, 'TRADING BLOCKED: Maximum concurrent positions reached.');
      
      return { 
        ...decision, 
        decision: TradeAction.SKIP, 
        final_summary: `Blocked: Max positions reached (${activePositions.length}/${env.MAX_POSITIONS})` 
      };
    }

    // 0.1 Check for existing positions details
    for (const pos of activePositions) {
      // RULE: Do not add size to the same coin
      // If we are checking a real trade decision (not a pre-scan check)
      if (decision.final_summary !== 'PRE_SCAN_CHECK' && pos.symbol === (decision as any).symbol) {
        logger.warn({ symbol: pos.symbol }, 'TRADING BLOCKED: You already have a position in this coin.');
        return { 
          ...decision, 
          decision: TradeAction.SKIP, 
          final_summary: `Blocked: Already holding ${pos.symbol}` 
        };
      }

      const markPrice = parseFloat(pos.markPrice || '0');
      const liqPrice = parseFloat(pos.liquidationPrice || '0');
      
      if (markPrice > 0 && liqPrice > 0) {
        const liqDistance = Math.abs((markPrice - liqPrice) / markPrice) * 100;
        
        if (liqDistance < threshold) {
          logger.warn({
            symbol: pos.symbol,
            liqDistance: `${liqDistance.toFixed(2)}%`,
            threshold: `${threshold}%`
          }, 'TRADING BLOCKED: Existing position is too close to liquidation price.');
          
          return { 
            ...decision, 
            decision: TradeAction.SKIP, 
            final_summary: `Blocked: Safety risk on ${pos.symbol} (Liq distance ${liqDistance.toFixed(2)}%)` 
          };
        }
      }
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
