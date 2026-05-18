import { describe, it, expect } from 'vitest';
import { riskManager } from '../../core/risk/risk-manager.js';
import { PositionSize } from '../../types/enum.types.js';

describe('RiskManager', () => {
  it('should calculate correct position size for NORMAL', () => {
    const size = riskManager.calculatePositionSize(1000, PositionSize.NORMAL);
    expect(size).toBe(5); // 0.5% of 1000
  });

  it('should calculate correct position size for REDUCED', () => {
    const size = riskManager.calculatePositionSize(1000, PositionSize.REDUCED);
    expect(size).toBe(2.5); // 50% of 0.5%
  });
});
