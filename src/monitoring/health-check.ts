import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

export async function checkSystemHealth() {
  const health = {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date(),
  };

  if (health.dbStatus !== 'connected') {
    logger.error('System Health Check: Database is DISCONNECTED');
  }

  return health;
}
