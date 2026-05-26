import { Decimal } from 'decimal.js';

export class IndicatorEngine {
  /**
   * Simple Exponential Moving Average calculation
   */
  calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] ?? 0;
    
    const k = 2 / (period + 1);
    let ema = prices[0] ?? 0;
    
    for (let i = 1; i < prices.length; i++) {
      const price = prices[i] ?? 0;
      ema = price * k + ema * (1 - k);
    }
    
    return new Decimal(ema).toDecimalPlaces(2).toNumber();
  }

  /**
   * Relative Strength Index calculation
   */
  calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length <= period) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const current = prices[i] ?? 0;
      const previous = prices[i - 1] ?? 0;
      const diff = current - previous;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    if (losses === 0) return 100;
    
    const rs = gains / losses;
    const rsi = 100 - (100 / (1 + rs));
    
    return new Decimal(rsi).toDecimalPlaces(2).toNumber();
  }

  /**
   * Average True Range calculation
   */
  calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (closes.length <= period) return 0;
    
    let trSum = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const high = highs[i] ?? 0;
      const low = lows[i] ?? 0;
      const prevClose = closes[i - 1] ?? 0;
      
      const hl = high - low;
      const hpc = Math.abs(high - prevClose);
      const lpc = Math.abs(low - prevClose);
      trSum += Math.max(hl, hpc, lpc);
    }
    
    return new Decimal(trSum / period).toDecimalPlaces(2).toNumber();
  }
}

export const indicatorEngine = new IndicatorEngine();
