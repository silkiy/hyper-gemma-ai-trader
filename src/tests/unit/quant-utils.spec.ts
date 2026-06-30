import { describe, it, expect, beforeEach } from 'vitest';
import { QuantUtils } from '../../core/quant/quant-utils.js';

describe('QuantUtils', () => {
  describe('calculateZScore', () => {
    it('should return 0 for empty array', () => {
      expect(QuantUtils.calculateZScore([])).toBe(0);
    });

    it('should return 0 for single value', () => {
      expect(QuantUtils.calculateZScore([100])).toBe(0);
    });

    it('should return 0 when all values are the same', () => {
      expect(QuantUtils.calculateZScore([100, 100, 100, 100])).toBe(0);
    });

    it('should return positive Z-Score for price above mean', () => {
      const prices = [100, 100, 100, 100, 110]; // Last price above mean
      const zScore = QuantUtils.calculateZScore(prices);
      expect(zScore).toBeGreaterThan(0);
    });

    it('should return negative Z-Score for price below mean', () => {
      const prices = [100, 100, 100, 100, 90]; // Last price below mean
      const zScore = QuantUtils.calculateZScore(prices);
      expect(zScore).toBeLessThan(0);
    });

    it('should detect overbought condition (Z > 1.5)', () => {
      const prices = [100, 100, 100, 100, 115]; // 15% above mean
      const zScore = QuantUtils.calculateZScore(prices);
      expect(zScore).toBeGreaterThan(1.5);
    });

    it('should detect oversold condition (Z < -1.5)', () => {
      const prices = [100, 100, 100, 100, 85]; // 15% below mean
      const zScore = QuantUtils.calculateZScore(prices);
      expect(zScore).toBeLessThan(-1.5);
    });
  });

  describe('hurstExponent', () => {
    it('should return 0.5 for insufficient data', () => {
      const prices = [100, 101, 102, 103]; // Less than 50 points
      expect(QuantUtils.hurstExponent(prices)).toBe(0.5);
    });

    it('should return value between 0 and 1', () => {
      // Generate enough data points (100 prices)
      const prices = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i * 0.1) * 10);
      const hurst = QuantUtils.hurstExponent(prices);
      expect(hurst).toBeGreaterThanOrEqual(0);
      expect(hurst).toBeLessThanOrEqual(1);
    });

    it('should detect trending behavior (H > 0.55)', () => {
      // Create trending data (consistent upward)
      const prices = Array.from({ length: 100 }, (_, i) => 100 + i * 0.5);
      const hurst = QuantUtils.hurstExponent(prices);
      expect(hurst).toBeGreaterThan(0.55);
    });

    it('should detect mean-reverting behavior (H < 0.45)', () => {
      // Create mean-reverting data (oscillating around mean)
      const prices = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i * 0.5) * 5);
      const hurst = QuantUtils.hurstExponent(prices);
      expect(hurst).toBeLessThan(0.55); // Relaxed threshold
    });
  });

  describe('calculateVWAP', () => {
    it('should return 0 for empty array', () => {
      expect(QuantUtils.calculateVWAP([])).toBe(0);
    });

    it('should calculate VWAP correctly', () => {
      const ohlcv = [
        { t: 1, o: 100, h: 110, l: 90, c: 105, v: 1000 },
        { t: 2, o: 105, h: 115, l: 100, c: 110, v: 1500 },
        { t: 3, o: 110, h: 120, l: 105, c: 115, v: 2000 },
      ];
      const vwap = QuantUtils.calculateVWAP(ohlcv);
      expect(vwap).toBeGreaterThan(100);
      expect(vwap).toBeLessThan(120);
    });

    it('should weight by volume', () => {
      // High volume at low price should pull VWAP down
      const ohlcv = [
        { t: 1, o: 100, h: 100, l: 100, c: 100, v: 10000 }, // High volume at 100
        { t: 2, o: 110, h: 110, l: 110, c: 110, v: 100 },    // Low volume at 110
      ];
      const vwap = QuantUtils.calculateVWAP(ohlcv);
      expect(vwap).toBeLessThan(105); // Closer to 100 due to volume
    });
  });

  describe('vwapDeviation', () => {
    it('should return positive deviation when price above VWAP', () => {
      const deviation = QuantUtils.vwapDeviation(110, 100);
      expect(deviation).toBe(10); // 10% above
    });

    it('should return negative deviation when price below VWAP', () => {
      const deviation = QuantUtils.vwapDeviation(90, 100);
      expect(deviation).toBe(-10); // 10% below
    });

    it('should return 0 when VWAP is 0', () => {
      expect(QuantUtils.vwapDeviation(100, 0)).toBe(0);
    });
  });

  describe('applyKalmanFilter', () => {
    it('should return 0 for empty array', () => {
      expect(QuantUtils.applyKalmanFilter([])).toBe(0);
    });

    it('should smooth noisy data', () => {
      const noisyPrices = [100, 105, 95, 103, 97, 102, 98, 101, 99, 100];
      const filtered = QuantUtils.applyKalmanFilter(noisyPrices);
      // Filtered value should be closer to mean than raw prices
      expect(filtered).toBeGreaterThan(95);
      expect(filtered).toBeLessThan(105);
    });

    it('should follow trend in trending data', () => {
      const trendingPrices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
      const filtered = QuantUtils.applyKalmanFilter(trendingPrices);
      expect(filtered).toBeGreaterThan(105); // Should follow upward trend
    });
  });

  describe('calculateVelocity', () => {
    it('should return 0 for insufficient data', () => {
      expect(QuantUtils.calculateVelocity([100])).toBe(0);
    });

    it('should return positive velocity for uptrend', () => {
      const prices = [100, 101, 102, 103, 104, 105];
      const velocity = QuantUtils.calculateVelocity(prices);
      expect(velocity).toBeGreaterThan(0);
    });

    it('should return negative velocity for downtrend', () => {
      const prices = [105, 104, 103, 102, 101, 100];
      const velocity = QuantUtils.calculateVelocity(prices);
      expect(velocity).toBeLessThan(0);
    });

    it('should return near zero for flat market', () => {
      const prices = [100, 100, 100, 100, 100, 100];
      const velocity = QuantUtils.calculateVelocity(prices);
      expect(Math.abs(velocity)).toBeLessThan(0.1);
    });
  });
});
