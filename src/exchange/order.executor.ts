import { asterdexClient } from './asterdex.client.js';
import type { AIDecision } from '../types/ai.types.js';
import { logger } from '../utils/logger.js';
import { TradeAction } from '../types/enum.types.js';
import { marketDataProvider } from './market-data.provider.js';
import { env } from '../config/env.js';

export class OrderExecutor {
  private readonly MIN_NOTIONAL = 5.1; // $5.1 to be safe against exchange min $5

  async executeOrder(decision: AIDecision, symbol: string): Promise<{ orderId: string; status: string; price: number }> {
    const cleanSymbol = symbol.replace('/', '').replace('-', '');
    
    logger.info({ 
      action: decision.decision, 
      leverage: decision.leverage_suggestion,
      size: decision.position_size,
      symbol: cleanSymbol
    }, 'Executing ASTERDEX Pro API order');

    try {
      // 1. Force CROSSED margin to allow 80% buffer to work
      await asterdexClient.setMarginType(symbol, 'CROSSED');

      // 2. Fetch latest price for quantity calculation
      const marketData = await marketDataProvider.getMarketData(symbol);
      const price = marketData.current_price;
      const accountStatus = await marketDataProvider.getAccountStatus();

      // 3. Calculate Quantity to meet MIN_NOTIONAL ($5)
      // Fetch precision info for the symbol
      const symbolInfo = await asterdexClient.getSymbolInfo(symbol);
      const precision = symbolInfo.quantityPrecision;
      const pricePrecision = symbolInfo.pricePrecision;
      
      const rawQuantity = this.MIN_NOTIONAL / price;
      
      // Use Math.ceil with precision to ensure we are ALWAYS >= MIN_NOTIONAL
      const multiplier = Math.pow(10, precision);
      const quantityStr = (Math.ceil(rawQuantity * multiplier) / multiplier).toFixed(precision);
      const quantity = parseFloat(quantityStr);
      
      // PRE-CHECK & AUTO-LEVERAGE OPTIMIZATION
      const available = accountStatus.available_balance || 0;
      const minNotional = this.MIN_NOTIONAL;
      let leverage = decision.leverage_suggestion;

      // 1. Calculate minimum leverage needed to afford this trade
      // (minNotional / leverage) must be <= available balance
      const minNeededLeverage = Math.ceil(minNotional / (available * 0.9)); // 10% buffer
      
      if (leverage < minNeededLeverage) {
        logger.info({ suggested: leverage, required: minNeededLeverage }, 'Auto-increasing leverage to meet minimum margin requirements');
        leverage = minNeededLeverage;
      }

      // 2. Cap leverage for altcoins (BTC/ETH can go higher, others usually max 50x-75x)
      const isMajor = symbol.startsWith('BTC') || symbol.startsWith('ETH');
      const maxSafeLeverage = isMajor ? 200 : 50;
      
      if (leverage > maxSafeLeverage) {
        logger.info({ requested: leverage, capped: maxSafeLeverage }, 'Capping leverage to safe exchange limits');
        leverage = maxSafeLeverage;
      }

      // 3. Final check: Can we actually afford this now?
      // Add a 20% buffer to account for exchange fees, slippage and minimum wallet requirements
      const finalRequiredMargin = (minNotional / leverage) * 1.20;
      if (finalRequiredMargin > available) {
        const errorMsg = `Margin unsafe for ${symbol}. Need ~$${finalRequiredMargin.toFixed(4)} (inc. buffer), have $${available.toFixed(4)}`;
        logger.warn(errorMsg);
        throw new Error(errorMsg);
      }

      // Map TradeAction to Side
      const side = decision.decision === TradeAction.LONG ? 'BUY' : 'SELL';
      
      logger.info({ 
        targetNotional: minNotional, 
        calcQuantity: quantityStr, 
        finalLeverage: leverage,
        estimatedMargin: finalRequiredMargin.toFixed(4),
        availableBalance: available.toFixed(4)
      }, 'Order calculation complete (Optimized)');

      const order = await asterdexClient.placeOrder({
        symbol: symbol,
        side: side,
        type: 'MARKET',
        quantity: quantityStr,
        leverage: leverage
      });

      const orderId = order.orderId || `aster-pro-${Math.random().toString(36).substr(2, 9)}`;
      logger.info({ orderId }, 'Order executed successfully on ASTERDEX Pro API');

      // 4. Automated Stop Loss & Take Profit (Dynamic based on Strategy)
      try {
        const side = decision.decision === TradeAction.LONG ? 'BUY' : 'SELL';
        const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
        
        // Define strategy-based percentages
        let slPercent = 0.01; // 1% default
        let tpPercent = 0.015; // 1.5% default

        const strategy = env.TRADING_STRATEGY;
        if (strategy === 'SCALPING') {
          slPercent = 0.005; // 0.5% SL
          tpPercent = 0.0075; // 0.75% TP
        } else if (strategy === 'SWING') {
          slPercent = 0.03; // 3% SL
          tpPercent = 0.10; // 10% TP
        }

        const slPrice = side === 'BUY' 
          ? price * (1 - slPercent) 
          : price * (1 + slPercent);
          
        const tpPrice = side === 'BUY'
          ? price * (1 + tpPercent)
          : price * (1 - tpPercent);

        logger.info({ 
          strategy,
          slPrice: slPrice.toFixed(pricePrecision), 
          tpPrice: tpPrice.toFixed(pricePrecision),
          rr: `1:${(tpPercent / slPercent).toFixed(1)}`
        }, 'Placing automated SL/TP orders...');

        // Place Stop Loss
        await asterdexClient.placeOrder({
          symbol: symbol,
          side: closeSide,
          type: 'STOP_MARKET',
          quantity: quantityStr,
          stopPrice: slPrice.toFixed(pricePrecision),
          reduceOnly: true
        });

        // Place Take Profit
        await asterdexClient.placeOrder({
          symbol: symbol,
          side: closeSide,
          type: 'TAKE_PROFIT_MARKET',
          quantity: quantityStr,
          stopPrice: tpPrice.toFixed(pricePrecision),
          reduceOnly: true
        });

        logger.info('SL/TP orders placed successfully.');
      } catch (sltpError) {
        logger.warn({ sltpError }, 'Failed to place automated SL/TP orders. Position is open WITHOUT protection!');
      }
      
      return { orderId, status: 'FILLED', price };
    } catch (error) {
      logger.error({ error }, 'Failed to execute order on ASTERDEX Pro API');
      throw error;
    }
  }
}

export const orderExecutor = new OrderExecutor();
