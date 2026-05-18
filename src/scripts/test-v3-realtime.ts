import 'dotenv/config';
import { asterdexClient } from '../exchange/asterdex.client.js';
import { logger } from '../utils/logger.js';

async function testRealtimePrice() {
  const symbol = 'BTCUSDT';
  logger.info({ symbol }, 'Fetching real-time price from ASTERDEX V3...');
  
  try {
    const klines = await asterdexClient.getCandles(symbol, '1m', 1);
    if (klines && klines.length > 0) {
      const lastPrice = klines[0][4];
      const time = new Date(klines[0][0]).toLocaleString();
      logger.info(`✅ SUCCESS! [${time}] BTC Price: $${lastPrice}`);
    } else {
      logger.warn('No kline data received.');
    }
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Failed to fetch real-time price');
  }
}

testRealtimePrice();
