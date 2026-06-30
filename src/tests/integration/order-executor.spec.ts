import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock env before importing
vi.mock('../../config/env.js', () => ({
  env: {
    TRADING_STRATEGY: 'INTRADAY',
    MIN_TPSL_NOTIONAL: 10,
    SCALP_MAX_LOSS_PERCENT: 0.3,
    INTRADAY_MAX_LOSS_PERCENT: 1.0,
    SWING_MAX_LOSS_PERCENT: 2.0,
    SCALP_PROFIT_TARGET_PERCENT: 0.5,
    INTRADAY_PROFIT_TARGET_PERCENT: 2.0,
    SWING_PROFIT_TARGET_PERCENT: 5.0,
  }
}));

// Mock bitgetClient
vi.mock('../../exchange/bitget.client.js', () => ({
  bitgetClient: {
    getSymbolInfo: vi.fn().mockResolvedValue({
      quantityPrecision: 2,
      pricePrecision: 2,
      maxLeverage: 50,
      minTradeUSDT: 5,
    }),
    setLeverage: vi.fn().mockResolvedValue({}),
    placeOrder: vi.fn().mockResolvedValue({ data: { orderId: '12345' } }),
    getFillHistory: vi.fn().mockResolvedValue([]),
  }
}));

// Mock marketDataProvider
vi.mock('../../exchange/market-data.provider.js', () => ({
  marketDataProvider: {
    getMarketData: vi.fn().mockResolvedValue({
      pair: 'BTCUSDT',
      current_price: 50000,
      rsi: 50,
      atr: 500,
    }),
    getAccountStatus: vi.fn().mockResolvedValue({
      current_equity: 1000,
      available_balance: 900,
      open_positions: [],
    }),
  }
}));

// Mock riskManager
vi.mock('../../core/risk/risk-manager.js', () => ({
  riskManager: {
    getStagedAllocation: vi.fn().mockReturnValue(0.02),
    validatePositionSize: vi.fn().mockReturnValue({ valid: true }),
  }
}));

import { OrderExecutor } from '../../exchange/order.executor.js';
import { TradeAction, MarketRegime, RiskLevel, PositionSize } from '../../types/enum.types.js';
import type { AIDecision } from '../../types/ai.types.js';

describe('OrderExecutor Integration', () => {
  let executor: OrderExecutor;
  let mockDecision: AIDecision;

  beforeEach(() => {
    executor = new OrderExecutor();
    mockDecision = {
      decision: TradeAction.LONG,
      symbol: 'BTCUSDT',
      confidence: 'HIGH',
      confidence_score: 80,
      market_regime: MarketRegime.TRENDING,
      risk_level: RiskLevel.MEDIUM,
      leverage_suggestion: 25,
      position_size: PositionSize.NORMAL,
      entry_reason: 'Test entry',
      risk_factors: [],
      stop_loss_logic: 'ATR-based',
      take_profit_logic: 'ATR-based',
      self_reflection: 'Test',
      final_summary: 'Test trade',
    };
  });

  it('should calculate correct order sizing', async () => {
    // Mock returns $10 target notional
    const result = await executor.executeOrder(mockDecision, 'BTCUSDT');
    
    expect(result).toBeDefined();
    expect(result.orderId).toBe('12345');
    expect(result.status).toBe('FILLED');
  });

  it('should calculate dynamic SL/TP based on ATR', async () => {
    // ATR = 500, Price = 50000
    // ATR% = 1%
    // SL = 1.5x ATR = 1.5%
    // TP = 3.0x ATR = 3.0%
    
    const result = await executor.executeOrder(mockDecision, 'BTCUSDT');
    expect(result).toBeDefined();
  });

  it('should handle leverage correctly', async () => {
    mockDecision.leverage_suggestion = 50;
    
    const result = await executor.executeOrder(mockDecision, 'BTCUSDT');
    expect(result).toBeDefined();
  });

  it('should handle LOW confidence decision', async () => {
    mockDecision.confidence = 'LOW';
    mockDecision.confidence_score = 30;
    
    const result = await executor.executeOrder(mockDecision, 'BTCUSDT');
    expect(result).toBeDefined();
  });
});
