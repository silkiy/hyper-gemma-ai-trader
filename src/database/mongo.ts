import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/hyper-gemma';

  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(uri);
    logger.info('Successfully connected to MongoDB');
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'MongoDB connection error');
    process.exit(1);
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'MongoDB runtime error');
});
