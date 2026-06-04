import { ollamaClient } from './ollama-client.js';
import { marketDataProvider } from '../../exchange/market-data.provider.js';
import { bitgetClient } from '../../exchange/bitget.client.js';
import { QuantUtils } from '../quant/quant-utils.js';
import { riskManager } from '../risk/risk-manager.js';
import { promptBuilder } from './prompt-builder.js';
import { tradeRepository } from '../../database/repositories/trade.repository.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';
import type { AIDecision } from '../../types/ai.types.js';
import { SessionMode, TradeAction, MarketRegime, RiskLevel, PositionSize } from '../../types/enum.types.js';
import { formatCompactNumber } from '../../utils/helpers.js';

export class DecisionEngine {
  async evaluateTrade(pair: string, currentMode: SessionMode, mathDir: 'LONG' | 'SHORT' | 'NEUTRAL'): Promise<AIDecision> {
    try {
      logger.info({ pair, mathDir }, 'Starting trade evaluation');

      // 1. Fetch Market Data
      const marketData = await marketDataProvider.getMarketData(pair);
      const accountStatus = await marketDataProvider.getAccountStatus();

      logger.info({
        symbol: marketData.pair,
        lastPrice: marketData.current_price,
        change24h: `${marketData.price_change_24h}%`,
        volume24h: formatCompactNumber(marketData.volume_24h)
      }, 'Market Stats');

      // 2. Continuous Learning: Only learn after reaching 5 trades threshold
      const recentTrades = await tradeRepository.findRecent(10);
      
      // 3. Pre-AI Risk Check (Stop early if positions are full or safety risk exists)
      const riskValidation = riskManager.validateDecision({ decision: TradeAction.SKIP, symbol: pair } as any, accountStatus, currentMode);
      if (riskValidation.decision === TradeAction.SKIP && riskValidation.final_summary?.startsWith('Blocked:')) {
        logger.info({ reason: riskValidation.final_summary }, 'Skipping AI analysis: Risk manager issued a block');
        return riskValidation;
      }

      const memories = recentTrades.length >= 5 
        ? recentTrades.slice(0, 5).map(t => ({
            mistake: (t.profit_loss ?? 0) < 0 ? `LOSS on ${t.pair}` : `PROFIT on ${t.pair}`,
            lesson: `Action: ${t.action}, Reason: ${t.ai_reasoning}, PnL: ${t.profit_loss ?? 0}$`
          }))
        : [];

      if (recentTrades.length < 5) {
        logger.info({ currentTrades: recentTrades.length }, 'Pure Analysis Mode: Not enough trade history for learning loop yet (Need 5)');
      } else {
        logger.info('Continuous Learning Mode: Feedback loop active with last 5 trades');
      }

      // 4. Build Prompt
      // Calculate regime context to inject into prompt
      const pricesRawPrompt = await bitgetClient.getPriceHistory(pair, env.TRADING_STRATEGY === 'SCALPING' ? '5m' : '1h', 100);
      const hurstValPrompt = QuantUtils.hurstExponent(pricesRawPrompt);

      const prompt = promptBuilder.buildTradePrompt(marketData, accountStatus, memories, {
        hurst: hurstValPrompt,
        regime: hurstValPrompt > (currentMode === SessionMode.NORMAL ? 0.60 : 0.50) ? 'TRENDING' : 'RANGING',
        trioDirection: mathDir // Use the direction passed from server.ts
      });

      // 5. Get AI Decision
      const aiDecision = await ollamaClient.generateDecision(prompt);
      aiDecision.symbol = pair; // FIX 2: Type-safe symbol injection

      // FIX 1: Hard Constraint - Block Gemma Flip in TRENDING regime
      const hurstThreshold = env.TRADING_STRATEGY === 'SCALPING' ? 0.50 : 0.60;
      const isTrending = hurstValPrompt >= hurstThreshold; 

      if (isTrending) {
        // GUARD: If Trending and AI tries to flip math direction -> Force WAIT
        if (mathDir === 'LONG' && aiDecision.decision === TradeAction.SHORT) {
          logger.warn({ pair, hurst: hurstValPrompt.toFixed(2) }, '⚠️ GEMMA_FLIP_BLOCKED: AI tried to SHORT during Bullish Trending regime.');
          aiDecision.decision = TradeAction.WAIT;
          aiDecision.final_summary = 'Blocked: AI tried to flip direction against Trending regime.';
        } else if (mathDir === 'SHORT' && aiDecision.decision === TradeAction.LONG) {
          logger.warn({ pair, hurst: hurstValPrompt.toFixed(2) }, '⚠️ GEMMA_FLIP_BLOCKED: AI tried to LONG during Bearish Trending regime.');
          aiDecision.decision = TradeAction.WAIT;
          aiDecision.final_summary = 'Blocked: AI tried to flip direction against Trending regime.';
        }
      }

      // 6. Final Validation with Risk Manager
      const finalDecision = riskManager.validateDecision(aiDecision, accountStatus, currentMode);

      logger.info({ decision: finalDecision.decision }, 'Final trade decision reached');
      return finalDecision;
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Decision engine failure');
      return this.getFallbackDecision('Internal error in decision engine');
    }
  }

  private getFallbackDecision(reason: string): AIDecision {
    return {
      decision: TradeAction.SKIP,
      confidence_score: 0,
      market_regime: MarketRegime.UNCLEAR,
      risk_level: RiskLevel.HIGH,
      leverage_suggestion: 1,
      position_size: PositionSize.SMALL,
      entry_reason: 'Fallback due to error',
      risk_factors: [reason],
      stop_loss_logic: 'N/A',
      take_profit_logic: 'N/A',
      self_reflection: 'Engine failed to process',
      final_summary: reason,
    } as AIDecision;
  }
}

export const decisionEngine = new DecisionEngine();
