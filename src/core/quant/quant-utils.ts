import { mean, standardDeviation } from 'simple-statistics';

export interface OHLCV {
  t: number; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export class QuantUtils {
  /**
   * Z-Score measures how many standard deviations a value is from the mean.
   * Used for detecting short-term anomalies.
   */
  static calculateZScore(prices: number[]): number {
    if (prices.length < 2) return 0;
    const avg = mean(prices);
    const sd = standardDeviation(prices);
    const lastPrice = prices[prices.length - 1]!;
    
    if (sd === 0) return 0;
    return (lastPrice - avg) / sd;
  }

  /**
   * Kalman Filter reduces noise from price data.
   * Identifies the 'True Trend' without the lag of moving averages.
   */
  static applyKalmanFilter(prices: number[], processNoise: number = 0.01, measureNoise: number = 0.1): number {
    if (prices.length === 0) return 0;
    
    let estimate = prices[0]!;
    let errorEstimate = 1.0;

    for (let i = 1; i < prices.length; i++) {
      errorEstimate = errorEstimate + processNoise;
      const kalmanGain = errorEstimate / (errorEstimate + measureNoise);
      estimate = estimate + kalmanGain * (prices[i]! - estimate);
      errorEstimate = (1 - kalmanGain) * errorEstimate;
    }

    return estimate;
  }

  /**
   * Hurst Exponent (H) determines the market regime.
   * H < 0.45: Mean-reverting (Anti-persistent)
   * H > 0.55: Trending (Persistent)
   * n = window size
   */
  static hurstExponent(prices: number[]): number {
    const n = prices.length;
    if (n < 50) return 0.5; // Neutral default for small samples

    // 1. Log returns
    const returns: number[] = [];
    for (let i = 1; i < n; i++) {
      if (prices[i-1] === 0 || prices[i-1] === undefined || prices[i] === undefined) continue;
      returns.push(Math.log(prices[i]! / prices[i-1]!));
    }

    if (returns.length < 2) return 0.5;

    // 2. Simplified Rescaled Range (R/S) for Hot Path efficiency
    const avg = mean(returns);
    const std = standardDeviation(returns);
    if (std === 0) return 0.5;

    let cumSum = 0;
    const deviations = returns.map(r => {
      cumSum += (r - avg);
      return cumSum;
    });

    const range = Math.max(...deviations) - Math.min(...deviations);
    const rs = range / std;

    // H = log(RS) / log(n)
    const hurst = Math.log(rs) / Math.log(returns.length);
    
    // Clamp result for safety
    return Math.max(0, Math.min(1, hurst));
  }

  /**
   * VWAP (Volume Weighted Average Price)
   * Sigma(Typical Price * Volume) / Sigma(Volume)
   */
  static calculateVWAP(ohlcv: OHLCV[]): number {
    if (ohlcv.length === 0) return 0;

    let sumPV = 0;
    let sumV = 0;

    for (const candle of ohlcv) {
      const typicalPrice = (candle.h + candle.l + candle.c) / 3;
      sumPV += typicalPrice * candle.v;
      sumV += candle.v;
    }

    return sumV === 0 ? ohlcv[ohlcv.length - 1]!.c : sumPV / sumV;
  }

  /**
   * Deviation from VWAP in percentage
   */
  static vwapDeviation(price: number, vwap: number): number {
    if (vwap === 0) return 0;
    return ((price - vwap) / vwap) * 100;
  }

  /**
   * Linear regression slope to find price velocity
   */
  static calculateVelocity(prices: number[]): number {
    const n = prices.length;
    if (n < 2) return 0;
    
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i]!;
      sumXY += i * prices[i]!;
      sumXX += i * i;
    }
    
    const denom = (n * sumXX - sumX * sumX);
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  }
}
