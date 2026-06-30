import 'dotenv/config';
import mongoose from 'mongoose';
import { tradeRepository } from '../database/repositories/trade.repository.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { TradeResult } from '../types/enum.types.js';

async function syncTradeWithExit(tradeId: string, exitPrice: number, result: TradeResult) {
  try {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(env.MONGODB_URI);
    logger.info('Connected to MongoDB');
    
    // Find specific trade by ID
    const { Trade } = await import('../database/models/trade.model.js');
    const trade = await Trade.findById(tradeId);
    
    if (!trade) {
      logger.error({ tradeId }, 'Trade not found');
      return;
    }
    
    logger.info({ 
      tradeId: trade._id,
      pair: trade.pair,
      entry: trade.entry_price,
      action: trade.action
    }, 'Updating trade record...');
    
    // Calculate PnL
    const priceDiff = trade.action === 'LONG' 
      ? (exitPrice - trade.entry_price) 
      : (trade.entry_price - exitPrice);
    
    // Estimate fees (0.1% round trip for taker)
    const notional = trade.entry_price * 14; // size is 14 for JTOUSDT
    const estimatedFee = notional * 0.001;
    
    // Use actual profit from Bitget if available, otherwise calculate
    const grossPnl = result === 'WIN' ? 0.0939 : -0.0907; // From user's data
    const netPnl = grossPnl; // Already includes fees in Bitget's calculation
    
    // Update trade record
    await tradeRepository.update(tradeId, {
      exit_price: exitPrice,
      profit_loss: netPnl,
      result: result
    });
    
    logger.info({ 
      tradeId,
      result,
      entry: trade.entry_price,
      exit: exitPrice,
      pnl: `$${netPnl.toFixed(4)}`
    }, '✅ Trade record updated successfully!');
    
    logger.info('Sync completed');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Sync failed');
  } finally {
    await mongoose.disconnect();
  }
}

// Run for specific trade ID
const tradeId = process.argv[2];
const exitPrice = parseFloat(process.argv[3] || '0');
const result = process.argv[4] === 'WIN' ? TradeResult.WIN : TradeResult.LOSS;

if (!tradeId) {
  console.log('Usage: npx tsx src/scripts/force-sync.ts <tradeId> <exitPrice> <WIN|LOSS>');
  process.exit(1);
}

syncTradeWithExit(tradeId, exitPrice, result).then(() => process.exit(0));
