import mongoose, { Schema, Document } from 'mongoose';

export interface ICooldown extends Document {
  cooldown_until: Date;
  reason: string;
  created_at: Date;
}

const CooldownSchema: Schema = new Schema({
  cooldown_until: { type: Date, required: true },
  reason: { type: String, default: 'Circuit breaker triggered' },
  created_at: { type: Date, default: Date.now },
});

CooldownSchema.index({ cooldown_until: -1 });

export const Cooldown = mongoose.model<ICooldown>('Cooldown', CooldownSchema);
