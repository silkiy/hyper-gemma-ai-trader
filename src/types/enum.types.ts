export enum TradingStrategy {
  SCALPING = 'SCALPING',
  INTRADAY = 'INTRADAY',
  SWING = 'SWING',
}

export enum TradingMode {
  PAPER = 'PAPER',
  LIVE = 'LIVE',
}

export enum TradeAction {
  LONG = 'LONG',
  SHORT = 'SHORT',
  WAIT = 'WAIT',
  SKIP = 'SKIP',
}

export enum MarketRegime {
  TRENDING = 'TRENDING',
  RANGING = 'RANGING',
  VOLATILE = 'VOLATILE',
  UNCLEAR = 'UNCLEAR',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum SessionMode {
  NORMAL = 'NORMAL',
  SAFE_MODE = 'SAFE_MODE',
  COOLDOWN = 'COOLDOWN',
}

export enum MemoryCategory {
  ENTRY = 'ENTRY',
  EXIT = 'EXIT',
  RISK = 'RISK',
  PSYCHOLOGY = 'PSYCHOLOGY',
}

export enum PositionSize {
  SMALL = 'SMALL',
  NORMAL = 'NORMAL',
  REDUCED = 'REDUCED',
}

export enum TradeResult {
  WIN = 'WIN',
  LOSS = 'LOSS',
  BREAKEVEN = 'BREAKEVEN',
}

export enum TradeExitReason {
  TP_HIT = 'TP_HIT',
  SL_HIT = 'SL_HIT',
  MANUAL_OR_UNKNOWN = 'MANUAL_OR_UNKNOWN',
}
