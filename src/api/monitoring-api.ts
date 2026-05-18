import Fastify from 'fastify';
import { logger } from '../utils/logger.js';
import { healthRoutes } from './routes/health.route.js';
import { tradeRoutes } from './routes/trade.route.js';
import { metricsRoutes } from './routes/metrics.route.js';

export async function startMonitoringApi() {
  const fastify = Fastify({ logger: false });

  // Register Routes
  await fastify.register(healthRoutes);
  await fastify.register(tradeRoutes);
  await fastify.register(metricsRoutes);

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info(`Monitoring API running at http://localhost:${port}`);
  } catch (err) {
    logger.error(err, 'Failed to start Fastify');
  }
}
