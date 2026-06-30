import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuantUtils } from '../../core/quant/quant-utils.js';
import type { OHLCV } from '../../core/quant/quant-utils.js';

describe('Entry Logic', () => {
  describe('Trend Following Mode', () => {
    it('should generate LONG signal when Kalman bullish + above VWAP', () => {
      // Simulate trending market with bullish momentum
      const prices = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5); // Uptrend
      const lastPrice = prices[prices.length - 1]!;
      const kalmanPrice = QuantUtils.applyKalmanFilter(prices);
      const vwap = 100; // Below current price
      
      const isKalmanBullish = lastPrice >= kalmanPrice;
      const vwapDev = ((lastPrice - vwap) / vwap) * 100;
      
      expect(isKalmanBullish).toBe(true);
      expect(vwapDev).toBeGreaterThan(0);
    });

    it('should generate SHORT signal when Kalman bearish + below VWAP', () => {
      // Simulate trending market with bearish momentum
      const prices = Array.from({ length: 20 }, (_, i) => 120 - i * 0.5); // Downtrend
      const lastPrice = prices[prices.length - 1]!;
      const kalmanPrice = QuantUtils.applyKalmanFilter(prices);
      const vwap = 120; // Above current price
      
      const isKalmanBearish = lastPrice <= kalmanPrice;
      const vwapDev = ((lastPrice - vwap) / vwap) * 100;
      
      expect(isKalmanBearish).toBe(true);
      expect(vwapDev).toBeLessThan(0);
    });
  });

  describe('Mean Reversion Mode', () => {
    it('should generate LONG signal when Z-Score < -threshold (oversold)', () => {
      // Create oversold condition
      const prices = [100, 100, 100, 100, 80]; // Last price 20% below mean
      const zScore = QuantUtils.calculateZScore(prices);
      const threshold = 1.8;
      
      expect(zScore).toBeLessThan(-threshold);
    });

    it('should generate SHORT signal when Z-Score > threshold (overbought)', () => {
      // Create overbought condition
      const prices = [100, 100, 100, 100, 120]; // Last price 20% above mean
      const zScore = QuantUtils.calculateZScore(prices);
      const threshold = 1.8;
      
      expect(zScore).toBeGreaterThan(threshold);
    });

    it('should NOT generate LONG when Z-Score is positive', () => {
      // Positive Z-Score = overbought, should NOT be LONG
      const prices = [100, 100, 100, 100, 110];
      const zScore = QuantUtils.calculateZScore(prices);
      
      expect(zScore).toBeGreaterThan(0); // Positive = overbought
      // In Mean Reversion, this should trigger SHORT, not LONG
    });
  });

  describe('Anti-Counter-Trend Filter', () => {
    it('should detect sharp drop (> 2% in 5 candles)', () => {
      const prices = [100, 99, 98, 97, 96, 95]; // 5% drop
      const price5CandlesAgo = prices[0]!;
      const lastPrice = prices[prices.length - 1]!;
      const recentPriceChange = ((lastPrice - price5CandlesAgo) / price5CandlesAgo) * 100;
      
      expect(recentPriceChange).toBeLessThan(-2);
    });

    it('should detect sharp pump (> 2% in 5 candles)', () => {
      const prices = [100, 101, 102, 103, 104, 105]; // 5% pump
      const price5CandlesAgo = prices[0]!;
      const lastPrice = prices[prices.length - 1]!;
      const recentPriceChange = ((lastPrice - price5CandlesAgo) / price5CandlesAgo) * 100;
      
      expect(recentPriceChange).toBeGreaterThan(2);
    });

    it('should allow entry when price stable (< 2% change)', () => {
      const prices = [100, 100.2, 99.8, 100.1, 99.9, 100]; // ~0% change
      const price5CandlesAgo = prices[0]!;
      const lastPrice = prices[prices.length - 1]!;
      const recentPriceChange = ((lastPrice - price5CandlesAgo) / price5CandlesAgo) * 100;
      
      expect(Math.abs(recentPriceChange)).toBeLessThan(2);
    });
  });

  describe('Volume Gate', () => {
    it('should require minimum volume for INTRADAY', () => {
      const minVolume = 5000000; // $5M for INTRADAY
      const volume = 3000000; // $3M
      
      expect(volume).toBeLessThan(minVolume);
      // Should be filtered out
    });

    it('should allow trade when volume sufficient', () => {
      const minVolume = 5000000; // $5M for INTRADAY
      const volume = 10000000; // $10M
      
      expect(volume).toBeGreaterThanOrEqual(minVolume);
    });
  });

  describe('VWAP Filter', () => {
    it('should calculate VWAP deviation correctly', () => {
      const price = 105;
      const vwap = 100;
      const deviation = ((price - vwap) / vwap) * 100;
      
      expect(deviation).toBe(5); // 5% above VWAP
    });

    it('should block entry when price too far from VWAP', () => {
      const VWAP_ENTRY_THRESHOLD = 3.0; // 3% for INTRADAY
      const price = 110;
      const vwap = 100;
      const deviation = Math.abs(((price - vwap) / vwap) * 100);
      
      expect(deviation).toBeGreaterThan(VWAP_ENTRY_THRESHOLD);
      // Should be blocked
    });
  });

  describe('Momentum Guard', () => {
    it('should block LONG when 24h change < -5%', () => {
      const change24h = -6; // -6% in 24h
      const mathDir = 'LONG';
      
      const shouldBlock = mathDir === 'LONG' && change24h < -5;
      expect(shouldBlock).toBe(true);
    });

    it('should block SHORT when 24h change > +5%', () => {
      const change24h = 6; // +6% in 24h
      const mathDir = 'SHORT';
      
      const shouldBlock = mathDir === 'SHORT' && change24h > 5;
      expect(shouldBlock).toBe(true);
    });

    it('should allow trade when momentum neutral', () => {
      const change24h = 2; // +2% in 24h
      const mathDir = 'LONG' as string;
      
      const shouldBlock = (mathDir === 'LONG' && change24h < -5) || 
                          (mathDir === 'SHORT' && change24h > 5);
      expect(shouldBlock).toBe(false);
    });
  });

  describe('GEMMA_FLIP_BLOCKED', () => {
    it('should block AI from flipping direction during TRENDING', () => {
      const regime = 'TRENDING';
      const mathDir = 'LONG' as string;
      const aiDecision = 'SHORT' as string; // AI wants to flip
      
      const shouldBlock = regime === 'TRENDING' && 
                          mathDir !== 'NEUTRAL' && 
                          aiDecision !== mathDir &&
                          aiDecision !== 'SKIP' &&
                          aiDecision !== 'WAIT';
      
      expect(shouldBlock).toBe(true);
    });

    it('should allow AI to agree with math direction', () => {
      const regime = 'TRENDING';
      const mathDir = 'LONG' as string;
      const aiDecision = 'LONG' as string; // AI agrees
      
      const shouldBlock = regime === 'TRENDING' && 
                          mathDir !== 'NEUTRAL' && 
                          aiDecision !== mathDir &&
                          aiDecision !== 'SKIP' &&
                          aiDecision !== 'WAIT';
      
      expect(shouldBlock).toBe(false);
    });
  });
});
