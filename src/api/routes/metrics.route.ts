import type { FastifyInstance } from 'fastify';
import { register } from '../../monitoring/metrics.js';

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', register.contentType);
    return await register.metrics();
  });
}
