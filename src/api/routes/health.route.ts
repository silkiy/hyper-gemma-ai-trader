import type { FastifyInstance } from 'fastify';
import { checkSystemHealth } from '../../monitoring/health-check.js';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return await checkSystemHealth();
  });
}
