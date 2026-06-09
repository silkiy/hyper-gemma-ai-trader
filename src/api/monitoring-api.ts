import Fastify from 'fastify';
import { logger } from '../utils/logger.js';
import { healthRoutes } from './routes/health.route.js';
import { tradeRoutes } from './routes/trade.route.js';
import { metricsRoutes } from './routes/metrics.route.js';
import { tradeRepository } from '../database/repositories/trade.repository.js';

export async function startMonitoringApi() {
  const fastify = Fastify({ logger: false });

  // Register Routes
  await fastify.register(healthRoutes);
  await fastify.register(tradeRoutes);
  await fastify.register(metricsRoutes);

  // Task 5D: Pair Performance API
  fastify.get('/api/pair-performance', async (request, reply) => {
    try {
      const performance = await tradeRepository.aggregatePairPerformance();
      
      if (performance.length === 0) {
        return { 
          data: [], 
          message: "No closed trade history yet. Trades are recorded after SL/TP/manual close is detected." 
        };
      }

      // Sort by score descending
      const sortedData = performance.sort((a, b) => b.score - a.score);

      // Add recommendations
      const dataWithRecs = sortedData.map((item, index) => {
        let recommendation = null;
        if (index === 0 && item.totalTrades >= 5) {
          recommendation = "FOCUS_CANDIDATE";
        } else if (index < 3 && item.totalTrades >= 3) {
          recommendation = "PROMISING";
        }
        return { ...item, recommendation };
      });

      return {
        data: dataWithRecs,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch pair performance');
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    logger.info(`Monitoring API running at http://localhost:${port}`);
  } catch (err) {
    logger.error(err, 'Failed to start Fastify');
  }
}
