/**
 * Order Flow Analysis
 * 
 * Analyzes buying/selling pressure from volume data
 * Detects imbalance and potential reversals
 * 
 * Based on:
 * - Auction Market Theory
 * - Volume Spread Analysis (VSA)
 * - Order Flow Imbalance Detection
 */

import type { OHLCV } from '../quant/quant-utils.js';

export interface OrderFlowResult {
  buyPressure: number;      // 0-100, buying pressure score
  sellPressure: number;     // 0-100, selling pressure score
  imbalance: number;        // -1 to 1, negative = sell pressure, positive = buy pressure
  delta: number;            // Volume delta (buy volume - sell volume)
  cumulativeDelta: number;  // Cumulative delta over period
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;       // 0-100
}

export class OrderFlowAnalyzer {
  /**
   * Analyze order flow from OHLCV data
   * Uses candle body and volume to estimate buy/sell pressure
   */
  static analyze(ohlcv: OHLCV[]): OrderFlowResult {
    if (ohlcv.length < 5) {
      return {
        buyPressure: 50,
        sellPressure: 50,
        imbalance: 0,
        delta: 0,
        cumulativeDelta: 0,
        trend: 'NEUTRAL',
        confidence: 0
      };
    }

    let buyVolume = 0;
    let sellVolume = 0;
    let cumulativeDelta = 0;

    // Analyze each candle
    for (const candle of ohlcv) {
      const bodyRange = candle.c - candle.o;
      const totalRange = candle.h - candle.l;
      
      if (totalRange === 0) continue;
      
      // Estimate buy/sell ratio based on close position
      const closePosition = (candle.c - candle.l) / totalRange;
      const buyRatio = closePosition;
      const sellRatio = 1 - closePosition;
      
      buyVolume += candle.v * buyRatio;
      sellVolume += candle.v * sellRatio;
      
      // Calculate delta
      const delta = (buyRatio - sellRatio) * candle.v;
      cumulativeDelta += delta;
    }

    // Calculate pressures (0-100)
    const totalVolume = buyVolume + sellVolume;
    const buyPressure = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 50;
    const sellPressure = totalVolume > 0 ? (sellVolume / totalVolume) * 100 : 50;

    // Calculate imbalance (-1 to 1)
    const imbalance = totalVolume > 0 ? (buyVolume - sellVolume) / totalVolume : 0;

    // Determine trend
    let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (imbalance > 0.1) trend = 'BULLISH';
    else if (imbalance < -0.1) trend = 'BEARISH';

    // Calculate confidence based on volume and imbalance
    const volumeRatio = totalVolume / ohlcv.length;
    const avgVolume = ohlcv.reduce((sum, c) => sum + c.v, 0) / ohlcv.length;
    const volumeConfidence = avgVolume > 0 ? Math.min(volumeRatio / avgVolume, 1) * 50 : 50;
    const imbalanceConfidence = Math.abs(imbalance) * 100;
    const confidence = Math.min(volumeConfidence + imbalanceConfidence, 100);

    return {
      buyPressure,
      sellPressure,
      imbalance,
      delta: buyVolume - sellVolume,
      cumulativeDelta,
      trend,
      confidence
    };
  }

  /**
   * Detect absorption (large volume but small price movement)
   */
  static detectAbsorption(ohlcv: OHLCV[], window: number = 5): {
    detected: boolean;
    type: 'BULLISH' | 'BEARISH' | null;
    strength: number;
  } {
    if (ohlcv.length < window) {
      return { detected: false, type: null, strength: 0 };
    }

    const recent = ohlcv.slice(-window);
    const avgVolume = recent.reduce((sum, c) => sum + c.v, 0) / window;
    const avgRange = recent.reduce((sum, c) => sum + (c.h - c.l), 0) / window;

    // Check for absorption: high volume but small range
    const lastCandle = recent[recent.length - 1];
    if (!lastCandle) {
      return { detected: false, type: null, strength: 0 };
    }
    
    const volumeRatio = avgVolume > 0 ? lastCandle.v / avgVolume : 0;
    const rangeRatio = avgRange > 0 ? (lastCandle.h - lastCandle.l) / avgRange : 0;

    // Absorption: volume > 2x average but range < 0.5x average
    const detected = volumeRatio > 2 && rangeRatio < 0.5;

    let type: 'BULLISH' | 'BEARISH' | null = null;
    if (detected) {
      // Check if close is near high (bullish absorption) or low (bearish absorption)
      const closePosition = (lastCandle.c - lastCandle.l) / (lastCandle.h - lastCandle.l || 1);
      type = closePosition > 0.7 ? 'BULLISH' : 'BEARISH';
    }

    const strength = Math.min(volumeRatio / 2, 1) * 100;

    return { detected, type, strength };
  }

  /**
   * Calculate volume trend
   */
  static getVolumeTrend(ohlcv: OHLCV[], window: number = 10): {
    trend: 'INCREASING' | 'DECREASING' | 'STABLE';
    ratio: number;
  } {
    if (ohlcv.length < window * 2) {
      return { trend: 'STABLE', ratio: 1 };
    }

    const recent = ohlcv.slice(-window);
    const older = ohlcv.slice(-window * 2, -window);

    const recentAvg = recent.reduce((sum, c) => sum + c.v, 0) / window;
    const olderAvg = older.reduce((sum, c) => sum + c.v, 0) / window;

    const ratio = olderAvg > 0 ? recentAvg / olderAvg : 1;

    let trend: 'INCREASING' | 'DECREASING' | 'STABLE' = 'STABLE';
    if (ratio > 1.2) trend = 'INCREASING';
    else if (ratio < 0.8) trend = 'DECREASING';

    return { trend, ratio };
  }
}
