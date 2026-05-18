import type { FastifyInstance } from 'fastify';
import { tradeRepository } from '../../database/repositories/trade.repository.js';

export async function tradeRoutes(fastify: FastifyInstance) {
  fastify.get('/trades', async () => {
    return await tradeRepository.findRecent(20);
  });

  fastify.get('/trades/stats', async () => {
    return await tradeRepository.getStats();
  });
}
