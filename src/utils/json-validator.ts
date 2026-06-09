import { z } from 'zod';
import { TradeAction, MarketRegime, RiskLevel, PositionSize } from '../types/enum.types.js';
import type { AIDecision } from '../types/ai.types.js';

export const AIDecisionSchema = z.object({
  symbol: z.string().optional(),
  decision: z.preprocess((val: any) => {
    const s = String(val).toUpperCase();
    if (['LONG', 'SHORT', 'WAIT', 'SKIP'].includes(s)) return s;
    return 'SKIP';
  }, z.nativeEnum(TradeAction)),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  confidence_score: z.number().min(0).max(100),
  market_regime: z.preprocess((val: any) => {
    const s = String(val).toUpperCase();
    if (['TRENDING', 'RANGING', 'VOLATILE', 'UNCLEAR'].includes(s)) return s;
    return 'UNCLEAR';
  }, z.nativeEnum(MarketRegime)),
  risk_level: z.preprocess((val: any) => {
    const s = String(val).toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH'].includes(s)) return s;
    return 'MEDIUM';
  }, z.nativeEnum(RiskLevel)),
  leverage_suggestion: z.coerce.number().min(1).max(500),
  position_size: z.preprocess((val: any) => {
    const s = String(val).toUpperCase();
    if (['SMALL', 'NORMAL', 'REDUCED'].includes(s)) return s;
    return 'NORMAL';
  }, z.nativeEnum(PositionSize)),
  entry_reason: z.string(),
  risk_factors: z.array(z.string()),
  stop_loss_logic: z.string(),
  take_profit_logic: z.string(),
  self_reflection: z.string(),
  final_summary: z.string(),
});

  export const BattleDirectiveSchema = z.object({
  bias: z.preprocess((val: any) => String(val).toUpperCase(), z.enum(['LONG', 'SHORT', 'NEUTRAL'])),
  z_score_threshold: z.number().min(1).max(5),
  kalman_aggressiveness: z.number().min(0.001).max(1.0),
  max_leverage: z.number().min(1).max(500),
  allowed_symbols: z.array(z.string()),
  reasoning: z.string(),
  });

  export function validateAIDecision(json: any): AIDecision {
  try {
    return AIDecisionSchema.parse(json) as AIDecision;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid AI Decision JSON: ${error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
  }

  export function validateBattleDirective(json: any): any {
  try {
    return BattleDirectiveSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid Battle Directive JSON: ${error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
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
