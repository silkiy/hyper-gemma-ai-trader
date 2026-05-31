export interface MarketData {
  pair: string;
  current_price: number;
  ema20: number;
  ema50: number;
  rsi: number;
  volume_24h: number;
  market_trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  atr: number;
  funding_rate: number;
  open_interest: number;
  high_24h?: number;
  low_24h?: number;
  timestamp: number;
  price_change_24h?: number;
}

export interface AccountStatus {
  current_equity: number;
  open_positions: any[];
  daily_pnl: number;
  loss_streak: number;
  available_balance?: number;
  margin_ratio?: number;
  maintenance_margin?: number;
  margin_balance?: number;
  total_wallet_balance?: number;
}
