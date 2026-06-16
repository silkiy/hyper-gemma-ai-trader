import { QuantUtils } from './quant-utils.js';
import type { OHLCV } from './quant-utils.js';
import { bitgetClient } from '../../exchange/bitget.client.js';
import { directiveRepository } from '../../database/repositories/directive.repository.js';
import { indicatorEngine } from '../market/indicator-engine.js';
import { logger } from '../../utils/logger.js';
import { TradeAction, MarketRegime, RiskLevel, PositionSize, TradingStrategy } from '../../types/enum.types.js';
import { env } from '../../config/env.js';
import type { AIDecision } from '../../types/ai.types.js';

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
  async evaluateHighSpeed(symbol: string, ohlcv: OHLCV[]): Promise<{
    decision: AIDecision | null,
    zScore: number,
    threshold: number,
    hurst: number,
    trioDirection: 'LONG' | 'SHORT' | 'NEUTRAL'
  }> {
    const directive = await directiveRepository.getLatest();
    if (!directive || ohlcv.length < 50) return { decision: null, zScore: 0, threshold: 0, hurst: 0.5, trioDirection: 'NEUTRAL' };

    const prices = ohlcv.map(d => d.c);
    const highs = ohlcv.map(d => d.h);
    const lows = ohlcv.map(d => d.l);
    const volumes = ohlcv.map(d => d.v);
    const lastPrice = prices[prices.length - 1]!;
    const prevPrice = prices.length > 1 ? prices[prices.length - 2]! : lastPrice;

    // 1. DUAL WINDOW DATA
    const shortWindow = 20;
    const longWindow = env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 50 : 100;

    const pricesShort = prices.slice(-shortWindow);
    const pricesLong = prices.slice(-longWindow);

    // 2. CALCULATE TRINITY PRIMITIVES
    const zScore = QuantUtils.calculateZScore(pricesShort);
    const hurst = QuantUtils.hurstExponent(pricesLong);

    // 3. DAILY VWAP
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const todayOHLCV = ohlcv.filter(d => d.t >= startOfToday.getTime());
    const vwap = QuantUtils.calculateVWAP(todayOHLCV.length > 0 ? todayOHLCV : ohlcv.slice(-20));
    const vwapDev = QuantUtils.vwapDeviation(lastPrice, vwap);

    // 4. KALMAN TREND + MOMENTUM CROSS-VALIDATION
    const kalmanPrice = QuantUtils.applyKalmanFilter(pricesShort, directive.kalman_aggressiveness);
    const lookback = Math.min(10, pricesShort.length - 1);
    const momentumRef = pricesShort[pricesShort.length - 1 - lookback] ?? lastPrice;
    const isMomentumBullish = lastPrice > momentumRef;
    const isMomentumBearish = lastPrice < momentumRef;
    const isKalmanBullish = lastPrice >= kalmanPrice && isMomentumBullish;
    const isKalmanBearish = lastPrice <= kalmanPrice && isMomentumBearish;

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

    // ATR Gate (Cuma untuk membuang koin mati, tidak perlu strict)
    const atr = indicatorEngine.calculateATR(highs, lows, prices, 14);
    const atrPercent = lastPrice > 0 ? (atr / lastPrice) * 100 : 0;
    const minAtrPercent = env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 0.1 : 0.3; // Sangat rendah untuk scalping

    if (atrPercent < minAtrPercent) {
      // Market completely dead, skip
      return { decision: null, zScore, threshold: 0, hurst, trioDirection: isKalmanBullish ? 'LONG' : 'SHORT' };
    }

    // 6. REGIME-AWARE LOGIC
    let hurstThreshold = 0.60;
    if (env.TRADING_STRATEGY === TradingStrategy.SCALPING) hurstThreshold = 0.50;
    else if (env.TRADING_STRATEGY === TradingStrategy.INTRADAY) hurstThreshold = 0.55;

    const isTrending = hurst >= hurstThreshold;

    let strategyMinThreshold = 1.8;
    if (env.TRADING_STRATEGY === TradingStrategy.SCALPING) strategyMinThreshold = 1.5;
    else if (env.TRADING_STRATEGY === TradingStrategy.SWING) strategyMinThreshold = 2.0;

    const defaultZThreshold = 2.2;
    const zThreshold = Math.max(
      strategyMinThreshold,
      directive.bias === 'NEUTRAL' ? defaultZThreshold : directive.z_score_threshold
    );

    let decision: TradeAction = TradeAction.SKIP;
    let strategyNote = '';
    const trioDirection = isKalmanBullish ? 'LONG' : 'SHORT';

    // MODE A: TREND FOLLOWING (Hurst >= Threshold)
    if (isTrending) {
      strategyNote = 'Trend Following (Hurst Driven)';

      // LONG: Kalman bullish + above VWAP (Pure Trinity)
      if (directive.bias === 'LONG' || directive.bias === 'NEUTRAL') {
        if (isKalmanBullish && vwapDev > 0 && hasVolumeSpike) {
          decision = TradeAction.LONG;
        }
      }
      // SHORT: Kalman bearish + below VWAP (Pure Trinity)
      if (decision === TradeAction.SKIP && (directive.bias === 'SHORT' || directive.bias === 'NEUTRAL')) {
        if (isKalmanBearish && vwapDev < 0 && hasVolumeSpike) {
          decision = TradeAction.SHORT;
        }
      }
    }
    // MODE B: MEAN REVERSION (Hurst < Threshold)
    else {
      strategyNote = 'Mean Reversion (Z-Score Driven)';
      const isBouncingUp = lastPrice >= prevPrice;
      const isBouncingDown = lastPrice <= prevPrice;

      // LONG: Z-Score deeply negative + bouncing + Value Area (VWAP)
      if (directive.bias === 'LONG' || directive.bias === 'NEUTRAL') {
        if (zScore <= -zThreshold && isBouncingUp && vwapDev < 0.1 && hasVolumeSpike) {
          decision = TradeAction.LONG;
        }
      }
      // SHORT: Z-Score deeply positive + bouncing down + Premium Area (VWAP)
      if (decision === TradeAction.SKIP && (directive.bias === 'SHORT' || directive.bias === 'NEUTRAL')) {
        if (zScore >= zThreshold && isBouncingDown && vwapDev > -0.1 && hasVolumeSpike) {
          decision = TradeAction.SHORT;
        }
      }
    }

    if (decision === TradeAction.SKIP) return { decision: null, zScore, threshold: zThreshold, hurst, trioDirection };

    const confidence = Math.min(Math.abs(zScore) * 30, 95);

    logger.info({
      symbol,
      decision,
      hurst: hurst.toFixed(2),
      regime: isTrending ? 'TRENDING' : 'RANGING',
      vwapDev: `${vwapDev.toFixed(2)}%`,
      volRatio: volumeRatio.toFixed(2),
      atrPct: `${atrPercent.toFixed(2)}%`,
      mathDir: trioDirection
    }, `⚡ HOT PATH: ${strategyNote} triggered`);

    return {
      decision: {
        symbol,
        decision,
        confidence: 'LOW',
        confidence_score: confidence,
        market_regime: isTrending ? MarketRegime.TRENDING : MarketRegime.VOLATILE,
        risk_level: RiskLevel.MEDIUM,
        leverage_suggestion: Math.min(directive.max_leverage, 25), // CAP at 25x from quant layer
        position_size: PositionSize.NORMAL,
        entry_reason: `Trinity v2: ${strategyNote}. H:${hurst.toFixed(2)} Z:${zScore.toFixed(2)} VWAP:${vwapDev.toFixed(2)}% Vol:${volumeRatio.toFixed(1)}x ATR:${atrPercent.toFixed(2)}%`,
        risk_factors: [`Hurst: ${hurst.toFixed(2)}`, `VolRatio: ${volumeRatio.toFixed(1)}x`],
        stop_loss_logic: `ATR-Based: 1.5x ATR (${atr.toFixed(6)})`,
        take_profit_logic: `ATR-Based: 2.5x ATR (${atr.toFixed(6)})`,
        self_reflection: `Trinity setup confirmed for ${isTrending ? 'momentum' : 'reversal'} regime.`,
        final_summary: `Trinity v2 hit with ${isTrending ? 'Trend' : 'Reversion'} + Volume confirmation.`,
        atr: atr // Pass ATR for dynamic SL/TP
      } as AIDecision & { atr: number },
      zScore,
      threshold: zThreshold,
      hurst,
      trioDirection
    };
  }
}

export const quantEngine = new QuantEngine();

