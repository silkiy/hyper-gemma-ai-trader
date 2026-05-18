import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  MONGODB_URI: z.string().url(),
  ASTERDEX_USER_ADDRESS: z.string().startsWith('0x'),
  ASTERDEX_API_KEY: z.string(),
  ASTERDEX_SECRET: z.string(),
  ASTERDEX_BASE_URL: z.string().url().default('https://fapi.asterdex.com'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('gemma:7b-instruct'),
  MOCK_AI: z.string().transform(v => v === 'true').default('false'),
  TRADING_PAIR: z.string().default('ETH/USDC'),
  WALLET_ADDRESS: z.string().optional(),
  HYPERLIQUID_TESTNET: z.string().transform(v => v !== 'false').default('true'),
  PORT: z.string().transform(Number).default('3000'),
});

export const env = envSchema.parse(process.env);
