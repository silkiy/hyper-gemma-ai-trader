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
  TIME_LIMIT = 'TIME_LIMIT',
  TRAILING_STOP = 'TRAILING_STOP',
  SMART_BREAKEVEN = 'SMART_BREAKEVEN',
  PROFIT_EXIT = 'PROFIT_EXIT',
  BACKUP_SHIELD = 'BACKUP_SHIELD',
  MAX_LOSS = 'MAX_LOSS',
  AUTO_STOP = 'AUTO_STOP',
  MANUAL_OR_UNKNOWN = 'MANUAL_OR_UNKNOWN',
}
