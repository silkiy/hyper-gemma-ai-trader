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
      
      // SAFETY FLOOR: Ensure notional is large enough for SL/TP placement
      const minBitgetNotional = Math.max(symbolInfo.minTradeUSDT, env.MIN_TPSL_NOTIONAL, 5.5); 

      // 3. AUTO-LEVERAGE OPTIMIZATION & NOTIONAL SIZING
      const available = accountStatus.available_balance || 0;
      
      // TARGET_NOTIONAL = max(SAFETY_FLOOR, available_balance * MAX_TRADE_ALLOCATION)
      const maxTradeAllocation = env.MAX_TRADE_ALLOCATION; 
      const targetNotional = Math.max(minBitgetNotional, available * maxTradeAllocation);

      // Calculate minimum leverage needed to afford this targetNotional
      const minNeededLeverage = Math.ceil(targetNotional / (available * 0.98)); 
      
      // Use maximum possible leverage (capped by exchange) to minimize margin blocked
      let finalLeverage = Math.max(decision.leverage_suggestion, minNeededLeverage);
      if (finalLeverage > maxExchangeLeverage) finalLeverage = maxExchangeLeverage;

      // Final Affordability Check
      const marginUsed = targetNotional / finalLeverage;
      const safeAvailable = available * 0.98; // 2% for safety/fees

      if (marginUsed > safeAvailable) {
        const errorMsg = `CANNOT AFFORD ${symbol}: Needs $${marginUsed.toFixed(4)} margin (Notional: $${targetNotional.toFixed(2)}), have $${available.toFixed(4)}. (Max Lev: ${maxExchangeLeverage}x)`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // 4. Calculate Quantity based on TARGET_NOTIONAL
      const rawQuantity = targetNotional / price;
      const multiplier = Math.pow(10, precision);
      const quantityStr = (Math.ceil(rawQuantity * multiplier) / multiplier).toFixed(precision);

      logger.info({ 
        symbol, 
        targetNotional: `$${targetNotional.toFixed(2)}`,
        marginUsed: `$${marginUsed.toFixed(4)}`,
        finalLeverage: `${finalLeverage}x`,
        qty: quantityStr
      }, 'Order Sizing Calculated');

      // Set Leverage first
      await bitgetClient.setLeverage(symbol, finalLeverage);

      // 5. Calculate SL/TP Prices BEFORE opening position
      let slPercent = 0.015; 
      let tpPercent = 0.025; 

      const strategy = env.TRADING_STRATEGY;
      if (strategy === 'SWING') {
        slPercent = 0.03;
        tpPercent = 0.10;
      }

      const side: 'buy' | 'sell' = decision.decision === TradeAction.LONG ? 'buy' : 'sell';
      const slPrice = side === 'buy' ? price * (1 - slPercent) : price * (1 + slPercent);
      const tpPrice = side === 'buy' ? price * (1 + tpPercent) : price * (1 - tpPercent);

      logger.info({ 
        symbol, 
        sl: slPrice.toFixed(pricePrecision), 
        tp: tpPrice.toFixed(pricePrecision) 
      }, 'Calculating ATOMIC SL/TP prices...');

      // 6. Execute ATOMIC Market Order with PRESET SL/TP
      const orderResponse = await bitgetClient.placeOrder({
        symbol: symbol,
        side: side,
        orderType: 'market',
        size: quantityStr,
        presetStopLossPrice: slPrice.toFixed(pricePrecision),
        presetTakeProfitPrice: tpPrice.toFixed(pricePrecision)
      });

      const orderId = orderResponse.data.orderId;
      logger.info({ orderId, leverage: finalLeverage }, 'Order executed ATOMICALLY with SL/TP on Bitget V2');
      
      return { orderId, status: 'FILLED', price };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Bitget V2 Execution Failed');
      throw error;
    }
  }
}

export const orderExecutor = new OrderExecutor();
