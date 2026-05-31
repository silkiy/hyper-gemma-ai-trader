import { TradeAction, MarketRegime, RiskLevel, PositionSize } from './enum.types.js';

export type AIDecision = {
  symbol?: string;
  decision: TradeAction;
  confidence_score: number;
  market_regime: MarketRegime;
  risk_level: RiskLevel;
  leverage_suggestion: number;
  position_size: PositionSize;
  entry_reason: string;
  risk_factors: string[];
  stop_loss_logic: string;
  take_profit_logic: string;
  self_reflection: string;
  final_summary: string;
};

export type OllamaRequest = {
  model: string;
  prompt: string;
  stream: boolean;
  options?: {
    temperature?: number;
    top_k?: number;
    top_p?: number;
    num_predict?: number;
  };
};

export type OllamaResponse = {
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};
