import mongoose, { Schema, Document } from 'mongoose';
import { SessionMode } from '../../types/enum.types.js';

export interface ISession extends Document {
  started_at: Date;
  daily_pnl: number;
  peak_equity: number;
  drawdown_percent: number;
  loss_streak: number;
  win_streak: number;
  total_trades: number;
  current_mode: SessionMode;
  cooldown_until?: Date;
  last_learning_round?: Date;
}

const SessionSchema: Schema = new Schema({
  started_at: { type: Date, default: Date.now },
  daily_pnl: { type: Number, default: 0 },
  peak_equity: { type: Number, default: 0 },
  drawdown_percent: { type: Number, default: 0 },
  loss_streak: { type: Number, default: 0 },
  win_streak: { type: Number, default: 0 },
  total_trades: { type: Number, default: 0 },
  current_mode: { type: String, enum: Object.values(SessionMode), default: SessionMode.NORMAL },
  cooldown_until: { type: Date },
  last_learning_round: { type: Date },
});

SessionSchema.index({ started_at: -1 });
SessionSchema.index({ current_mode: 1, cooldown_until: 1 });

export const Session = mongoose.model<ISession>('Session', SessionSchema);
