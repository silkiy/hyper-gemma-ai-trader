/**
 * Adaptive Position Sizing
 * 
 * Adjusts position size based on:
 * - Volatility (ATR)
- Account equity
- Confidence level
- Risk of Ruin
 * 
 * Based on:
 * - Ralph Vince: "The Mathematics of Money Management"
 * - Kelly Criterion optimization
 * - Anti-Martingale approach
 */

export interface PositionSizeInput {
  equity: number;
  riskPerTrade: number;        // 0-1 (e.g., 0.02 for 2%)
  confidence: number;          // 0-100
  atr: number;                 // Current ATR
  atrAverage: number;          // Average ATR
  winRate: number;             // Historical win rate
  avgWin: number;              // Average win percentage
  avgLoss: number;             // Average loss percentage
}

export interface PositionSizeResult {
  positionSize: number;        // Position size in USD
  leverage: number;            // Recommended leverage
  riskAmount: number;          // Risk amount in USD
  marginUsed: number;          // Margin used
  kellyOptimal: number;        // Kelly optimal sizing
  volatilityAdjustment: number; // Volatility-based adjustment
  confidenceAdjustment: number; // Confidence-based adjustment
  verdict: 'CONSERVATIVE' | 'OPTIMAL' | 'AGGRESSIVE';
}

export class AdaptivePositionSizer {
  /**
   * Calculate optimal position size based on multiple factors
   */
  static calculate(input: PositionSizeInput): PositionSizeResult {
    const {
      equity,
      riskPerTrade,
      confidence,
      atr,
      atrAverage,
      winRate,
      avgWin,
      avgLoss
    } = input;

    // 1. Base risk calculation (Kelly Criterion simplified)
    const kellyOptimal = this.calculateKelly(winRate, avgWin, avgLoss);
    const baseRisk = Math.min(kellyOptimal * 0.5, riskPerTrade); // Half-Kelly for safety

    // 2. Volatility adjustment
    const volatilityAdjustment = this.calculateVolatilityAdjustment(atr, atrAverage);

    // 3. Confidence adjustment
    const confidenceAdjustment = this.calculateConfidenceAdjustment(confidence);

    // 4. Calculate final position size
    const adjustedRisk = baseRisk * volatilityAdjustment * confidenceAdjustment;
    const positionSize = equity * adjustedRisk;

    // 5. Calculate leverage (position size / margin)
    const marginRequired = positionSize * 0.04; // 25x leverage = 4% margin
    const leverage = Math.min(25, positionSize / Math.max(marginRequired, 0.01));

    // 6. Calculate risk amount
    const riskAmount = positionSize * (avgLoss / 100);

    // 7. Determine verdict
    let verdict: PositionSizeResult['verdict'] = 'OPTIMAL';
    if (adjustedRisk < riskPerTrade * 0.7) verdict = 'CONSERVATIVE';
    else if (adjustedRisk > riskPerTrade * 1.2) verdict = 'AGGRESSIVE';

    return {
      positionSize: Math.max(positionSize, 0),
      leverage: Math.max(leverage, 1),
      riskAmount: Math.max(riskAmount, 0),
      marginUsed: Math.max(positionSize * 0.04, 0),
      kellyOptimal,
      volatilityAdjustment,
      confidenceAdjustment,
      verdict
    };
  }

  /**
   * Calculate Kelly Criterion optimal sizing
   */
  private static calculateKelly(winRate: number, avgWin: number, avgLoss: number): number {
    if (avgLoss === 0 || winRate <= 0 || winRate >= 1) return 0;
    
    const b = avgWin / avgLoss; // Win/Loss ratio
    const kelly = (b * winRate - (1 - winRate)) / b;
    
    return Math.max(0, Math.min(kelly, 0.25)); // Cap at 25%
  }

  /**
   * Calculate volatility adjustment
   * High volatility → reduce position size
   * Low volatility → normal position size
   */
  private static calculateVolatilityAdjustment(atr: number, atrAverage: number): number {
    if (atrAverage === 0) return 1;
    
    const volatilityRatio = atr / atrAverage;
    
    // High volatility (ratio > 1.5) → reduce position
    if (volatilityRatio > 1.5) return 0.7;
    // Low volatility (ratio < 0.5) → increase position
    if (volatilityRatio < 0.5) return 1.2;
    
    return 1; // Normal volatility
  }

  /**
   * Calculate confidence adjustment
   * Higher confidence → larger position
   * Lower confidence → smaller position
   */
  private static calculateConfidenceAdjustment(confidence: number): number {
    // Map confidence (0-100) to adjustment (0.5-1.5)
    return 0.5 + (confidence / 100);
  }

  /**
   * Calculate maximum safe position size
   * Based on account equity and risk parameters
   */
  static calculateMaxSafe(equity: number, maxRiskPercent: number = 0.02): number {
    return equity * maxRiskPercent;
  }

  /**
   * Calculate position size for win rate recovery
   * After loss, reduce position size to recover faster
   */
  static calculateRecoverySize(
    equity: number,
    lossStreak: number,
    baseRisk: number = 0.02
  ): number {
    // Reduce position size after consecutive losses
    const reductionFactor = Math.max(0.5, 1 - (lossStreak * 0.1));
    return equity * baseRisk * reductionFactor;
  }
}
