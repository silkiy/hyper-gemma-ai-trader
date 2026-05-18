import { tradeRepository } from '../database/repositories/trade.repository.js';
import { orderExecutor } from '../exchange/order.executor.js';
import type { AIDecision } from '../types/ai.types.js';
import { logger } from '../utils/logger.js';

export class TradeService {
  async handleTradeDecision(decision: AIDecision, pair: string) {
    if (decision.decision === 'SKIP' || decision.decision === 'WAIT') {
      logger.info({ reason: decision.final_summary }, 'Trade skipped by AI');
      return;
    }

    try {
      const execution = await orderExecutor.executeOrder(decision, pair);
      
      // Save to database
      await tradeRepository.create({
        pair: pair, 
        action: decision.decision,
        entry_price: 0, // Should come from execution
        leverage: decision.leverage_suggestion,
        confidence_score: decision.confidence_score,
        market_regime: decision.market_regime,
        risk_level: decision.risk_level,
        position_size: decision.position_size,
        latency_ms: 0,
        validation_passed: true,
        ollama_raw_response: 'N/A',
        ai_reasoning: decision.entry_reason,
        self_reflection: decision.self_reflection,
        session_id: undefined // Should be handled by session service
      } as any);

      return execution;
    } catch (error: any) {
      logger.error({ 
        message: error.message,
        data: error.response?.data 
      }, 'Failed to handle trade decision');
    }
  }
}

export const tradeService = new TradeService();
