import { QuantUtils } from './quant-utils.js';
import { directiveRepository } from '../../database/repositories/directive.repository.js';
import { logger } from '../../utils/logger.js';
import { TradeAction, MarketRegime, RiskLevel, PositionSize } from '../../types/enum.types.js';
import type { AIDecision } from '../../types/ai.types.js';

export class QuantEngine {
  /**
   * Evaluates a symbol in the "Hot Path" (milliseconds).
   * It does NOT call any AI. It uses pure mathematics + Gemma's Directives.
   */
  async evaluateHighSpeed(symbol: string, currentPrices: number[]): Promise<{ decision: AIDecision | null, zScore: number, threshold: number }> {
    const directive = await directiveRepository.getLatest();
    if (!directive) return { decision: null, zScore: 0, threshold: 0 };

    const threshold = directive.bias === 'NEUTRAL' ? 2.2 : directive.z_score_threshold;

    // 1. Calculate Primitives
    const zScore = QuantUtils.calculateZScore(currentPrices);
    const kalmanPrice = QuantUtils.applyKalmanFilter(currentPrices, directive.kalman_aggressiveness);
    const lastPrice = currentPrices[currentPrices.length - 1]!;
    const prevPrice = currentPrices.length > 1 ? currentPrices[currentPrices.length - 2]! : lastPrice;
    
    // 2. Micro-Bounce Confirmation (Anti-Falling Knife)
    const isBouncingUp = lastPrice >= prevPrice;
    const isBouncingDown = lastPrice <= prevPrice;

    // 3. Execution Logic (Tactical Opportunist)
    let decision: TradeAction = TradeAction.SKIP;

    // LONG trigger
    if ((directive.bias === 'LONG' && zScore < -threshold) || (directive.bias === 'NEUTRAL' && zScore <= -2.2)) {
      if (isBouncingUp) decision = TradeAction.LONG;
      else {
        // Log skip reason for high Z-Score
        // process.stdout.write(`\r[QUANT PULSE] ${symbol} hit Z-Score ${zScore.toFixed(2)} but waiting for bounce...      `);
      }
    }
    // SHORT trigger
    else if ((directive.bias === 'SHORT' && zScore > threshold) || (directive.bias === 'NEUTRAL' && zScore >= 2.2)) {
      if (isBouncingDown) decision = TradeAction.SHORT;
    }

    if (decision === TradeAction.SKIP) return { decision: null, zScore, threshold };

    const confidence = Math.min(Math.abs(zScore) * 30, 95);

    logger.info({ 
      symbol, 
      decision, 
      zScore: zScore.toFixed(2), 
      bias: directive.bias 
    }, '⚡ HOT PATH: Quant execution triggered');

    return {
      decision: {
        decision,
        confidence_score: confidence,
        market_regime: MarketRegime.VOLATILE,
        risk_level: RiskLevel.MEDIUM,
        leverage_suggestion: directive.max_leverage,
        position_size: PositionSize.NORMAL,
        entry_reason: `Quant Trigger: Z-Score ${zScore.toFixed(2)} (${isBouncingUp ? 'Bounced Up' : 'Bounced Down'}) with ${directive.bias} bias.`,
        risk_factors: [`Z-Score deviation at ${zScore.toFixed(2)}`],
        stop_loss_logic: 'ATR Based (Quant)',
        take_profit_logic: 'R/R 1.5 (Quant)',
        self_reflection: 'Mathematical trigger without AI latency.',
        final_summary: `Direct hit on mathematical threshold set by Strategist.`
      },
      zScore,
      threshold
    };
  }
}

export const quantEngine = new QuantEngine();
