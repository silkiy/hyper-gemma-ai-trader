import mongoose, { Schema, Document } from 'mongoose';
import { TradeAction, MarketRegime, RiskLevel, PositionSize, TradeResult } from '../../types/enum.types.js';

export interface ITrade extends Document {
  session_id: mongoose.Types.ObjectId;
  pair: string;
  action: TradeAction;
  entry_price: number;
  exit_price?: number;
  exit_reason?: string;
  mistake_analysis?: string;
  leverage: number;
  confidence_score: number;
  market_regime: MarketRegime;
  risk_level: RiskLevel;
  position_size: PositionSize;
  result?: TradeResult;
  profit_loss?: number;
  latency_ms: number;
  validation_passed: boolean;
  ollama_raw_response: string;
  ai_reasoning: string;
  self_reflection?: string;
  created_at: Date;
  updated_at: Date;
}

const TradeSchema: Schema = new Schema(
  {
    session_id: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    pair: { type: String, required: true },
    action: { type: String, enum: Object.values(TradeAction), required: true },
    entry_price: { type: Number, required: true },
    exit_price: { type: Number },
    exit_reason: { type: String },
    mistake_analysis: { type: String },
    leverage: { type: Number, required: true },
    confidence_score: { type: Number, required: true },
    market_regime: { type: String, enum: Object.values(MarketRegime), required: true },
    risk_level: { type: String, enum: Object.values(RiskLevel), required: true },
    position_size: { type: String, enum: Object.values(PositionSize), required: true },
    result: { type: String, enum: Object.values(TradeResult) },
    profit_loss: { type: Number },
    latency_ms: { type: Number, required: true },
    validation_passed: { type: Boolean, required: true },
    ollama_raw_response: { type: String, required: true },
    ai_reasoning: { type: String, required: true },
    self_reflection: { type: String },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

TradeSchema.index({ created_at: -1 });
TradeSchema.index({ result: 1, confidence_score: -1 });
TradeSchema.index({ market_regime: 1, result: 1 });

export const Trade = mongoose.model<ITrade>('Trade', TradeSchema);
