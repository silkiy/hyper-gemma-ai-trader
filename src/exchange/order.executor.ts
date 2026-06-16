import { bitgetClient } from './bitget.client.js';
import type { AIDecision } from '../types/ai.types.js';
import { logger } from '../utils/logger.js';
import { TradeAction } from '../types/enum.types.js';
import { marketDataProvider } from './market-data.provider.js';
import { env } from '../config/env.js';

export class OrderExecutor {
  private readonly MIN_NOTIONAL = 5.1; 

  async executeOrder(decision: AIDecision, symbol: string): Promise<{ orderId: string; status: string; price: number; leverage: number }> {
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
      // Absolute minimum for Bitget V2 is ~5 USDT
      const minBitgetNotional = Math.max(symbolInfo.minTradeUSDT, env.MIN_TPSL_NOTIONAL, 5.1); 

      // 3. AUTO-LEVERAGE OPTIMIZATION & NOTIONAL SIZING
      const available = accountStatus.available_balance || 0;
      
      // TARGET_NOTIONAL = max(SAFETY_FLOOR, available_balance * MAX_TRADE_ALLOCATION)
      const maxTradeAllocation = env.MAX_TRADE_ALLOCATION; 
      const targetNotional = Math.max(minBitgetNotional, available * maxTradeAllocation);

      // Calculate minimum leverage needed to afford this targetNotional
      const minNeededLeverage = Math.ceil(targetNotional / (available * 0.98)); 
      
      // HARD LEVERAGE CAP: Never exceed 25x regardless of what AI/directive says
      const hardLeverageCap = 25;
      let finalLeverage = Math.max(Math.min(decision.leverage_suggestion, hardLeverageCap), minNeededLeverage);
      if (finalLeverage > maxExchangeLeverage) finalLeverage = maxExchangeLeverage;

      // If even after max exchange leverage we can't afford, reject
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

      // 5. ATR-BASED DYNAMIC SL/TP (replaces static percentages)
      // Extract ATR from decision if available (passed from quant engine)
      const atrValue = (decision as any).atr || 0;
      let slPercent: number;
      let tpPercent: number;

      if (atrValue > 0) {
        // Dynamic: SL = 1.5x ATR, TP = 2.5x ATR (as percentage of price)
        const atrPct = atrValue / price;
        slPercent = Math.max(atrPct * 1.5, 0.005); // Floor: 0.5% minimum SL
        tpPercent = Math.max(atrPct * 2.5, 0.010); // Floor: 1.0% minimum TP

        // Cap maximums to prevent unreasonable values
        slPercent = Math.min(slPercent, 0.05); // Max 5% SL
        tpPercent = Math.min(tpPercent, 0.15); // Max 15% TP
      } else {
        // Fallback static values per strategy
        const strategy = env.TRADING_STRATEGY;
        if (strategy === 'SWING') {
          slPercent = 0.03;
          tpPercent = 0.10;
        } else {
          slPercent = 0.015;
          tpPercent = 0.025;
        }
      }

      // Safety: Check if SL is too tight for the leverage (would liquidate instantly)
      const slDollar = targetNotional * slPercent;
      if (slDollar < 0.01) {
        logger.warn({ symbol, slPercent: `${(slPercent*100).toFixed(2)}%`, slDollar: `$${slDollar.toFixed(4)}` }, 
          '[SL TOO TIGHT] Skip — SL distance too small for meaningful trade');
        throw new Error(`SL too tight for ${symbol}: $${slDollar.toFixed(4)} (${(slPercent*100).toFixed(2)}%)`);
      }

      logger.info({ 
        symbol, 
        slPct: `${(slPercent*100).toFixed(2)}%`,
        tpPct: `${(tpPercent*100).toFixed(2)}%`,
        atr: atrValue > 0 ? atrValue.toFixed(6) : 'N/A (static fallback)'
      }, 'Dynamic SL/TP Calculated');

      const side: 'buy' | 'sell' = decision.decision === TradeAction.LONG ? 'buy' : 'sell';
      
      // Engineering Hardening: Add 0.01% slippage tolerance to SL/TP calculations
      const slippageBuffer = 0.0001; 
      const adjustedPrice = side === 'buy' ? price * (1 - slippageBuffer) : price * (1 + slippageBuffer);

      const slPrice = side === 'buy' ? adjustedPrice * (1 - slPercent) : adjustedPrice * (1 + slPercent);
      const tpPrice = side === 'buy' ? adjustedPrice * (1 + tpPercent) : adjustedPrice * (1 - tpPercent);

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

      // 7. Data Integrity Hardening: Fetch ACTUAL execution price from fills (with retry)
      let executionPrice = price; // Fallback to market price
      const MAX_FILL_RETRIES = 3;
      const FILL_RETRY_DELAY = 1500; // 1.5 seconds between retries

      for (let attempt = 1; attempt <= MAX_FILL_RETRIES; attempt++) {
        try {
          await new Promise(resolve => setTimeout(resolve, FILL_RETRY_DELAY));
          const fills = await bitgetClient.getFillHistory(symbol, 10);
          const orderFill = fills.find((f: any) => f.orderId === orderId);
          if (orderFill) {
            executionPrice = parseFloat(orderFill.price);
            logger.info({ orderId, actualPrice: executionPrice, attempt }, 'Confirmed actual execution price from Bitget');
            break; // Success, exit retry loop
          }
          if (attempt === MAX_FILL_RETRIES) {
            logger.warn({ orderId, attempts: MAX_FILL_RETRIES }, 'Fill not found after all retries. Using market price as entry.');
          }
        } catch (e: any) {
          logger.warn({ orderId, attempt, error: e.message }, 'Fill price fetch attempt failed');
        }
      }

      logger.info({ orderId, leverage: finalLeverage }, 'Order executed ATOMICALLY with SL/TP on Bitget V2');
      
      return { orderId, status: 'FILLED', price: executionPrice, leverage: finalLeverage };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Bitget V2 Execution Failed');
      throw error;
    }
  }
}

export const orderExecutor = new OrderExecutor();
