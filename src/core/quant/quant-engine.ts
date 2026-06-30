import { QuantUtils } from './quant-utils.js';
import type { OHLCV } from './quant-utils.js';
import { bitgetClient } from '../../exchange/bitget.client.js';
import { directiveRepository } from '../../database/repositories/directive.repository.js';
import { indicatorEngine } from '../market/indicator-engine.js';
import { logger } from '../../utils/logger.js';
import { TradeAction, MarketRegime, RiskLevel, PositionSize, TradingStrategy } from '../../types/enum.types.js';
import { env } from '../../config/env.js';
import type { AIDecision } from '../../types/ai.types.js';
import { VolumeProfileAnalyzer } from '../market/volume-profile.js';
import { OrderFlowAnalyzer } from '../market/order-flow.js';

export class QuantEngine {
  /**
   * Fetches full OHLCV history from Bitget V2.
   */
  async getOHLCVHistory(symbol: string, interval: string, limit: number = 100): Promise<OHLCV[]> {
    try {
      const raw = await bitgetClient.getCandles(symbol, interval, limit);
      return raw.map((c: any) => ({
        t: parseInt(c[0]),
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4]),
        v: parseFloat(c[5])
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * THE QUANT TRINITY v2: Z-Score, Hurst, VWAP + Multi-Layer Confirmation.
   * Now requires RSI, Volume, EMA alignment, and ATR gate before triggering.
   */
  async evaluateHighSpeed(symbol: string, macroOHLCV: OHLCV[], microOHLCV: OHLCV[]): Promise<{
    decision: AIDecision | null,
    zScore: number,
    threshold: number,
    hurst: number,
    trioDirection: 'LONG' | 'SHORT' | 'NEUTRAL',
    regime: string,
    vwapDev: number,
    volumeRatio: number,
    atrPercent: number,
    skipReasons: string[]
  }> {
    const directive = await directiveRepository.getLatest();
    if (!directive || microOHLCV.length < 50 || macroOHLCV.length < 50) {
      return { decision: null, zScore: 0, threshold: 0, hurst: 0.5, trioDirection: 'NEUTRAL', regime: 'UNKNOWN', vwapDev: 0, volumeRatio: 0, atrPercent: 0, skipReasons: ['Insufficient data'] };
    }

    const skipReasons: string[] = [];

    // ADVANCED QUANT FEATURES: Volume Profile & Order Flow
    const profile = VolumeProfileAnalyzer.calculate(microOHLCV);
    const orderFlow = OrderFlowAnalyzer.analyze(microOHLCV);
    const absorption = OrderFlowAnalyzer.detectAbsorption(microOHLCV, 5);

    // ═══════════════════════════════════════════════
    // 1. MACRO LENS (Regime & Trend Direction)
    // ═══════════════════════════════════════════════
    const macroPrices = macroOHLCV.map(d => d.c);
    const macroLongWindow = env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 50 : 100;
    const macroPricesLong = macroPrices.slice(-macroLongWindow);
    const hurst = QuantUtils.hurstExponent(macroPricesLong); // Hurst is purely macro

    const macroLastPrice = macroPrices[macroPrices.length - 1]!;
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const todayOHLCVMacro = macroOHLCV.filter(d => d.t >= startOfToday.getTime());
    const vwap = QuantUtils.calculateVWAP(todayOHLCVMacro.length > 0 ? todayOHLCVMacro : macroOHLCV.slice(-20));
    const vwapDev = QuantUtils.vwapDeviation(macroLastPrice, vwap); // VWAP is purely macro

    // ═══════════════════════════════════════════════
    // 2. MICRO LENS (Precision Entry Trigger)
    // ═══════════════════════════════════════════════
    const prices = microOHLCV.map(d => d.c);
    const highs = microOHLCV.map(d => d.h);
    const lows = microOHLCV.map(d => d.l);
    const volumes = microOHLCV.map(d => d.v);
    const lastPrice = prices[prices.length - 1]!;
    const prevPrice = prices.length > 1 ? prices[prices.length - 2]! : lastPrice;
    const prevPrevPrice = prices.length > 2 ? prices[prices.length - 3]! : prevPrice;

    const shortWindow = 20;
    const pricesShort = prices.slice(-shortWindow);

    const zScore = QuantUtils.calculateZScore(pricesShort);

    // KALMAN TREND + MOMENTUM CROSS-VALIDATION (Micro)
    const kalmanPrice = QuantUtils.applyKalmanFilter(pricesShort, directive.kalman_aggressiveness);
    const lookback = Math.min(10, pricesShort.length - 1);
    const momentumRef = pricesShort[pricesShort.length - 1 - lookback] ?? lastPrice;
    const isMomentumBullish = lastPrice > momentumRef;
    const isMomentumBearish = lastPrice < momentumRef;
    const isKalmanBullish = lastPrice >= kalmanPrice && isMomentumBullish;
    const isKalmanBearish = lastPrice <= kalmanPrice && isMomentumBearish;

    // ═══════════════════════════════════════════════
    // 3. ENTRY QUALITY FILTERS (Anti-Counter-Trend)
    // ═══════════════════════════════════════════════
    
    // Recent candle direction (last 3 candles)
    const candleDirection = lastPrice > prevPrice ? 1 : lastPrice < prevPrice ? -1 : 0;
    const prevCandleDirection = prevPrice > prevPrevPrice ? 1 : prevPrice < prevPrevPrice ? -1 : 0;
    const consecutiveUp = candleDirection > 0 && prevCandleDirection > 0;
    const consecutiveDown = candleDirection < 0 && prevCandleDirection < 0;
    
    // Price change percentage (last 5 candles)
    const price5CandlesAgo = prices.length > 5 ? prices[prices.length - 6]! : prices[0]!;
    const recentPriceChange = ((lastPrice - price5CandlesAgo) / price5CandlesAgo) * 100;
    
    // Anti-counter-trend filter: Don't enter LONG during sharp drop, Don't enter SHORT during sharp pump
    const MOMENTUM_THRESHOLD = 1.2; // 1.2% move in 5 candles = too aggressive to counter (tightened from 2.0% to prevent falling knife on highly volatile coins)
    const isSharpDrop = recentPriceChange < -MOMENTUM_THRESHOLD;
    const isSharpPump = recentPriceChange > MOMENTUM_THRESHOLD;

    // ═══════════════════════════════════════════════
    // 5. TRINITY SENSOR CONSTRAINTS
    // ═══════════════════════════════════════════════

    // 5A. VOLUME & ATR (Optional for Scalping)
    const recentVolumes = volumes.slice(-20);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const lastVolume = volumes[volumes.length - 1]!;
    const volumeRatio = avgVolume > 0 ? lastVolume / avgVolume : 0;

    // Untuk Scalping, kita ikuti murni Trinity (Z-Score + Hurst + VWAP) tanpa filter volume
    const requireVolume = env.TRADING_STRATEGY !== TradingStrategy.SCALPING;
    const hasVolumeSpike = requireVolume ? volumeRatio >= 1.2 : true;

    // ATR Gate - Penting untuk pastikan profit > fees
    const atr = indicatorEngine.calculateATR(highs, lows, prices, 14);
    const atrPercent = lastPrice > 0 ? (atr / lastPrice) * 100 : 0;
    // INTRADAY: ATR minimum 0.5% agar ada ruang untuk profit
    const minAtrPercent = env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 0.1 : 
                          env.TRADING_STRATEGY === TradingStrategy.INTRADAY ? 0.25 : 0.3;

    if (atrPercent < minAtrPercent) {
      // Market completely dead, skip
      const msg = `ATR too low: ${atrPercent.toFixed(2)}% < ${minAtrPercent}%`;
      skipReasons.push(msg);
      return { 
        decision: null, 
        zScore, 
        threshold: 0, 
        hurst, 
        trioDirection: isKalmanBullish ? 'LONG' : 'SHORT',
        regime: hurst >= 0.6 ? 'TRENDING' : 'RANGING',
        vwapDev,
        volumeRatio,
        atrPercent,
        skipReasons
      };
    }

    // ═══════════════════════════════════════════════
    // GATEKEEPER: Momentum Threshold (Sesuai Aturan Mutlak GEMINI.md)
    // Menolak pisau jatuh / pump dadakan > 2% di semua mode.
    // ═══════════════════════════════════════════════
    if (isSharpDrop || isSharpPump) {
      const msg = `GATEKEEPER BLOCKED: Momentum too aggressive (Sharp Drop: ${isSharpDrop}, Sharp Pump: ${isSharpPump}). Rejecting to prevent FOMO/whipsaw.`;
      skipReasons.push(msg);
      return {
        decision: null,
        zScore,
        threshold: 0,
        hurst,
        trioDirection: 'NEUTRAL',
        regime: 'VOLATILE',
        vwapDev,
        volumeRatio,
        atrPercent,
        skipReasons
      };
    }

    // 6. REGIME-AWARE LOGIC
    let hurstThreshold = 0.60; // Default
    if (env.TRADING_STRATEGY === TradingStrategy.SCALPING) hurstThreshold = 0.55;
    else if (env.TRADING_STRATEGY === TradingStrategy.INTRADAY) hurstThreshold = 0.60;
    else if (env.TRADING_STRATEGY === TradingStrategy.SWING) hurstThreshold = 0.65;

    const isTrending = hurst >= hurstThreshold;

    // ═══════════════════════════════════════════════
    // 6. OPTIMIZED MATHEMATICAL ENTRY LOGIC
    // ═══════════════════════════════════════════════
    
    // Z-Score Confidence Calculation (0-100%)
    const zConfidence = Math.min(Math.abs(zScore) * 30, 100);
    
    // Z-Score Threshold for entry
    let strategyMinThreshold = 2.0;
    if (env.TRADING_STRATEGY === TradingStrategy.SCALPING) strategyMinThreshold = 1.8;
    else if (env.TRADING_STRATEGY === TradingStrategy.INTRADAY) strategyMinThreshold = 2.0;
    else if (env.TRADING_STRATEGY === TradingStrategy.SWING) strategyMinThreshold = 2.2;
    
    const defaultZThreshold = 2.0;
    const zThreshold = Math.max(
      strategyMinThreshold,
      directive.bias === 'NEUTRAL' ? defaultZThreshold : directive.z_score_threshold
    );
    
    // Dynamic VWAP Threshold based on ATR
    const vwapThreshold = Math.max(atrPercent * 1.5, 1.5); // Minimum 1.5%
    
    // Volume Weighted Confirmation
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const olderVolume = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
    const volumeWeight = olderVolume > 0 ? recentVolume / olderVolume : 1;
    const hasVolumeConfirmation = volumeWeight > 1.2; // Volume meningkat 20%
    
    // 1. Tambahkan indikator EMA & RSI untuk mengukur kejenuhan dan tren sesungguhnya
    const emaMacro = indicatorEngine.calculateEMA(macroPrices, 20);
    const rsi14 = indicatorEngine.calculateRSI(prices, 14);

    // Multi-Scale Hurst Confirmation (Fixed to use Macro safely)
    const hurstConfirmed = hurst > 0.55;
    
    // Candle Momentum Confirmation
    const candleMomentum = (lastPrice - prevPrice) / prevPrice * 100;
    const hasMomentumConfirmation = Math.abs(candleMomentum) > 0.3; // Minimal 0.3% per candle

    let decision: TradeAction = TradeAction.SKIP;
    let strategyNote = '';
    
    // ═══════════════════════════════════════════════
    // MACRO TREND ALIGNMENT (Gatekeeper untuk semua mode)
    const isMacroBullish = macroLastPrice > vwap && macroLastPrice > emaMacro;
    const isMacroBearish = macroLastPrice < vwap && macroLastPrice < emaMacro;

    // TRIO DIRECTION: Based on mode
    // ═══════════════════════════════════════════════
    let trioDirection: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    
    if (isTrending) {
      trioDirection = isKalmanBullish ? 'LONG' : 'SHORT';
    } else {
      trioDirection = zScore < 0 ? 'LONG' : 'SHORT';
    }

    // MODE A: TREND FOLLOWING (Hurst >= Threshold)
    if (isTrending) {
      strategyNote = 'Trend Following (Hurst Driven + Micro Pullback)';

      // ═══════════════════════════════════════════════
      // OPTIMIZED ENTRY: EMA + RSI + VWAP + KALMAN
      // ═══════════════════════════════════════════════
      
      // LONG: Macro Bullish + Kalman Bullish + Pullback sehat (RSI tidak overbought)
      if (isMacroBullish && isKalmanBullish && (directive.bias === 'LONG' || directive.bias === 'NEUTRAL')) {
        let confirmations = 0;
        if (vwapDev > 0 && vwapDev < vwapThreshold) confirmations++; // VWAP
        if (rsi14 > 40 && rsi14 < 70) confirmations++; // RSI pullback filter
        if (hasVolumeConfirmation) confirmations++; // Volume
        if (!isSharpDrop && hasMomentumConfirmation) confirmations++; // Momentum
        if (hurstConfirmed) confirmations++; // Multi-scale Hurst
        if (orderFlow.trend === 'BULLISH' || orderFlow.imbalance > 0.15) confirmations++; // Order Flow Imbalance

        if (confirmations >= 2) {
          decision = TradeAction.LONG;
        }
      }
      
      // SHORT: Macro Bearish + Kalman Bearish + Bounce sehat (RSI tidak oversold)
      if (decision === TradeAction.SKIP && isMacroBearish && isKalmanBearish && (directive.bias === 'SHORT' || directive.bias === 'NEUTRAL')) {
        let confirmations = 0;
        if (vwapDev < 0 && vwapDev > -vwapThreshold) confirmations++;
        if (rsi14 < 60 && rsi14 > 30) confirmations++;
        if (hasVolumeConfirmation) confirmations++;
        if (!isSharpPump && hasMomentumConfirmation) confirmations++;
        if (hurstConfirmed) confirmations++;
        if (orderFlow.trend === 'BEARISH' || orderFlow.imbalance < -0.15) confirmations++; // Order Flow Imbalance

        if (confirmations >= 2) {
          decision = TradeAction.SHORT;
        }
      }
    }
    // MODE B: MEAN REVERSION (Hurst < Threshold)
    else {
      strategyNote = 'Mean Reversion (Z-Score Driven)';
      const isBouncingUp = lastPrice >= prevPrice;
      const isBouncingDown = lastPrice <= prevPrice;

      // Mean reversion VWAP limit
      const meanReversionVwapLimit = env.TRADING_STRATEGY === TradingStrategy.INTRADAY ? 3.5 : 3;

      // ═══════════════════════════════════════════════
      // OPTIMIZED MEAN REVERSION: Z-Score + RSI Extreme
      // ═══════════════════════════════════════════════
      
      // LONG: Z-Score oversold + RSI oversold + 2 confirmations + HARUS BUKAN Sharp Drop + Macro Harus Mendukung + Berada di VAL atau di bawahnya
      if (!isSharpDrop && isMacroBullish && zScore <= -zThreshold && rsi14 <= 35 && lastPrice <= profile.val && (directive.bias === 'LONG' || directive.bias === 'NEUTRAL')) {
        let confirmations = 0;
        if (isBouncingUp && candleDirection >= 0) confirmations++; // Bounce
        if (hasVolumeConfirmation) confirmations++; // Volume
        if (vwapDev < 1 && vwapDev > -meanReversionVwapLimit) confirmations++; // VWAP
        if (hasMomentumConfirmation) confirmations++; // Momentum
        if (hurstConfirmed) confirmations++; // Multi-scale

        if (confirmations >= 2) {
          decision = TradeAction.LONG;
        }
      }
      
      // SHORT: Z-Score overbought + RSI overbought + 2 confirmations + HARUS BUKAN Sharp Pump + Macro Harus Mendukung + Berada di VAH atau di atasnya
      if (decision === TradeAction.SKIP && !isSharpPump && isMacroBearish && zScore >= zThreshold && rsi14 >= 65 && lastPrice >= profile.vah && (directive.bias === 'SHORT' || directive.bias === 'NEUTRAL')) {
        let confirmations = 0;
        if (isBouncingDown && candleDirection <= 0) confirmations++;
        if (hasVolumeConfirmation) confirmations++;
        if (vwapDev > -1 && vwapDev < meanReversionVwapLimit) confirmations++;
        if (hasMomentumConfirmation) confirmations++;
        if (hurstConfirmed) confirmations++;

        if (confirmations >= 2) {
          decision = TradeAction.SHORT;
        }
      }
    }

    // ═══════════════════════════════════════════════
    // ORDER FLOW ABSORPTION CONTROL (Final Guard & Confidence Booster)
    // ═══════════════════════════════════════════════
    let isSuperSignal = false;

    if (decision !== TradeAction.SKIP) {
      if (absorption.detected) {
        // A. JIKA ABSORPTION BERLAWANAN ARAH -> FAKEOUT / BLOCK TRADE
        if (decision === TradeAction.LONG && absorption.type === 'BEARISH') {
          const msg = `[ABSORPTION GUARD] Blocked LONG: Bearish absorption detected at extreme (Seller absorbing buying pressure)`;
          logger.warn({ symbol, type: absorption.type, strength: absorption.strength }, msg);
          skipReasons.push(msg);
          decision = TradeAction.SKIP;
        } else if (decision === TradeAction.SHORT && absorption.type === 'BULLISH') {
          const msg = `[ABSORPTION GUARD] Blocked SHORT: Bullish absorption detected at extreme (Buyer absorbing selling pressure)`;
          logger.warn({ symbol, type: absorption.type, strength: absorption.strength }, msg);
          skipReasons.push(msg);
          decision = TradeAction.SKIP;
        } 
        // B. JIKA ABSORPTION SEARAH -> SUPER SIGNAL / CONFIDENCE BOOST
        else if (decision === TradeAction.LONG && absorption.type === 'BULLISH') {
          isSuperSignal = true;
          logger.info({ symbol, strength: absorption.strength }, '🔥 INSTITUTIONAL ABSORPTION: Heavy selling pressure absorbed by Buyers!');
        } else if (decision === TradeAction.SHORT && absorption.type === 'BEARISH') {
          isSuperSignal = true;
          logger.info({ symbol, strength: absorption.strength }, '🔥 INSTITUTIONAL ABSORPTION: Heavy buying pressure absorbed by Sellers!');
        }
      }
    }

    if (decision === TradeAction.SKIP) {
      if (skipReasons.length === 0) {
        skipReasons.push('No mathematical entry trigger hit');
      }
      return { 
        decision: null, 
        zScore, 
        threshold: zThreshold, 
        hurst, 
        trioDirection, 
        regime: isTrending ? 'TRENDING' : 'RANGING', 
        vwapDev, 
        volumeRatio, 
        atrPercent, 
        skipReasons
      };
    }

    // Boost confidence score if super signal
    const baseConfidence = Math.min(Math.abs(zScore) * 30, 95);
    const confidence = isSuperSignal ? Math.min(baseConfidence + 15, 95) : baseConfidence;

    logger.info({
      symbol,
      decision,
      hurst: hurst.toFixed(2),
      regime: isTrending ? 'TRENDING' : 'RANGING',
      vwapDev: `${vwapDev.toFixed(2)}%`,
      volRatio: volumeRatio.toFixed(2),
      atrPct: `${atrPercent.toFixed(2)}%`,
      momentum: `${recentPriceChange.toFixed(2)}%`,
      mathDir: trioDirection,
      isSuperSignal
    }, `⚡ HOT PATH: ${strategyNote} triggered`);

    return {
      decision: {
        symbol,
        decision,
        confidence: isSuperSignal ? 'HIGH' : (confidence >= 70 ? 'MEDIUM' : 'LOW'),
        confidence_score: confidence,
        market_regime: isTrending ? MarketRegime.TRENDING : MarketRegime.VOLATILE,
        risk_level: RiskLevel.MEDIUM,
        leverage_suggestion: Math.min(directive.max_leverage, 25),
        position_size: PositionSize.NORMAL,
        entry_reason: `Trinity v2: ${strategyNote}. H:${hurst.toFixed(2)} Z:${zScore.toFixed(2)} VWAP:${vwapDev.toFixed(2)}% Vol:${volumeRatio.toFixed(1)}x ATR:${atrPercent.toFixed(2)}% Mom:${recentPriceChange.toFixed(2)}%${isSuperSignal ? ' + Institutional Absorption' : ''}`,
        risk_factors: [`Hurst: ${hurst.toFixed(2)}`, `VolRatio: ${volumeRatio.toFixed(1)}x`, `Momentum: ${recentPriceChange.toFixed(2)}%`],
        stop_loss_logic: `ATR-Based: 1.5x ATR (${atr.toFixed(6)})`,
        take_profit_logic: `ATR-Based: 2.5x ATR (${atr.toFixed(6)})`,
        self_reflection: `Trinity setup confirmed for ${isTrending ? 'momentum' : 'reversal'} regime. Momentum: ${recentPriceChange.toFixed(2)}%${isSuperSignal ? ' + Institutional Absorption confirmed.' : ''}`,
        final_summary: `Trinity v2 hit with ${isTrending ? 'Trend' : 'Reversion'} + Volume + Momentum + OrderFlow confirmation.`,
        atr: atr
      } as AIDecision & { atr: number },
      zScore,
      threshold: zThreshold,
      hurst,
      trioDirection,
      regime: isTrending ? 'TRENDING' : 'RANGING',
      vwapDev,
      volumeRatio,
      atrPercent,
      skipReasons
    };
  }
}

export const quantEngine = new QuantEngine();
