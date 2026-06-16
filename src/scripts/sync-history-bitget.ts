import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { tradeRepository } from '../database/repositories/trade.repository.js';
import { bitgetClient } from '../exchange/bitget.client.js';
import { TradeResult } from '../types/enum.types.js';

async function syncHistory() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected.');

  console.log('Fetching recent trades from MongoDB...');
  const recentTrades = await tradeRepository.findRecent(50);
  console.log(`Found ${recentTrades.length} recent trades in DB.`);

  for (const trade of recentTrades) {
    try {
      console.log(`\nSyncing ${trade.pair} (DB Entry: ${trade.entry_price}, Action: ${trade.action})...`);
      
      // Fetch historical orders from Bitget
      const historyFills = await bitgetClient.getFillHistory(trade.pair, 50);
      
      if (!historyFills || historyFills.length === 0) {
        console.log(`  No fill history found for ${trade.pair} on Bitget.`);
        continue;
      }

      // Filter to find the close fill that happened after this trade was opened
      // Since we don't have exact order IDs mapped perfectly in DB, we use time approximation
      const tradeTimeMs = new Date(trade.created_at).getTime();
      
      const relatedFills = historyFills.filter((f: any) => parseFloat(f.cTime) >= tradeTimeMs - 60000); // within 1 min
      
      const closeFills = relatedFills.filter((f: any) => f.tradeSide === 'close');
      
      if (closeFills.length > 0) {
        // Group by orderId to get the exact one
        const lastCloseFill = closeFills[0]; 
        const matchedOrderId = lastCloseFill.orderId;
        
        const allCloseParts = closeFills.filter((f: any) => f.orderId === matchedOrderId);
        
        let totalGrossPnl = 0;
        let totalFee = 0;
        let exitPriceAvg = parseFloat(lastCloseFill.price); // Approximation if multiple fills
        
        for (const f of allCloseParts) {
          totalGrossPnl += parseFloat(f.profit || '0');
          totalFee += parseFloat(f.fee || '0');
        }
        
        const netPnl = totalGrossPnl + totalFee;
        const result = netPnl >= 0 ? TradeResult.WIN : TradeResult.LOSS;
        
        console.log(`  Bitget Found -> Gross PnL: $${totalGrossPnl.toFixed(4)}, Fees: $${totalFee.toFixed(4)}`);
        console.log(`  Updating DB -> Net PnL: $${netPnl.toFixed(4)} | Result: ${result} | Exit Price: ${exitPriceAvg}`);
        
        await tradeRepository.update((trade._id as any).toString(), {
          exit_price: exitPriceAvg,
          profit_loss: netPnl,
          result: result
        });
      } else {
        console.log(`  No close fill found after trade open time. Skip.`);
      }
    } catch (e: any) {
      console.error(`  Error syncing ${trade.pair}: ${e.message}`);
    }
  }

  console.log('\nSync complete. Disconnecting...');
  await mongoose.disconnect();
}

syncHistory();
