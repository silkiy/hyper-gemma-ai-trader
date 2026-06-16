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
  async evaluateTrade(pair: string, currentMode: SessionMode, mathDir: 'LONG' | 'SHORT' | 'NEUTRAL', isAlpha: boolean = false): Promise<AIDecision> {
    try {
      logger.info({ pair, mathDir, isAlpha }, 'Starting trade evaluation');

      // 1. Fetch Market Data
      const marketData = await marketDataProvider.getMarketData(pair);
      const accountStatus = await marketDataProvider.getAccountStatus();

      logger.info({
        symbol: marketData.pair,
        lastPrice: marketData.current_price,
        change24h: `${marketData.price_change_24h}%`,
        volume24h: formatCompactNumber(marketData.volume_24h)
      }, 'Market Stats');

      // 2. Continuous Learning
      const recentTrades = await tradeRepository.findRecent(10);
      
      // 3. Pre-AI Risk Check
      const riskValidation = riskManager.validateDecision({ decision: TradeAction.SKIP, symbol: pair } as any, accountStatus, currentMode);
      if (riskValidation.decision === TradeAction.SKIP && riskValidation.final_summary?.startsWith('Blocked:')) {
        logger.info({ reason: riskValidation.final_summary }, 'Skipping AI analysis: Risk manager issued a block');
        return riskValidation;
      }

      const memories = recentTrades.length >= 5 
        ? recentTrades.slice(0, 5).map(t => {
            const isWin = (t.profit_loss ?? 0) > 0;
            const pnlLabel = isWin ? 'PROFIT' : 'LOSS';
            return {
              mistake: `${pnlLabel} on ${t.pair}: ${t.action} at ${t.entry_price}`,
              lesson: `Exit: ${t.exit_price || 'N/A'}, PnL: $${(t.profit_loss ?? 0).toFixed(4)}, Reason: ${t.ai_reasoning}`
            };
          })
        : [];

      // 4. Build Prompt
      const pricesRawPrompt = await bitgetClient.getPriceHistory(pair, env.TRADING_STRATEGY === 'SCALPING' ? '1m' : '1h', 100);
      const hurstValPrompt = QuantUtils.hurstExponent(pricesRawPrompt);

      let prompt = promptBuilder.buildTradePrompt(marketData, accountStatus, memories, {
        hurst: hurstValPrompt,
        regime: isAlpha ? 'ALPHA' : (hurstValPrompt > (currentMode === SessionMode.NORMAL ? 0.60 : 0.50) ? 'TRENDING' : 'RANGING'),
        trioDirection: mathDir 
      });

      // 5. MODIFIER: Alpha/Meme Authorization
      if (isAlpha) {
        prompt = `
          *** PREDATOR AUTHORIZATION ENABLED ***
          ASSET INI ADALAH "ALPHA" (Meme/Altcoin dengan momentum independen).
          Hurst Exponent: ${hurstValPrompt.toFixed(2)}.
          PERINTAH: ABAIKAN BIAS BTC/ETH. Fokus 100% pada Volume lokal dan Price Action koin ini.
          Jangan ragu untuk ${mathDir} meskipun market global sedang berlawanan.
          
          ${prompt}
        `;
      }

      // 6. Get AI Decision
      const aiDecision = await ollamaClient.generateDecision(prompt);
      aiDecision.symbol = pair;

      // 7. Final Validation with Risk Manager (lightweight — pre-check already passed)
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
