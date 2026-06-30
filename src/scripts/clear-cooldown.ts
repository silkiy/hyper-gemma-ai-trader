import 'dotenv/config';
import mongoose from 'mongoose';
import { Cooldown } from '../database/models/cooldown.model.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

async function clearCooldown() {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(env.MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Delete all active cooldowns
    const result = await Cooldown.deleteMany({});
    logger.info({ deletedCount: result.deletedCount }, 'Cleared all cooldowns from database');

    // Verify
    const remaining = await Cooldown.countDocuments();
    logger.info({ remaining }, 'Remaining cooldown records');

    await mongoose.disconnect();
    logger.info('Done! Cooldown cleared.');
  } catch (error) {
    logger.error({ error }, 'Failed to clear cooldown');
  }
}

clearCooldown();
