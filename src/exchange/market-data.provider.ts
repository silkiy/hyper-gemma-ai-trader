import axios from 'axios';
import { bitgetClient } from './bitget.client.js';
import { indicatorEngine } from '../core/market/indicator-engine.js';
import { tradeRepository } from '../database/repositories/trade.repository.js';
import { sessionService } from '../services/session.service.js';
import type { MarketData, AccountStatus } from '../types/market.types.js';
import { logger } from '../utils/logger.js';

import { env } from '../config/env.js';
import { TradingStrategy } from '../types/enum.types.js';

export class MarketDataProvider {
  async getMarketData(pair: string): Promise<MarketData> {
    const symbol = pair.replace('/', '').replace('-', '');
    
    const interval = env.TRADING_STRATEGY === TradingStrategy.SCALPING ? '5m' : '1h';
    
    logger.info({ symbol, interval, strategy: env.TRADING_STRATEGY }, 'Fetching real-time market data from Bitget API');

    try {
      const klines = await bitgetClient.getCandles(symbol, interval);
      
      // Bitget Mix: [Time, Open, High, Low, Close, Volume, Amount]
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

      const allTickers = await bitgetClient.getAllTickers();
      const ticker = allTickers.find((t: any) => t.symbol === symbol);
      
      // Find raw ticker for high/low data
      const rawTickers = await axios.get(`${env.BITGET_BASE_URL}/api/v2/mix/market/tickers?productType=USDT-FUTURES`);
      const rawTicker = rawTickers.data.data.find((t: any) => t.symbol === (symbol.endsWith('_UMCBL') ? symbol : `${symbol}_UMCBL`));

      return {
        pair,
        current_price: currentPrice,
        ema20,
        ema50,
        rsi,
        volume_24h: ticker ? parseFloat(ticker.volume || '0') : parseFloat(klines[klines.length - 1][5] || '0'),
        market_trend: trend,
        atr,
        funding_rate: 0,
        open_interest: 0,
        high_24h: rawTicker ? parseFloat(rawTicker.high24h || '0') : 0,
        low_24h: rawTicker ? parseFloat(rawTicker.low24h || '0') : 0,
        timestamp: Date.now(),
        price_change_24h: ticker ? parseFloat(ticker.priceChangePercent || '0') : 0, 
      };
    } catch (error) {
      logger.error('Failed to provide real market data from Bitget API');
      throw error;
    }
  }

  async getAccountStatus(): Promise<AccountStatus> {
    try {
      const accounts = await bitgetClient.getAccountBalance();
      const positions = await bitgetClient.getPositions();
      
      const usdtAccount = accounts.find((a: any) => a.marginCoin === 'USDT');
      let walletBalance = usdtAccount ? parseFloat(usdtAccount.equity || '0') : 0;
      let availableBalance = usdtAccount ? parseFloat(usdtAccount.available || '0') : 0;
      
      // VIRTUAL BALANCE FALLBACK (For PAPER mode with 0 actual funds)
      if (env.TRADING_MODE === 'PAPER' && walletBalance <= 0) {
        logger.info('PAPER MODE: Actual balance is $0. Providing virtual $1.00 for simulation.');
        walletBalance = 1.0;
        availableBalance = 1.0;
      }
      
      const activePositions = Array.isArray(positions) 
        ? positions.filter((p: any) => parseFloat(p.total || '0') !== 0)
        : [];

      let totalUnrealizedPnL = 0;
      let totalMaintenanceMargin = 0;
      
      activePositions.forEach((p: any) => {
        totalUnrealizedPnL += parseFloat(p.unrealizedPL || '0');
        totalMaintenanceMargin += parseFloat(p.margin || '0');
      });

      let mappedPositions = activePositions.map(p => ({
        symbol: p.symbol.replace('_UMCBL', ''),
        size: p.total,
        entryPrice: p.averageOpenPrice,
        markPrice: p.markPrice,
        unRealizedProfit: p.unrealizedPL,
        liquidationPrice: p.liquidationPrice,
        leverage: p.leverage
      }));

      // FIX 2: Isolation for PAPER MODE
      if (env.TRADING_MODE === 'PAPER') {
        // Reset: Ignore real positions to keep simulation isolated
        mappedPositions = []; 
        totalMaintenanceMargin = 0;

        const currentSessionId = sessionService.getCurrentSessionId();
        const recentTrades = await tradeRepository.findRecent(10);
        // Only count mock positions from the CURRENT session
        const sessionTrades = recentTrades.filter(t => t.session_id.toString() === currentSessionId);
        
        for (const t of sessionTrades) {
          if (!mappedPositions.find(p => p.symbol === t.pair)) {
            mappedPositions.push({
              symbol: t.pair,
              size: 'MOCK',
              entryPrice: t.entry_price?.toString() || '0',
              markPrice: t.entry_price?.toString() || '0',
              unRealizedProfit: '0',
              liquidationPrice: '0',
              leverage: t.leverage?.toString() || '1'
            });
            // Assume 20% margin usage for each mock position for calculation
            totalMaintenanceMargin += 0.10; 
          }
        }
      }

      const marginBalance = walletBalance; 
      const equity = walletBalance; 
      const marginRatio = marginBalance > 0 ? (totalMaintenanceMargin / marginBalance) * 100 : 0;

      return {
        current_equity: equity,
        open_positions: mappedPositions,
        daily_pnl: 0,
        loss_streak: 0,
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
