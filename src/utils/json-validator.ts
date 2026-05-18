import { z } from 'zod';
import { TradeAction, MarketRegime, RiskLevel, PositionSize } from '../types/enum.types.js';

export const AIDecisionSchema = z.object({
  decision: z.nativeEnum(TradeAction),
  confidence_score: z.number().min(0).max(100),
  market_regime: z.nativeEnum(MarketRegime),
  risk_level: z.nativeEnum(RiskLevel),
  leverage_suggestion: z.number().min(1).max(500),
  position_size: z.nativeEnum(PositionSize),
  entry_reason: z.string(),
  risk_factors: z.array(z.string()),
  stop_loss_logic: z.string(),
  take_profit_logic: z.string(),
  self_reflection: z.string(),
  final_summary: z.string(),
});

export function validateAIDecision(data: any) {
  try {
    return AIDecisionSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid AI Decision JSON: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
}

export function extractJsonFromResponse(response: string): any {
  try {
    // Improved regex to find the outermost { ... } block
    const firstBrace = response.indexOf('{');
    const lastBrace = response.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      throw new Error('No JSON found in response');
    }
    
    const jsonString = response.substring(firstBrace, lastBrace + 1);
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`Failed to parse JSON from response: ${error instanceof Error ? error.message : String(error)}`);
  }
}
