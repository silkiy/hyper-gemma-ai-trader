import type { AIDecision } from '../../types/ai.types.js';
import { TradeAction, RiskLevel, PositionSize, SessionMode, TradingStrategy } from '../../types/enum.types.js';
import { logger } from '../../utils/logger.js';
import type { AccountStatus } from '../../types/market.types.js';
import { cooldownManager } from './cooldown-manager.js';

import { env } from '../../config/env.js';

export class RiskManager {
  private maxDailyLossPercent = -20.0; // Circuit Breaker: -20% (adjusted for micro-account)
  private maxLossStreak = env.MAX_CONSECUTIVE_LOSS; // Configurable from .env
  private maxRiskPerTradePercent = 100; 
  private maxLeverage = 500; 
  private minConfidenceScore = 40; 

  private getLiqSafetyThreshold(): number {
    return env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 15 : 30;
  }

  validateDecision(decision: AIDecision, account: AccountStatus, currentMode: SessionMode): AIDecision {
    if (decision.final_summary !== 'PRE_SCAN_CHECK') {
      logger.info('Validating trade decision against risk rules (DYNAMIC LEVERAGE MODE)');
    }

    // 0. Hardcore Circuit Breaker Check
    if (cooldownManager.isCooldownActive()) {
      const remaining = cooldownManager.getRemainingMinutes().toFixed(1);
      return { 
        ...decision, 
        decision: TradeAction.SKIP, 
        final_summary: `Blocked: Hardcore Circuit Breaker Active (${remaining}m remaining)` 
      };
    }

    if (account.daily_pnl <= this.maxDailyLossPercent) {
      logger.fatal({ pnl: account.daily_pnl }, '🚨 CIRCUIT BREAKER TRIGGERED: Daily loss limit reached.');
      cooldownManager.startCooldown(240); // 4 hours
      return { 
        ...decision, 
        decision: TradeAction.SKIP, 
        final_summary: `Blocked: Daily loss limit reached (${account.daily_pnl}%)` 
      };
    }

    if (account.loss_streak >= this.maxLossStreak) {
      logger.fatal({ streak: account.loss_streak }, '🚨 CIRCUIT BREAKER TRIGGERED: Consecutive loss streak reached.');
      cooldownManager.startCooldown(240); // 4 hours
      return { 
        ...decision, 
        decision: TradeAction.SKIP, 
        final_summary: `Blocked: Loss streak reached (${account.loss_streak})` 
      };
    }

    // 1. Check for existing positions (Dynamic Limit)
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
      if (decision.final_summary !== 'PRE_SCAN_CHECK' && pos.symbol === decision.symbol) {
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

  /**
   * Calculates the allowed allocation percentage based on AI confidence.
   * Formula: max_risk = (100% / MAX_CONSECUTIVE_LOSS) / 2
   * HIGH: 100% of max_risk
   * MEDIUM: 60% of max_risk
   * LOW: 20% of max_risk
   * env.MAX_TRADE_ALLOCATION is the absolute hard cap.
   */
  getStagedAllocation(decision: AIDecision): number {
    const maxConsecutiveLoss = env.MAX_CONSECUTIVE_LOSS || 10;
    const maxRiskBase = (1.0 / maxConsecutiveLoss) / 2; // e.g., (1.0 / 10) / 2 = 0.05 (5%)

    // Fallback if confidence is missing
    if (!decision.confidence) {
      return env.MAX_TRADE_ALLOCATION;
    }

    let multiplier = 0.2; // LOW
    if (decision.confidence === 'HIGH') multiplier = 1.0;
    else if (decision.confidence === 'MEDIUM') multiplier = 0.6;

    const calculatedAllocation = maxRiskBase * multiplier;

    // Return minimum of calculated or hard cap
    return Math.min(calculatedAllocation, env.MAX_TRADE_ALLOCATION);
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
