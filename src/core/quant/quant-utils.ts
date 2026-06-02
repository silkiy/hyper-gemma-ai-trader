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
   * Kalman Filter with Adaptive Gain.
   * Dynamically adjusts measureNoise based on local volatility.
   * Volatility high -> increase measureNoise -> filter becomes more conservative.
   */
  static applyKalmanFilter(prices: number[], processNoise: number = 0.01, measureNoise: number = 0.1): number {
    const n = prices.length;
    if (n === 0) return 0;
    if (n < 10) {
      // Fallback to scalar Kalman for small samples
      let estimate = prices[0]!;
      let errorEstimate = 1.0;
      for (let i = 1; i < n; i++) {
        errorEstimate += processNoise;
        const gain = errorEstimate / (errorEstimate + measureNoise);
        estimate += gain * (prices[i]! - estimate);
        errorEstimate = (1 - gain) * errorEstimate;
      }
      return estimate;
    }

    // 1. Calculate local volatility (std dev of last 10)
    const window = prices.slice(-10);
    const localSd = standardDeviation(window);
    const localMean = mean(window);
    
    // 2. Adjust measureNoise: more noise in high volatility
    const volatilityFactor = localMean === 0 ? 0 : localSd / localMean;
    const adaptiveMeasureNoise = measureNoise * (1 + volatilityFactor * 50);

    let estimate = prices[0]!;
    let errorEstimate = 1.0;

    for (let i = 1; i < n; i++) {
      errorEstimate += processNoise;
      const kalmanGain = errorEstimate / (errorEstimate + adaptiveMeasureNoise);
      estimate += kalmanGain * (prices[i]! - estimate);
      errorEstimate = (1 - kalmanGain) * errorEstimate;
    }

    return estimate;
  }

  /**
   * Hurst Exponent (H) via Multi-Scale Rescaled Range (R/S) Analysis.
   * H < 0.45: Anti-persistent (Ranging)
   * H > 0.55: Persistent (Trending)
   */
  static hurstExponent(prices: number[]): number {
    const n = prices.length;
    if (n < 50) return 0.5;

    // 1. Calculate Log Returns: log(P_t / P_t-1)
    const returns: number[] = [];
    for (let i = 1; i < n; i++) {
      if (prices[i-1]! <= 0) continue;
      returns.push(Math.log(prices[i]! / prices[i-1]!));
    }
    if (returns.length < 40) return 0.5;

    // 2. Define sub-window scales (Powers of 2)
    const scales = [8, 16, 32, 64].filter(s => s <= returns.length);
    const logRS: number[] = [];
    const logScales: number[] = [];

    for (const scale of scales) {
      const numChunks = Math.floor(returns.length / scale);
      const chunkRS: number[] = [];

      for (let i = 0; i < numChunks; i++) {
        const chunk = returns.slice(i * scale, (i + 1) * scale);
        const chunkMean = mean(chunk);
        const chunkSd = standardDeviation(chunk);
        if (chunkSd === 0) continue;

        let cumSum = 0;
        const deviations = chunk.map(v => {
          cumSum += (v - chunkMean);
          return cumSum;
        });

        const range = Math.max(...deviations) - Math.min(...deviations);
        chunkRS.push(range / chunkSd);
      }

      if (chunkRS.length > 0) {
        logRS.push(Math.log(mean(chunkRS)));
        logScales.push(Math.log(scale));
      }
    }

    // 3. Linear Regression on Log-Log plot: log(R/S) = H*log(n) + C
    if (logRS.length < 2) return 0.5;
    
    // Simple OLS for the slope H
    const nReg = logRS.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < nReg; i++) {
      sumX += logScales[i]!;
      sumY += logRS[i]!;
      sumXY += logScales[i]! * logRS[i]!;
      sumXX += logScales[i]! * logScales[i]!;
    }

    const slope = (nReg * sumXY - sumX * sumY) / (nReg * sumXX - sumX * sumX);
    return Math.max(0, Math.min(1, isNaN(slope) ? 0.5 : slope));
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
   * Price Velocity via Weighted Least Squares (WLS) Regression.
   * Applies exponential decay weights: more importance to recent candles.
   * decay = 0.1 (default)
   */
  static calculateVelocity(prices: number[]): number {
    const n = prices.length;
    if (n < 2) return 0;

    const decay = 0.1;
    let sumW = 0, sumWX = 0, sumWY = 0, sumWXX = 0, sumWXY = 0;

    for (let i = 0; i < n; i++) {
      // Exponential weight: newest candle has highest weight
      const weight = Math.exp(decay * i);
      const x = i;
      const y = prices[i]!;

      sumW += weight;
      sumWX += weight * x;
      sumWY += weight * y;
      sumWXX += weight * x * x;
      sumWXY += weight * x * y;
    }

    // WLS Slope Formula: (SumW * SumWXY - SumWX * SumWY) / (SumW * SumWXX - SumWX^2)
    const denom = (sumW * sumWXX - sumWX * sumWX);
    if (denom === 0) return 0;
    
    return (sumW * sumWXY - sumWX * sumWY) / denom;
  }
}
