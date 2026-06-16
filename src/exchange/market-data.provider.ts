import axios from 'axios';
import { bitgetClient } from './bitget.client.js';
import { indicatorEngine } from '../core/market/indicator-engine.js';
import { tradeRepository } from '../database/repositories/trade.repository.js';
import { sessionService } from '../services/session.service.js';
import type { MarketData, AccountStatus } from '../types/market.types.js';
import { logger } from '../utils/logger.js';

import { env } from '../config/env.js';
import { TradingStrategy, TradeAction } from '../types/enum.types.js';

export class MarketDataProvider {
  private cachedTickers: any[] = [];
  private lastTickerFetch = 0;
  private readonly TICKER_CACHE_TTL = 5000; // 5 seconds cache

  private async getTickersWithCache(): Promise<any[]> {
    const now = Date.now();
    if (now - this.lastTickerFetch > this.TICKER_CACHE_TTL || this.cachedTickers.length === 0) {
      logger.info('Refreshing ticker cache from Bitget...');
      // We use the raw endpoint directly to get ALL fields (including high/low) in one go
      const response = await axios.get(`${env.BITGET_BASE_URL}/api/v2/mix/market/tickers?productType=USDT-FUTURES`);
      this.cachedTickers = response.data.data;
      this.lastTickerFetch = now;
    }
    return this.cachedTickers;
  }

  async getMarketData(pair: string): Promise<MarketData> {
    const symbol = pair.replace('/', '').replace('-', '');
    
    const interval = env.TRADING_STRATEGY === TradingStrategy.SCALPING ? '5m' : '1h';
    
    try {
      const klines = await bitgetClient.getCandles(symbol, interval);
      
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

      // 429 PREVENTION: Use shared ticker cache
      const tickers = await this.getTickersWithCache();
      const rawTicker = tickers.find((t: any) => 
        t.symbol === symbol || 
        t.symbol === `${symbol}_UMCBL` || 
        t.symbol.replace('_UMCBL', '') === symbol
      );

      return {
        pair,
        current_price: currentPrice,
        ema20,
        ema50,
        rsi,
        volume_24h: rawTicker ? parseFloat(rawTicker.usdtVolume || '0') : parseFloat(klines[klines.length - 1][5] || '0'),
        market_trend: trend,
        atr,
        funding_rate: 0,
        open_interest: 0,
        high_24h: rawTicker ? parseFloat(rawTicker.high24h || '0') : 0,
        low_24h: rawTicker ? parseFloat(rawTicker.low24h || '0') : 0,
        timestamp: Date.now(),
        price_change_24h: rawTicker ? parseFloat(rawTicker.change24h || '0') * 100 : 0, 
      };
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to provide real market data from Bitget API');
      throw error;
    }
  }

  async getAccountStatus(): Promise<AccountStatus> {
    try {
      const accounts = await bitgetClient.getAccountBalance();
      const positions = await bitgetClient.getPositions();
      
      const usdtAccount = accounts.find((a: any) => a.marginCoin === 'USDT');
      let walletBalance = usdtAccount ? parseFloat(usdtAccount.accountEquity || usdtAccount.equity || '0') : 0;
      let availableBalance = usdtAccount ? parseFloat(usdtAccount.available || '0') : 0;
      
      if (env.TRADING_MODE === 'PAPER') {
        // Strict Virtual Balance for PAPER mode to isolate from real funds
        const currentSessionId = sessionService.getCurrentSessionId();
        const dailyStats = await tradeRepository.getDailyStats(currentSessionId);
        
        walletBalance = 1.0 + dailyStats.dailyPnL; // Base $1.00 + Realized PnL
        availableBalance = walletBalance;
      }
      
      const activePositions = Array.isArray(positions) 
        ? positions.filter((p: any) => parseFloat(p.total || '0') !== 0)
        : [];

      let totalUnrealizedPnL = 0;
      let totalMaintenanceMargin = 0;
      
      activePositions.forEach((p: any) => {
        totalUnrealizedPnL += parseFloat(p.unrealizedPL || '0');
        totalMaintenanceMargin += parseFloat(p.marginSize || p.margin || '0');
      });

      let mappedPositions = activePositions.map(p => ({
        symbol: p.symbol.replace('_UMCBL', ''),
        size: p.total,
        entryPrice: p.openPriceAvg || p.averageOpenPrice,
        markPrice: p.markPrice,
        unRealizedProfit: p.unrealizedPL,
        liquidationPrice: p.liquidationPrice,
        leverage: p.leverage,
        holdSide: p.holdSide, 
        marginUsed: p.marginSize || p.margin 
      }));

      // LIVE MODE: Show ALL real Bitget positions regardless of session.
      // This prevents invisible positions after bot restart which could cause double-opens.

      if (env.TRADING_MODE === 'PAPER') {
        mappedPositions = []; 
        totalMaintenanceMargin = 0;
        totalUnrealizedPnL = 0;

        const currentSessionId = sessionService.getCurrentSessionId();
        const recentTrades = await tradeRepository.findRecent(20);
        const sessionTrades = recentTrades.filter(t => t.session_id.toString() === currentSessionId && t.result == null);
        
        const tickers = await this.getTickersWithCache();

        for (const t of sessionTrades) {
          const ticker = tickers.find((tick: any) => tick.symbol === t.pair);
          const currentPrice = ticker ? parseFloat(ticker.lastPr || ticker.lastPrice) : t.entry_price;
          
          const priceDiff = t.action === TradeAction.LONG 
            ? (currentPrice - t.entry_price) 
            : (t.entry_price - currentPrice);
          
          const quantity = 5.1 / t.entry_price; 
          const unrealizedPnL = priceDiff * quantity;

          mappedPositions.push({
            symbol: t.pair,
            size: quantity.toString(),
            entryPrice: t.entry_price.toString(),
            markPrice: currentPrice.toString(),
            unRealizedProfit: unrealizedPnL.toFixed(4),
            liquidationPrice: '0',
            leverage: t.leverage.toString(),
            holdSide: t.action === TradeAction.LONG ? 'long' : 'short',
            marginUsed: '0.10'
          });

          totalUnrealizedPnL += unrealizedPnL;
          totalMaintenanceMargin += 0.10; 
        }
      }

      const marginBalance = walletBalance + totalUnrealizedPnL; 
      const equity = walletBalance + totalUnrealizedPnL; 
      const marginRatio = marginBalance > 0 ? (totalMaintenanceMargin / marginBalance) * 100 : 0;

      // 4. Calculate Real Performance Metrics from Database
      const currentSessionId = sessionService.getCurrentSessionId();
      const dailyStats = await tradeRepository.getDailyStats(currentSessionId);
      const lossStreak = await tradeRepository.getConsecutiveLosses(currentSessionId);
      
      // Calculate daily PnL as percentage
      const dailyPnLPct = equity > 0 ? (dailyStats.dailyPnL / equity) * 100 : 0;

      return {
        current_equity: equity,
        open_positions: mappedPositions,
        daily_pnl: parseFloat(dailyPnLPct.toFixed(2)),
        loss_streak: lossStreak,
        available_balance: availableBalance,
        margin_ratio: marginRatio,
        maintenance_margin: totalMaintenanceMargin,
        margin_balance: marginBalance,
        total_wallet_balance: walletBalance
      };
    } catch (e) {
      logger.error('CRITICAL: Failed to fetch real Bitget account info.');
      throw e;
    }
  }
}

export const marketDataProvider = new MarketDataProvider();