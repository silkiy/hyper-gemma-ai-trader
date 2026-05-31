import { mean, standardDeviation } from 'simple-statistics';

export class QuantUtils {
  /**
   * Z-Score measures how many standard deviations a value is from the mean.
   * Used for Mean Reversion (Z < -2.0) or extreme Momentum detection.
   */
  static calculateZScore(prices: number[]): number {
    if (prices.length < 2) return 0;
    const avg = mean(prices);
    const sd = standardDeviation(prices);
    const lastPrice = prices[prices.length - 1]!;
    return sd === 0 ? 0 : (lastPrice - avg) / sd;
  }

  /**
   * Kalman Filter reduces noise from price data without the lag of moving averages.
   * Useful for identifying the 'True Trend' in volatile markets.
   */
  static applyKalmanFilter(prices: number[], processNoise: number = 0.01, measureNoise: number = 0.1): number {
    if (prices.length === 0) return 0;
    
    let estimate = prices[0]!;
    let errorEstimate = 1.0;

    for (let i = 1; i < prices.length; i++) {
      // Prediction step
      errorEstimate = errorEstimate + processNoise;

      // Update step
      const kalmanGain = errorEstimate / (errorEstimate + measureNoise);
      estimate = estimate + kalmanGain * (prices[i]! - estimate);
      errorEstimate = (1 - kalmanGain) * errorEstimate;
    }

    return estimate;
  }

  /**
   * Simple linear regression to find price velocity (slope).
   */
  static calculateVelocity(prices: number[]): number {
    if (prices.length < 2) return 0;
    const x = Array.from({ length: prices.length }, (_, i) => i);
    const y = prices;
    
    const n = prices.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += x[i]!;
      sumY += y[i]!;
      sumXY += x[i]! * y[i]!;
      sumXX += x[i]! * x[i]!;
    }
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
}
