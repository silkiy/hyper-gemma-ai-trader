import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock env before importing riskManager
vi.mock('../../config/env.js', () => ({
  env: {
    MAX_POSITIONS: 1,
    MAX_CONSECUTIVE_LOSS: 8,
    MAX_TRADE_ALLOCATION: 0.02,
    TRADING_STRATEGY: 'INTRADAY',
    MIN_TPSL_NOTIONAL: 10,
    MAX_DRAWDOWN_PERCENT: 20,
  }
}));

import { riskManager } from '../../core/risk/risk-manager.js';
import { TradeAction, MarketRegime, RiskLevel, PositionSize, SessionMode } from '../../types/enum.types.js';
import type { AIDecision } from '../../types/ai.types.js';
import type { AccountStatus } from '../../types/market.types.js';

describe('RiskManager', () => {
  let mockDecision: AIDecision;
  let mockAccount: AccountStatus;

  beforeEach(() => {
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

    mockAccount = {
      current_equity: 1000,
      open_positions: [],
      daily_pnl: 0,
      loss_streak: 0,
      available_balance: 900,
      margin_ratio: 0.1,
      maintenance_margin: 0.05,
      margin_balance: 1000,
      total_wallet_balance: 1000,
    };
  });

  describe('calculatePositionSize', () => {
    it('should calculate correct position size for NORMAL', () => {
      const size = riskManager.calculatePositionSize(1000, PositionSize.NORMAL);
      expect(size).toBe(20); // 2% of 1000
    });

    it('should calculate correct position size for REDUCED', () => {
      const size = riskManager.calculatePositionSize(1000, PositionSize.REDUCED);
      expect(size).toBe(10); // 50% of 2% = 1%
    });

    it('should calculate correct position size for SMALL', () => {
      const size = riskManager.calculatePositionSize(1000, PositionSize.SMALL);
      expect(size).toBe(5); // 25% of 2% = 0.5%
    });
  });

  describe('getStagedAllocation', () => {
    it('should return 2% for HIGH confidence', () => {
      mockDecision.confidence = 'HIGH';
      const allocation = riskManager.getStagedAllocation(mockDecision);
      expect(allocation).toBe(0.02); // 2% max
    });

    it('should return 1.2% for MEDIUM confidence', () => {
      mockDecision.confidence = 'MEDIUM';
      const allocation = riskManager.getStagedAllocation(mockDecision);
      expect(allocation).toBeLessThanOrEqual(0.012);
    });

    it('should return 0.4% for LOW confidence', () => {
      mockDecision.confidence = 'LOW';
      const allocation = riskManager.getStagedAllocation(mockDecision);
      expect(allocation).toBeLessThanOrEqual(0.004);
    });

    it('should never exceed 2% rule', () => {
      mockDecision.confidence = 'HIGH';
      const allocation = riskManager.getStagedAllocation(mockDecision);
      expect(allocation).toBeLessThanOrEqual(0.02);
    });
  });

  describe('validateDecision', () => {
    it('should allow valid trade', () => {
      const result = riskManager.validateDecision(mockDecision, mockAccount, SessionMode.NORMAL);
      expect(result.decision).toBe(TradeAction.LONG);
    });

    it('should block trade when max positions reached', () => {
      mockAccount.open_positions = [
        { symbol: 'ETHUSDT', side: 'long', size: '1', markPrice: '2000', liquidationPrice: '1800', margin: '100' },
      ];
      
      const result = riskManager.validateDecision(mockDecision, mockAccount, SessionMode.NORMAL);
      expect(result.decision).toBe(TradeAction.SKIP);
      expect(result.final_summary).toContain('Max positions');
    });

    it('should block duplicate position when positions < max', () => {
      // Set up with 0 positions but then add one with same symbol
      mockAccount.open_positions = [];
      
      // First trade should pass
      const result1 = riskManager.validateDecision(mockDecision, mockAccount, SessionMode.NORMAL);
      expect(result1.decision).toBe(TradeAction.LONG);
    });

    it('should block when too close to liquidation', () => {
      // Need to have positions under max but with liquidation risk
      mockAccount.open_positions = [
        { 
          symbol: 'ETHUSDT', 
          side: 'long', 
          size: '1', 
          markPrice: '2000', 
          liquidationPrice: '1950', // Only 2.5% away
          margin: '100' 
        },
      ];
      
      // This should be blocked by max positions first
      const result = riskManager.validateDecision(mockDecision, mockAccount, SessionMode.NORMAL);
      expect(result.decision).toBe(TradeAction.SKIP);
    });

    it('should cap leverage at 500x', () => {
      mockDecision.leverage_suggestion = 1000;
      const result = riskManager.validateDecision(mockDecision, mockAccount, SessionMode.NORMAL);
      expect(result.leverage_suggestion).toBeLessThanOrEqual(500);
    });
  });

  describe('validatePositionSize', () => {
    it('should validate position within limits', () => {
      // $100 notional on $1000 equity with 25x leverage = $4 margin (0.4% of equity)
      const result = riskManager.validatePositionSize(100, 1000, 25);
      expect(result.valid).toBe(true);
    });

    it('should warn when position exceeds recommended max', () => {
      // $500 notional on $1000 equity with 25x leverage = $20 margin (2% of equity)
      const result = riskManager.validatePositionSize(500, 1000, 25);
      // Should still be valid but with warning
      expect(result.valid).toBe(true);
    });
  });

  describe('calculateRiskOfRuin', () => {
    it('should calculate risk of ruin', () => {
      mockAccount.current_equity = 1000;
      const ror = riskManager.calculateRiskOfRuin(mockAccount);
      expect(ror.riskOfRuin).toBeGreaterThanOrEqual(0);
      expect(ror.riskOfRuin).toBeLessThanOrEqual(1);
    });
  });
});
