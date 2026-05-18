import { asterdexClient } from './asterdex.client.js';
import type { AIDecision } from '../types/ai.types.js';
import { logger } from '../utils/logger.js';
import { TradeAction } from '../types/enum.types.js';
import { marketDataProvider } from './market-data.provider.js';

export class OrderExecutor {
  private readonly MIN_NOTIONAL = 5.1; // $5.1 to be safe against exchange min $5

  async executeOrder(decision: AIDecision, symbol: string): Promise<{ orderId: string; status: string }> {
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

      // 3. Calculate Quantity to meet MIN_NOTIONAL ($5)
      // Fetch precision for the symbol
      const precision = await asterdexClient.getSymbolPrecision(symbol);
      
      const rawQuantity = this.MIN_NOTIONAL / price;
      
      // Use Math.ceil with precision to ensure we are ALWAYS >= MIN_NOTIONAL
      const multiplier = Math.pow(10, precision);
      const quantity = (Math.ceil(rawQuantity * multiplier) / multiplier).toFixed(precision);
      
      // Map TradeAction to Side
      const side = decision.decision === TradeAction.LONG ? 'BUY' : 'SELL';
      
      logger.info({ 
        targetNotional: this.MIN_NOTIONAL, 
        calcQuantity: quantity, 
        price,
        estimatedMargin: (this.MIN_NOTIONAL / decision.leverage_suggestion).toFixed(4)
      }, 'Order calculation complete');

      const order = await asterdexClient.placeOrder({
        symbol: symbol,
        side: side,
        type: 'MARKET',
        quantity: quantity,
        leverage: decision.leverage_suggestion
      });

      const orderId = order.orderId || `aster-pro-${Math.random().toString(36).substr(2, 9)}`;
      logger.info({ orderId }, 'Order executed successfully on ASTERDEX Pro API');
      
      return { orderId, status: 'FILLED' };
    } catch (error) {
      logger.error({ error }, 'Failed to execute order on ASTERDEX Pro API');
      throw error;
    }
  }
}

export const orderExecutor = new OrderExecutor();
