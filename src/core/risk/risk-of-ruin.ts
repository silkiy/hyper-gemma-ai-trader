/**
 * Risk of Ruin Calculator
 * 
 * Probabilitas akun trading habis tanpa sisa.
 * Berdasarkan formula: RoR = ((1 - edge) / (1 + edge)) ^ units
 * 
 * edge = win_rate * avg_win - (1 - win_rate) * avg_loss
 * units = account / (risk_per_trade * account)
 * 
 * References:
 * - Van Tharp: "Trade Your Way to Financial Freedom"
 * - Ralph Vince: "The Mathematics of Money Management"
 */

export interface RiskOfRuinInput {
  winRate: number;          // 0-1 (e.g., 0.60 = 60%)
  avgWin: number;           // Average win in % (e.g., 2.0 = 2%)
  avgLoss: number;          // Average loss in % (e.g., 1.0 = 1%)
  riskPerTrade: number;     // Risk per trade in % (e.g., 0.02 = 2%)
  maxConsecutiveLoss?: number; // Expected max consecutive loss (optional)
}

export interface RiskOfRuinResult {
  riskOfRuin: number;       // 0-1 (probability)
  riskOfRuinPercent: string; // Formatted percentage
  edge: number;             // Trading edge
  expectancy: number;       // Expected value per trade
  kellyPercent: number;     // Kelly criterion optimal sizing
  maxDrawdown: number;      // Expected max drawdown %
  survivalProbability: number; // Probability of survival
  verdict: 'SAFE' | 'CAUTION' | 'DANGER' | 'CRITICAL';
  recommendation: string;
}

export class RiskOfRuinCalculator {
  /**
   * Calculate Risk of Ruin using simplified formula
   */
  static calculate(input: RiskOfRuinInput): RiskOfRuinResult {
    const { winRate, avgWin, avgLoss, riskPerTrade } = input;

    // 1. Calculate Edge (Expected Value per unit risked)
    const edge = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // 2. Calculate Expectancy (per trade)
    const expectancy = edge;

    // 3. Kelly Criterion (optimal risk per trade)
    // f* = (bp - q) / b
    // b = avgWin/avgLoss, p = winRate, q = 1-winRate
    const b = avgWin / avgLoss;
    const kellyPercent = ((b * winRate) - (1 - winRate)) / b;

    // 4. Risk of Ruin formula (simplified)
    // RoR = ((1 - edge) / (1 + edge)) ^ (1 / riskPerTrade)
    // Cap at 100% for extreme cases
    let riskOfRuin: number;
    if (edge <= 0) {
      riskOfRuin = 1.0; // 100% - negative edge guarantees ruin
    } else {
      const base = (1 - edge) / (1 + edge);
      const exponent = 1 / riskPerTrade;
      riskOfRuin = Math.pow(Math.abs(base), exponent);
      riskOfRuin = Math.min(1, Math.max(0, riskOfRuin));
    }

    // 5. Expected Max Drawdown (approximation)
    // Using formula: MaxDD ≈ riskPerTrade * sqrt(nTrades)
    // Conservative estimate for 100 trades
    const maxDrawdown = riskPerTrade * Math.sqrt(100) * 2;

    // 6. Survival Probability
    const survivalProbability = 1 - riskOfRuin;

    // 7. Determine Verdict
    let verdict: RiskOfRuinResult['verdict'];
    let recommendation: string;

    if (riskOfRuin < 0.05) {
      verdict = 'SAFE';
      recommendation = 'Risk per trade dalam batas aman. Akun mampu bertahan melalui losing streak.';
    } else if (riskOfRuin < 0.20) {
      verdict = 'CAUTION';
      recommendation = 'Risk per trade mendekati batas bahaya. Pertimbangkan mengurangi sizing.';
    } else if (riskOfRuin < 0.50) {
      verdict = 'DANGER';
      recommendation = '⚠️ Risk per trade terlalu tinggi! Akun rentan habis karena losing streak.';
    } else {
      verdict = 'CRITICAL';
      recommendation = '🚨 KRITIS! Risk per trade hampir menjamin kehancuran akun. Kurangi segera!';
    }

    return {
      riskOfRuin,
      riskOfRuinPercent: `${(riskOfRuin * 100).toFixed(2)}%`,
      edge,
      expectancy,
      kellyPercent: Math.max(0, kellyPercent),
      maxDrawdown: Math.min(maxDrawdown, 100),
      survivalProbability,
      verdict,
      recommendation,
    };
  }

  /**
   * Calculate expected losing streak length
   * Using geometric distribution: E[streak] = 1 / (1 - winRate)
   */
  static expectedLosingStreak(winRate: number): number {
    if (winRate >= 1) return 0;
    if (winRate <= 0) return Infinity;
    return 1 / (1 - winRate);
  }

  /**
   * Calculate max expected losing streak (95% confidence)
   * Using: max_streak = log(0.05) / log(1 - winRate)
   */
  static maxExpectedLosingStreak(winRate: number): number {
    if (winRate >= 1) return 0;
    if (winRate <= 0) return Infinity;
    return Math.ceil(Math.log(0.05) / Math.log(1 - winRate));
  }

  /**
   * Simulate account survival over N trades
   */
  static simulateSurvival(
    initialCapital: number,
    winRate: number,
    avgWin: number,
    avgLoss: number,
    riskPerTrade: number,
    numTrades: number,
    simulations: number = 1000
  ): { survivalRate: number; avgFinalCapital: number; maxDrawdown: number } {
    let survived = 0;
    let totalFinalCapital = 0;
    let worstDrawdown = 0;

    for (let sim = 0; sim < simulations; sim++) {
      let capital = initialCapital;
      let peak = capital;
      let maxDrawdown = 0;

      for (let trade = 0; trade < numTrades; trade++) {
        if (capital <= 0) break;

        const riskAmount = capital * riskPerTrade;
        
        if (Math.random() < winRate) {
          capital += riskAmount * (avgWin / riskPerTrade);
        } else {
          capital -= riskAmount;
        }

        peak = Math.max(peak, capital);
        const drawdown = (peak - capital) / peak;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }

      if (capital > 0) survived++;
      totalFinalCapital += capital;
      worstDrawdown = Math.max(worstDrawdown, maxDrawdown);
    }

    return {
      survivalRate: survived / simulations,
      avgFinalCapital: totalFinalCapital / simulations,
      maxDrawdown: worstDrawdown,
    };
  }

  /**
   * Get recommended risk per trade based on win rate and R:R ratio
   */
  static getRecommendedRisk(winRate: number, avgWin: number, avgLoss: number): number {
    const result = this.calculate({
      winRate,
      avgWin,
      avgLoss,
      riskPerTrade: 0.02, // Start with 2%
    });

    // If risk of ruin is acceptable, return 2%
    if (result.riskOfRuin < 0.10) return 0.02;

    // Otherwise, calculate optimal using Kelly (with half-Kelly for safety)
    const halfKelly = result.kellyPercent / 2;
    return Math.min(0.02, Math.max(0.005, halfKelly)); // Cap at 2%, floor at 0.5%
  }
}
