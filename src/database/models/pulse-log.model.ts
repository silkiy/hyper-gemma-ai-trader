import mongoose, { Schema, Document } from 'mongoose';

export interface IPulseLog extends Document {
  symbol: string;
  zScore: number;
  zThreshold: number;
  hurst: number;
  regime: string;
  vwapDev: number;
  volumeRatio: number;
  atrPercent: number;
  decision: string | null;
  skipReasons: string[];
  timestamp: Date;
}

const PulseLogSchema: Schema = new Schema({
  symbol: { type: String, required: true, index: true },
  zScore: { type: Number, required: true },
  zThreshold: { type: Number, required: true },
  hurst: { type: Number, required: true },
  regime: { type: String, required: true },
  vwapDev: { type: Number, required: true },
  volumeRatio: { type: Number, required: true },
  atrPercent: { type: Number, required: true },
  decision: { type: String, default: null },
  skipReasons: { type: [String], default: [] },
  timestamp: { type: Date, default: Date.now },
});

PulseLogSchema.index({ timestamp: -1 });
PulseLogSchema.index({ symbol: 1, timestamp: -1 });
PulseLogSchema.index({ decision: 1, timestamp: -1 });

export const PulseLog = mongoose.model<IPulseLog>('PulseLog', PulseLogSchema);
