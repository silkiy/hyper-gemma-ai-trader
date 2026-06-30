/**
 * Volume Profile Analysis
 * 
 * Calculates POC (Point of Control), VAH (Value Area High), VAL (Value Area Low)
 * Based on volume distribution across price levels
 * 
 * References:
 * - Jim Dalton: "Mind Over Markets"
 * - Brian Shannon: "Technical Analysis Using Multiple Timeframes"
 */

import type { OHLCV } from '../quant/quant-utils.js';

export interface VolumeProfileResult {
  poc: number;           // Point of Control - highest volume price
  vah: number;           // Value Area High - 70% volume above POC
  val: number;           // Value Area Low - 70% volume below POC
  totalVolume: number;   // Total volume in range
  volumeWeightedAvg: number; // Volume weighted average price
  priceRange: {
    high: number;
    low: number;
  };
}

export class VolumeProfileAnalyzer {
  /**
   * Calculate Volume Profile from OHLCV data
   * Uses 100 candles for calculation
   */
  static calculate(ohlcv: OHLCV[]): VolumeProfileResult {
    if (ohlcv.length < 10) {
      return {
        poc: 0,
        vah: 0,
        val: 0,
        totalVolume: 0,
        volumeWeightedAvg: 0,
        priceRange: { high: 0, low: 0 }
      };
    }

    // Get price range
    const highs = ohlcv.map(c => c.h);
    const lows = ohlcv.map(c => c.l);
    const priceHigh = Math.max(...highs);
    const priceLow = Math.min(...lows);
    const priceRange = priceHigh - priceLow;

    // Create price bins (50 bins for granularity)
    const numBins = 50;
    const binSize = priceRange / numBins;
    const bins: { price: number; volume: number }[] = [];

    for (let i = 0; i < numBins; i++) {
      const binPrice = priceLow + (i * binSize) + (binSize / 2);
      bins.push({ price: binPrice, volume: 0 });
    }

    // Distribute volume to bins based on price range
    for (const candle of ohlcv) {
      const typicalPrice = (candle.h + candle.l + candle.c) / 3;
      const binIndex = Math.floor((typicalPrice - priceLow) / binSize);
      
      if (binIndex >= 0 && binIndex < numBins && bins[binIndex]) {
        bins[binIndex].volume += candle.v;
      }
    }

    // Find POC (Point of Control) - highest volume bin
    let pocIndex = 0;
    let maxVolume = 0;
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      if (bin && bin.volume > maxVolume) {
        maxVolume = bin.volume;
        pocIndex = i;
      }
    }
    const poc = bins[pocIndex]?.price || priceLow;

    // Calculate Value Area (70% of total volume)
    const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
    const targetVolume = totalVolume * 0.7;

    // Expand from POC until 70% volume covered
    let volumeSum = bins[pocIndex]?.volume || 0;
    let vahIndex = pocIndex;
    let valIndex = pocIndex;

    while (volumeSum < targetVolume && (vahIndex < bins.length - 1 || valIndex > 0)) {
      const upVolume = vahIndex < bins.length - 1 ? bins[vahIndex + 1]?.volume || 0 : 0;
      const downVolume = valIndex > 0 ? bins[valIndex - 1]?.volume || 0 : 0;

      if (upVolume >= downVolume && vahIndex < bins.length - 1) {
        vahIndex++;
        volumeSum += bins[vahIndex]?.volume || 0;
      } else if (valIndex > 0) {
        valIndex--;
        volumeSum += bins[valIndex]?.volume || 0;
      } else {
        break;
      }
    }

    const vah = bins[vahIndex]?.price || priceHigh;
    const val = bins[valIndex]?.price || priceLow;

    // Calculate volume weighted average
    let sumPV = 0;
    let sumV = 0;
    for (const candle of ohlcv) {
      const typicalPrice = (candle.h + candle.l + candle.c) / 3;
      sumPV += typicalPrice * candle.v;
      sumV += candle.v;
    }
    const volumeWeightedAvg = sumV > 0 ? sumPV / sumV : 0;

    return {
      poc,
      vah,
      val,
      totalVolume,
      volumeWeightedAvg,
      priceRange: { high: priceHigh, low: priceLow }
    };
  }

  /**
   * Check if price is in Value Area
   */
  static isInValueArea(price: number, profile: VolumeProfileResult): boolean {
    return price >= profile.val && price <= profile.vah;
  }

  /**
   * Check if price is at POC (Point of Control)
   */
  static isAtPOC(price: number, profile: VolumeProfileResult, tolerance: number = 0.5): boolean {
    return Math.abs(price - profile.poc) / profile.poc * 100 < tolerance;
  }

  /**
   * Get support/resistance levels from Volume Profile
   */
  static getSupportResistance(profile: VolumeProfileResult): {
    support: number[];
    resistance: number[];
  } {
    return {
      support: [profile.val, profile.poc],
      resistance: [profile.poc, profile.vah]
    };
  }
}
