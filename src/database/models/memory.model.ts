import mongoose, { Schema, Document } from 'mongoose';
import { MemoryCategory } from '../../types/enum.types.js';

export interface IMemory extends Document {
  category: MemoryCategory;
  mistake: string;
  lesson: string;
  market_condition: string;
  occurrence_count: number;
  effectiveness_score: number;
  avoidance_success_rate: number;
  last_triggered_at: Date;
  created_at: Date;
}

const MemorySchema: Schema = new Schema(
  {
    category: { type: String, enum: Object.values(MemoryCategory), required: true },
    mistake: { type: String, required: true },
    lesson: { type: String, required: true },
    market_condition: { type: String, required: true },
    occurrence_count: { type: Number, default: 1 },
    effectiveness_score: { type: Number, default: 0 },
    avoidance_success_rate: { type: Number, default: 0 },
    last_triggered_at: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

MemorySchema.index({ category: 1, effectiveness_score: -1 });
MemorySchema.index({ last_triggered_at: -1 });

export const Memory = mongoose.model<IMemory>('Memory', MemorySchema);
