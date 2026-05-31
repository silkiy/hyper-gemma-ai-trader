import { bitgetClient } from './bitget.client.js';
import type { AIDecision } from '../types/ai.types.js';
import { logger } from '../utils/logger.js';
import { TradeAction } from '../types/enum.types.js';
import { marketDataProvider } from './market-data.provider.js';
import { env } from '../config/env.js';

export class OrderExecutor {
  private readonly MIN_NOTIONAL = 5.1; 

  async executeOrder(decision: AIDecision, symbol: string): Promise<{ orderId: string; status: string; price: number }> {
    logger.info({ 
      action: decision.decision, 
      symbol: symbol
    }, 'Executing Bitget V2 order');

    try {
      // 1. Fetch latest price and account status
      const marketData = await marketDataProvider.getMarketData(symbol);
      const price = marketData.current_price;
      const accountStatus = await marketDataProvider.getAccountStatus();

      // 2. Fetch precision and leverage limits directly from bursa
      const symbolInfo = await bitgetClient.getSymbolInfo(symbol);
      const precision = symbolInfo.quantityPrecision;
      const pricePrecision = symbolInfo.pricePrecision;
      const maxExchangeLeverage = symbolInfo.maxLeverage;

      logger.info({ symbol, maxExchangeLeverage, pricePrecision }, 'Bitget V2 Symbol Data');

      // 3. Calculate Quantity to meet MIN_NOTIONAL ($5)
      const rawQuantity = this.MIN_NOTIONAL / price;
      const multiplier = Math.pow(10, precision);
      const quantityStr = (Math.ceil(rawQuantity * multiplier) / multiplier).toFixed(precision);
      
      // 4. AUTO-LEVERAGE OPTIMIZATION (Rata Kanan)
      const available = accountStatus.available_balance || 0;
      const minNotional = this.MIN_NOTIONAL;
      
      // Calculate minimum leverage needed with 10% buffer
      const minNeededLeverage = Math.ceil(minNotional / (available * 0.9)); 
      
      // Use maximum possible leverage (capped by exchange)
      let finalLeverage = Math.max(decision.leverage_suggestion, minNeededLeverage);
      if (finalLeverage > maxExchangeLeverage) finalLeverage = maxExchangeLeverage;

      // Final Affordability Check
      const requiredMargin = minNotional / finalLeverage;
      const safeAvailable = available * 0.98; // 2% for safety/fees

      if (requiredMargin > safeAvailable) {
        const errorMsg = `CANNOT AFFORD ${symbol}: Needs $${requiredMargin.toFixed(4)} margin, have $${available.toFixed(4)}. (Max Lev: ${maxExchangeLeverage}x)`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Set Leverage first
      await bitgetClient.setLeverage(symbol, finalLeverage);

      // 5. Execute Market Order
      const side: 'buy' | 'sell' = decision.decision === TradeAction.LONG ? 'buy' : 'sell';
      
      const orderResponse = await bitgetClient.placeOrder({
        symbol: symbol,
        side: side,
        orderType: 'market',
        size: quantityStr
      });

      const orderId = orderResponse.data.orderId;
      logger.info({ orderId, leverage: finalLeverage }, 'Order executed successfully on Bitget V2');

      // 6. Automated SL/TP (Plan Orders)
      try {
        let slPercent = 0.015; 
        let tpPercent = 0.025; 

        const strategy = env.TRADING_STRATEGY;
        if (strategy === 'SWING') {
          slPercent = 0.03;
          tpPercent = 0.10;
        }

        const slPrice = side === 'buy' ? price * (1 - slPercent) : price * (1 + slPercent);
        const tpPrice = side === 'buy' ? price * (1 + tpPercent) : price * (1 - tpPercent);

        logger.info({ slPrice: slPrice.toFixed(pricePrecision), tpPrice: tpPrice.toFixed(pricePrecision) }, 'Placing Bitget V2 SL/TP...');

        // Place Stop Loss Plan
        await bitgetClient.placePlanOrder({
          symbol,
          side: side === 'buy' ? 'sell' : 'buy', // Exit side
          orderType: 'market',
          size: quantityStr,
          triggerPrice: slPrice.toFixed(pricePrecision),
          triggerType: 'mark_price'
        });

        // Place Take Profit Plan
        await bitgetClient.placePlanOrder({
          symbol,
          side: side === 'buy' ? 'sell' : 'buy', // Exit side
          orderType: 'market',
          size: quantityStr,
          triggerPrice: tpPrice.toFixed(pricePrecision),
          triggerType: 'mark_price'
        });

        logger.info('Bitget V2 SL/TP orders active.');
      } catch (planError: any) {
        logger.warn({ error: planError.message }, 'Failed to place SL/TP Plan orders.');
      }
      
      return { orderId, status: 'FILLED', price };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Bitget V2 Execution Failed');
      throw error;
    }
  }
}

export const orderExecutor = new OrderExecutor();
