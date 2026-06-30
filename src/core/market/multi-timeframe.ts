/**
 * Multi-Timeframe Confirmation
 * 
 * Confirms signals across multiple timeframes
 * Higher timeframe = stronger confirmation
 * 
 * Based on:
 * - Steve Nison: "Japanese Candlestick Charting Techniques"
 * - Multiple timeframe analysis principles
 */

import { QuantUtils } from '../quant/quant-utils.js';
import type { OHLCV } from '../quant/quant-utils.js';

export interface TimeframeResult {
  timeframe: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number;        // 0-100
  hurst: number;
  zScore: number;
  confirmed: boolean;
}

export interface MultiTimeframeResult {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number;        // 0-100
  confirmation: number;    // Number of timeframes confirming
  timeframes: TimeframeResult[];
  verdict: 'STRONG' | 'MODERATE' | 'WEAK' | 'NO_SIGNAL';
}

export class MultiTimeframeAnalyzer {
  /**
   * Analyze multiple timeframes for confirmation
   * @param macroOHLCV - Higher timeframe data (e.g., 1H)
   * @param microOHLCV - Lower timeframe data (e.g., 15m)
   */
  static analyze(macroOHLCV: OHLCV[], microOHLCV: OHLCV[]): MultiTimeframeResult {
    const timeframes: TimeframeResult[] = [];

    // Analyze Macro (Higher Timeframe)
    const macroResult = this.analyzeTimeframe(macroOHLCV, '1H');
    timeframes.push(macroResult);

    // Analyze Micro (Lower Timeframe)
    const microResult = this.analyzeTimeframe(microOHLCV, '15m');
    timeframes.push(microResult);

    // Analyze Short-term (5m data from micro)
    if (microOHLCV.length >= 20) {
      const shortTerm = this.analyzeTimeframe(microOHLCV.slice(-20), '5m');
      timeframes.push(shortTerm);
    }

    // Count confirmations
    const longConfirmations = timeframes.filter(tf => tf.direction === 'LONG' && tf.confirmed).length;
    const shortConfirmations = timeframes.filter(tf => tf.direction === 'SHORT' && tf.confirmed).length;

    // Determine overall direction
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    if (longConfirmations >= 2) direction = 'LONG';
    else if (shortConfirmations >= 2) direction = 'SHORT';

    // Calculate strength
    const maxStrength = Math.max(...timeframes.map(tf => tf.strength));
    const avgStrength = timeframes.reduce((sum, tf) => sum + tf.strength, 0) / timeframes.length;
    const strength = (maxStrength + avgStrength) / 2;

    // Determine verdict
    let verdict: MultiTimeframeResult['verdict'] = 'NO_SIGNAL';
    if (direction !== 'NEUTRAL' && strength >= 70) verdict = 'STRONG';
    else if (direction !== 'NEUTRAL' && strength >= 50) verdict = 'MODERATE';
    else if (direction !== 'NEUTRAL') verdict = 'WEAK';

    return {
      direction,
      strength,
      confirmation: Math.max(longConfirmations, shortConfirmations),
      timeframes,
      verdict
    };
  }

  /**
   * Analyze a single timeframe
   */
  private static analyzeTimeframe(ohlcv: OHLCV[], timeframe: string): TimeframeResult {
    if (ohlcv.length < 20) {
      return {
        timeframe,
        direction: 'NEUTRAL',
        strength: 0,
        hurst: 0.5,
        zScore: 0,
        confirmed: false
      };
    }

    const prices = ohlcv.map(c => c.c);
    const hurst = QuantUtils.hurstExponent(prices);
    const zScore = QuantUtils.calculateZScore(prices.slice(-20));
    
    // Determine direction
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    if (zScore < -1.5) direction = 'LONG';  // Oversold
    else if (zScore > 1.5) direction = 'SHORT'; // Overbought

    // Calculate strength
    const zScoreStrength = Math.min(Math.abs(zScore) * 30, 60);
    const hurstStrength = hurst > 0.6 ? 40 : hurst > 0.5 ? 20 : 0;
    const strength = zScoreStrength + hurstStrength;

    // Confirmation: Z-Score and Hurst should agree
    const confirmed = (direction === 'LONG' && zScore < 0) || 
                      (direction === 'SHORT' && zScore > 0);

    return {
      timeframe,
      direction,
      strength,
      hurst,
      zScore,
      confirmed
    };
  }

  /**
   * Check if timeframes are aligned
   */
  static isAligned(result: MultiTimeframeResult): boolean {
    const directions = result.timeframes.map(tf => tf.direction);
    const uniqueDirections = [...new Set(directions)];
    return uniqueDirections.length === 1 && uniqueDirections[0] !== 'NEUTRAL';
  }

  /**
   * Get conflicting signals
   */
  static getConflicts(result: MultiTimeframeResult): string[] {
    const conflicts: string[] = [];
    const directions = result.timeframes.map(tf => ({ tf: tf.timeframe, dir: tf.direction }));
    
    const longs = directions.filter(d => d.dir === 'LONG');
    const shorts = directions.filter(d => d.dir === 'SHORT');
    
    if (longs.length > 0 && shorts.length > 0) {
      conflicts.push(`Conflicting: ${longs.length} LONG vs ${shorts.length} SHORT`);
    }
    
    return conflicts;
  }
}
