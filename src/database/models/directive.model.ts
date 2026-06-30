import mongoose, { Schema, Document } from 'mongoose';

export interface IBattleDirective extends Document {
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  z_score_threshold: number;
  kalman_aggressiveness: number;
  max_leverage: number;
  allowed_symbols: string[];
  reasoning: string;
  last_updated: Date;
}

const BattleDirectiveSchema: Schema = new Schema({
  bias: { type: String, enum: ['LONG', 'SHORT', 'NEUTRAL'], default: 'NEUTRAL' },
  z_score_threshold: { type: Number, default: 2.0 },
  kalman_aggressiveness: { type: Number, default: 0.1 },
  max_leverage: { type: Number, default: 20 },
  allowed_symbols: { type: [String], default: [] },
  reasoning: { type: String, default: '' },
  last_updated: { type: Date, default: Date.now },
});

export const BattleDirective = mongoose.model<IBattleDirective>('BattleDirective', BattleDirectiveSchema);
