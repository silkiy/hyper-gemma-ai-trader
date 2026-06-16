import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  MONGODB_URI: z.string().url(),

  // Bitget API Config
  BITGET_API_KEY: z.string().min(1, "BITGET_API_KEY is required"),
  BITGET_SECRET_KEY: z.string().min(1, "BITGET_SECRET_KEY is required"),
  BITGET_PASSPHRASE: z.string().min(1, "BITGET_PASSPHRASE is required"),
  BITGET_BASE_URL: z.string().url().default('https://api.bitget.com'),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('gemma:7b-instruct'),
  MOCK_AI: z.string().default('false').transform(v => v === 'true'),
  TRADING_PAIR: z.string().default('ETH/USDC'),
  WALLET_ADDRESS: z.string().optional(),
  HYPERLIQUID_TESTNET: z.string().default('true').transform(v => v !== 'false'),
  PORT: z.string().default('3000').transform(Number),
  MAX_POSITIONS: z.string().default('1').transform(Number),
  MAX_CONSECUTIVE_LOSS: z.string().default('5').transform(Number),
  MAX_TRADE_ALLOCATION: z.string().default('0.20').transform(Number), // Default 20% of balance
  MIN_TPSL_NOTIONAL: z.string().default('10').transform(Number), // Default 10 USDT for SL/TP
  TRADING_STRATEGY: z.enum(['SCALPING', 'INTRADAY', 'SWING']).default('INTRADAY'),
  SCAN_MODE: z.enum(['VIP', 'HOT50', 'ALL']).default('ALL'),
  TRADING_MODE: z.enum(['PAPER', 'LIVE']).default('PAPER'),
  SCALP_MAX_HOLD_MINUTES: z.string().default('10').transform(Number),
  SCALP_PROFIT_EXIT_MINUTES: z.string().default('5').transform(Number),
  SCALP_PROFIT_EXIT_USD: z.string().default('0.05').transform(Number),
  SCALP_MAX_LOSS_USD: z.string().default('0.03').transform(Number),
});

export const env = envSchema.parse(process.env);
