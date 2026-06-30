import type { AIDecision } from '../../types/ai.types.js';
import { TradeAction, RiskLevel, PositionSize, SessionMode, TradingStrategy } from '../../types/enum.types.js';
import { logger } from '../../utils/logger.js';
import type { AccountStatus } from '../../types/market.types.js';
import { cooldownManager } from './cooldown-manager.js';
import { RiskOfRuinCalculator } from './risk-of-ruin.js';

import { env } from '../../config/env.js';

export class RiskManager {
  // ═══════════════════════════════════════════════════════════════
  // 2% RULE: Maximum risk per trade = 2% of account
  // Based on professional quant standards (Van Tharp, Ralph Vince)
  // ═══════════════════════════════════════════════════════════════
  private readonly MAX_RISK_PER_TRADE_PCT = 0.02; // 2% RULE - NEVER EXCEED
  private readonly ABSOLUTE_MAX_RISK_PCT = 0.05; // Hard ceiling - system will block above this
  
  private maxDailyLossPercent = -Math.abs(env.MAX_DRAWDOWN_PERCENT); // Circuit Breaker dinamis dari .env
  private maxLossStreak = env.MAX_CONSECUTIVE_LOSS; // Configurable from .env
  private maxLeverage = 500; 
  private minConfidenceScore = 40; 

  // Track account health for Risk of Ruin calculation
  private accountHistory: { equity: number; timestamp: number }[] = [];
  private tradeHistory: { win: boolean; pnl: number }[] = [];

  private getLiqSafetyThreshold(): number {
    return env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 15 : 30;
  }

  validateDecision(decision: AIDecision, account: AccountStatus, currentMode: SessionMode): AIDecision {
    if (decision.final_summary !== 'PRE_SCAN_CHECK') {
      logger.info('Validating trade decision against risk rules (2% RULE ENFORCED)');
    }

    // Track account equity for Risk of Ruin calculation
    this.trackAccountEquity(account.current_equity);

    // ═══════════════════════════════════════════════════════════════
    // 0. RISK OF RUIN CHECK - Early warning system
    // ═══════════════════════════════════════════════════════════════
    const riskOfRuin = this.calculateRiskOfRuin(account);
    if (riskOfRuin.riskOfRuin > 0.50) {
      logger.fatal({ 
        riskOfRuin: riskOfRuin.riskOfRuinPercent,
        verdict: riskOfRuin.verdict 
      }, '🚨 RISK OF RUIN CRITICAL: Account survival at risk');
      cooldownManager.startCooldown(480, 'Risk of Ruin critical - 8 hour cooldown'); // 8 hours
      return { 
        ...decision, 
        decision: TradeAction.SKIP, 
        final_summary: `Blocked: Risk of Ruin CRITICAL (${riskOfRuin.riskOfRuinPercent}) - ${riskOfRuin.recommendation}` 
      };
    }

    // 0.1 Hardcore Circuit Breaker Check
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
      cooldownManager.startCooldown(240, 'Daily loss limit reached'); // 4 hours
      return { 
        ...decision, 
        decision: TradeAction.SKIP, 
        final_summary: `Blocked: Daily loss limit reached (${account.daily_pnl}%)` 
      };
    }

    if (account.loss_streak >= this.maxLossStreak) {
      logger.fatal({ streak: account.loss_streak }, '🚨 CIRCUIT BREAKER TRIGGERED: Consecutive loss streak reached.');
      cooldownManager.startCooldown(240, 'Consecutive loss streak reached'); // 4 hours
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

    // 0.2 Check for existing positions details
    for (const pos of activePositions) {
      // RULE: Do not add size to the same coin
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

    // 2. Force Leverage Limit (up to 500x)
    if (decision.leverage_suggestion > this.maxLeverage) {
      decision.leverage_suggestion = this.maxLeverage;
    }

    // 3. Apply 2% Rule - Staged Allocation based on confidence
    const stagedAllocation = this.getStagedAllocation(decision);
    decision.position_size = this.calculatePositionSizeFromAllocation(stagedAllocation, decision.position_size);

    // 4. Final 2% Rule Enforcement - Hard cap
    if (stagedAllocation > this.MAX_RISK_PER_TRADE_PCT) {
      logger.warn({ 
        requested: `${(stagedAllocation * 100).toFixed(2)}%`,
        max: `${(this.MAX_RISK_PER_TRADE_PCT * 100).toFixed(0)}%`
      }, '⚠️ 2% RULE ENFORCED: Risk reduced to maximum allowed');
    }

    return decision;
  }

  /**
   * Calculates the allowed allocation percentage based on AI confidence.
   * ENFORCES 2% RULE: Never exceed 2% risk per trade.
   * 
   * Formula: max_risk = (100% / MAX_CONSECUTIVE_LOSS) / 2
   * HIGH: 100% of max_risk (capped at 2%)
   * MEDIUM: 60% of max_risk
   * LOW: 20% of max_risk
   */
  getStagedAllocation(decision: AIDecision): number {
    const maxConsecutiveLoss = env.MAX_CONSECUTIVE_LOSS || 10;
    
    // Base risk calculation - conservative approach
    // With MAX_CONSECUTIVE_LOSS=10: base = 5%
    // But we cap at 2% MAX_RISK_PER_TRADE_PCT
    const maxRiskBase = Math.min(
      (1.0 / maxConsecutiveLoss) / 2,
      this.MAX_RISK_PER_TRADE_PCT // ENFORCE 2% RULE
    );

    // Fallback if confidence is missing
    if (!decision.confidence) {
      return Math.min(maxRiskBase * 0.5, this.MAX_RISK_PER_TRADE_PCT); // Conservative default
    }

    let multiplier = 0.2; // LOW confidence: 20% of base
    if (decision.confidence === 'HIGH') multiplier = 1.0;      // HIGH: 100% of base
    else if (decision.confidence === 'MEDIUM') multiplier = 0.6; // MEDIUM: 60% of base

    const calculatedAllocation = maxRiskBase * multiplier;

    // FINAL ENFORCEMENT: Never exceed 2% rule
    const finalAllocation = Math.min(calculatedAllocation, this.MAX_RISK_PER_TRADE_PCT);
    
    if (finalAllocation > this.MAX_RISK_PER_TRADE_PCT) {
      logger.warn({ 
        requested: finalAllocation,
        capped: this.MAX_RISK_PER_TRADE_PCT
      }, '2% RULE: Allocation capped at maximum');
    }

    return finalAllocation;
  }

  /**
   * Calculates position size from staged allocation percentage.
   * Maps allocation to PositionSize enum for compatibility.
   */
  calculatePositionSizeFromAllocation(allocation: number, currentPositionSize: PositionSize): PositionSize {
    // Map allocation percentage to PositionSize enum
    if (allocation >= 0.20) return PositionSize.NORMAL;
    if (allocation >= 0.10) return PositionSize.REDUCED;
    return PositionSize.SMALL;
  }

  calculatePositionSize(equity: number, positionSize: PositionSize): number {
    // ENFORCE 2% RULE: Maximum risk per trade
    const safeMargin = equity * this.MAX_RISK_PER_TRADE_PCT;
    
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

  // ═══════════════════════════════════════════════════════════════
  // RISK OF RUIN TRACKING & CALCULATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Track account equity over time for Risk of Ruin calculation
   */
  private trackAccountEquity(equity: number): void {
    this.accountHistory.push({
      equity,
      timestamp: Date.now()
    });

    // Keep last 1000 data points
    if (this.accountHistory.length > 1000) {
      this.accountHistory = this.accountHistory.slice(-1000);
    }
  }

  /**
   * Record trade result for Risk of Ruin calculation
   */
  recordTradeResult(win: boolean, pnl: number): void {
    this.tradeHistory.push({ win, pnl });
    
    // Keep last 100 trades
    if (this.tradeHistory.length > 100) {
      this.tradeHistory = this.tradeHistory.slice(-100);
    }
  }

  /**
   * Calculate Risk of Ruin based on current account state
   */
  calculateRiskOfRuin(account: AccountStatus) {
    // Use trade history if available, otherwise use defaults
    const recentTrades = this.tradeHistory.slice(-50);
    
    let winRate = 0.50; // Default 50%
    let avgWin = 1.5;   // Default 1.5%
    let avgLoss = 1.0;  // Default 1.0%

    if (recentTrades.length >= 10) {
      const wins = recentTrades.filter(t => t.win);
      const losses = recentTrades.filter(t => !t.win);
      
      winRate = wins.length / recentTrades.length;
      avgWin = wins.length > 0 
        ? wins.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / wins.length / account.current_equity * 100
        : 1.5;
      avgLoss = losses.length > 0
        ? losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losses.length / account.current_equity * 100
        : 1.0;
    }

    return RiskOfRuinCalculator.calculate({
      winRate,
      avgWin,
      avgLoss,
      riskPerTrade: this.MAX_RISK_PER_TRADE_PCT, // Use 2% rule
    });
  }

  /**
   * Get Risk of Ruin report for monitoring
   */
  getRiskOfRuinReport(account: AccountStatus): string {
    const ror = this.calculateRiskOfRuin(account);
    
    // Calculate win rate from trade history
    const recentTrades = this.tradeHistory.slice(-50);
    const winRate = recentTrades.length > 0 
      ? recentTrades.filter(t => t.win).length / recentTrades.length 
      : 0.50;
    
    const expectedStreak = RiskOfRuinCalculator.expectedLosingStreak(winRate);
    const maxStreak = RiskOfRuinCalculator.maxExpectedLosingStreak(winRate);

    return [
      `📊 RISK OF RUIN REPORT`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Risk of Ruin: ${ror.riskOfRuinPercent}`,
      `Verdict: ${ror.verdict}`,
      `Edge: ${(ror.edge * 100).toFixed(2)}%`,
      `Expectancy: ${(ror.expectancy * 100).toFixed(2)}% per trade`,
      `Kelly Optimal: ${(ror.kellyPercent * 100).toFixed(2)}%`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Win Rate: ${(winRate * 100).toFixed(1)}%`,
      `Expected Losing Streak: ${expectedStreak.toFixed(0)} trades`,
      `Max Expected Streak (95%): ${maxStreak} trades`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💡 ${ror.recommendation}`,
    ].join('\n');
  }

  /**
   * Validate if position size respects 2% rule
   */
  validatePositionSize(notional: number, equity: number, leverage: number): { valid: boolean; maxAllowed: number; reason?: string } {
    const marginUsed = notional / leverage;
    const riskPercent = marginUsed / equity;

    if (riskPercent > this.ABSOLUTE_MAX_RISK_PCT) {
      return {
        valid: false,
        maxAllowed: equity * this.ABSOLUTE_MAX_RISK_PCT * leverage,
        reason: `Position size ${(riskPercent * 100).toFixed(2)}% exceeds absolute max ${(this.ABSOLUTE_MAX_RISK_PCT * 100).toFixed(0)}%`
      };
    }

    if (riskPercent > this.MAX_RISK_PER_TRADE_PCT) {
      logger.warn({
        risk: `${(riskPercent * 100).toFixed(2)}%`,
        max: `${(this.MAX_RISK_PER_TRADE_PCT * 100).toFixed(0)}%`
      }, '⚠️ Position exceeds 2% rule - consider reducing');
    }

    return {
      valid: true,
      maxAllowed: equity * this.MAX_RISK_PER_TRADE_PCT * leverage,
    };
  }
}

export const riskManager = new RiskManager();
