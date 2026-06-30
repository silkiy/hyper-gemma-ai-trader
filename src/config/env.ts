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
  OLLAMA_MODEL: z.string().default('gemma4:latest'),
  MOCK_AI: z.string().default('false').transform(v => v.replace(/["']/g, '').trim().toLowerCase() === 'true'),
  TRADING_PAIR: z.string().default('ETH/USDC'),
  WALLET_ADDRESS: z.string().optional(),
  HYPERLIQUID_TESTNET: z.string().default('true').transform(v => v.replace(/["']/g, '').trim().toLowerCase() !== 'false'),
  PORT: z.string().default('3000').transform(Number),
  MAX_POSITIONS: z.string().default('1').transform(Number),
  MAX_CONSECUTIVE_LOSS: z.string().default('5').transform(Number),
  MAX_TRADE_ALLOCATION: z.string().default('0.20').transform(Number),
  MIN_TPSL_NOTIONAL: z.string().default('10').transform(Number),
  TRADING_STRATEGY: z.enum(['SCALPING', 'INTRADAY', 'SWING']).default('INTRADAY'),
  SCAN_MODE: z.string().default('ALL'),
  TRADING_MODE: z.enum(['PAPER', 'LIVE']).default('PAPER'),
  MAX_DRAWDOWN_PERCENT: z.string().default('20').transform(Number),

  // ═══════════════════════════════════════════════
  // SCALPING PARAMETERS
  // ═══════════════════════════════════════════════
  SCALP_MAX_HOLD_MINUTES: z.string().default('10').transform(Number),
  SCALP_PROFIT_EXIT_MINUTES: z.string().default('5').transform(Number),
  SCALP_PROFIT_TARGET_PERCENT: z.string().default('0.5').transform(Number),
  SCALP_MAX_LOSS_PERCENT: z.string().default('0.3').transform(Number),

  // ═══════════════════════════════════════════════
  // INTRADAY PARAMETERS
  // ═══════════════════════════════════════════════
  INTRADAY_MAX_HOLD_MINUTES: z.string().default('240').transform(Number),
  INTRADAY_PROFIT_EXIT_MINUTES: z.string().default('60').transform(Number),
  INTRADAY_PROFIT_TARGET_PERCENT: z.string().default('2.0').transform(Number),
  INTRADAY_MAX_LOSS_PERCENT: z.string().default('1.0').transform(Number),

  // ═══════════════════════════════════════════════
  // SWING PARAMETERS
  // ═══════════════════════════════════════════════
  SWING_MAX_HOLD_MINUTES: z.string().default('1440').transform(Number),
  SWING_PROFIT_EXIT_MINUTES: z.string().default('240').transform(Number),
  SWING_PROFIT_TARGET_PERCENT: z.string().default('5.0').transform(Number),
  SWING_MAX_LOSS_PERCENT: z.string().default('2.0').transform(Number),
});

export const env = envSchema.parse(process.env);
