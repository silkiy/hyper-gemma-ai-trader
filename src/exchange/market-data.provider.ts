import { asterdexClient } from './asterdex.client.js';
import { indicatorEngine } from '../core/market/indicator-engine.js';
import type { MarketData, AccountStatus } from '../types/market.types.js';
import { logger } from '../utils/logger.js';

export class MarketDataProvider {
  async getMarketData(pair: string): Promise<MarketData> {
    // Pro API uses BTCUSDT format
    const symbol = pair.replace('/', '').replace('-', '');
    logger.info({ symbol }, 'Fetching real-time market data from ASTERDEX Pro API');

    try {
      const klines = await asterdexClient.getCandles(symbol);
      const ticker24h = await asterdexClient.getTicker24h(symbol);
      
      // Pro API (Binance format): [0:openTime, 1:open, 2:high, 3:low, 4:close, 5:volume...]
      const closePrices = klines.map((c: any) => parseFloat(c[4]));
      const highPrices = klines.map((c: any) => parseFloat(c[2]));
      const lowPrices = klines.map((c: any) => parseFloat(c[3]));

      const currentPrice = closePrices[closePrices.length - 1];
      const ema20 = indicatorEngine.calculateEMA(closePrices, 20);
      const ema50 = indicatorEngine.calculateEMA(closePrices, 50);
      const rsi = indicatorEngine.calculateRSI(closePrices, 14);
      const atr = indicatorEngine.calculateATR(highPrices, lowPrices, closePrices, 14);

      let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      if (currentPrice > ema20 && ema20 > ema50) trend = 'BULLISH';
      else if (currentPrice < ema20 && ema20 < ema50) trend = 'BEARISH';

      return {
        pair,
        current_price: currentPrice,
        ema20,
        ema50,
        rsi,
        volume_24h: parseFloat(ticker24h.volume || '0'),
        market_trend: trend,
        atr,
        funding_rate: 0,
        open_interest: 0,
        timestamp: Date.now(),
        price_change_24h: parseFloat(ticker24h.priceChangePercent || '0'),
      };
    } catch (error) {
      logger.error('Failed to provide real market data from ASTERDEX Pro API, falling back to mock');
      return this.getMockMarketData(pair);
    }
  }

  async getAccountStatus(): Promise<AccountStatus> {
    try {
      const balances = await asterdexClient.getAccountBalance();
      // Pro API returns an array of balances
      const usdcAsset = balances.find((a: any) => a.asset === 'USDC' || a.asset === 'USDT');
      const equity = usdcAsset ? parseFloat(usdcAsset.balance || usdcAsset.availableBalance) : 0;
      
      const positions = await asterdexClient.getPositions();
      // Filter only positions that have actual size (not zero)
      const activePositions = Array.isArray(positions) 
        ? positions.filter((p: any) => parseFloat(p.positionAmt || p.size || '0') !== 0)
        : [];

      return {
        current_equity: equity,
        open_positions: activePositions,
        daily_pnl: 0,
        loss_streak: 0,
      };
    } catch (e) {
      logger.error('Failed to fetch real ASTERDEX account info');
      return {
        current_equity: 0,
        open_positions: [],
        daily_pnl: 0,
        loss_streak: 0,
      };
    }
  }

  private getMockMarketData(pair: string): MarketData {
    return {
      pair,
      current_price: 2500,
      ema20: 2480,
      ema50: 2450,
      rsi: 55,
      volume_24h: 1000000,
      market_trend: 'BULLISH',
      atr: 50,
      funding_rate: 0.0001,
      open_interest: 500000,
      timestamp: Date.now(),
    };
  }
}

export const marketDataProvider = new MarketDataProvider();
