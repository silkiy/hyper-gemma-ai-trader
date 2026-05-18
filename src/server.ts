import 'dotenv/config';
import { connectMongo } from './database/mongo.js';
import { logger } from './utils/logger.js';
import { decisionEngine } from './core/ai/decision-engine.js';
import { SessionMode } from './types/enum.types.js';
import { startMonitoringApi } from './api/monitoring-api.js';
import { tradeService } from './services/trade.service.js';
import { runMemoryConsolidation } from './jobs/memory-consolidation.job.js';
import { asterdexClient } from './exchange/asterdex.client.js';
import { marketDataProvider } from './exchange/market-data.provider.js';
import cron from 'node-cron';

async function bootstrap() {
  logger.info('Starting Hyper-Gemma AI Trader Service (FULL AUTONOMY MODE)');

  // 1. Connect to Database
  await connectMongo();

  // 2. Start Monitoring API
  await startMonitoringApi();

  // 3. Initialize Session
  const currentMode = SessionMode.NORMAL;
  
  logger.info('System initialized and ready for Full Market scanning');

  // 4. Schedule Trading Job (Every 5 minutes)
  cron.schedule('*/5 * * * *', async () => {
    logger.info('--- Scheduled FULL MARKET Scan Start ---');
    
    try {
      // Fetch all available trading pairs dynamically
      const allPairs = await asterdexClient.getAllSymbols();
      logger.info({ totalPairs: allPairs.length }, 'Scanning entire exchange...');
      
      for (const pair of allPairs) {
        try {
          logger.info({ pair }, 'Evaluating opportunity...');
          const decision = await decisionEngine.evaluateTrade(pair, currentMode);
          
          if (decision.decision !== 'SKIP' && decision.decision !== 'WAIT') {
            logger.info({ pair, decision: decision.decision }, 'Opportunity found! Executing...');
            await tradeService.handleTradeDecision(decision, pair);
            
            // Focus on 1 position at a time (max_concurrent_positions: 1)
            break; 
          }
        } catch (error) {
          logger.error({ pair, error }, 'Scan failed for pair');
        }
      }

      // Check and display active positions after scan
      const accountStatus = await marketDataProvider.getAccountStatus();
      if (accountStatus.open_positions && accountStatus.open_positions.length > 0) {
        logger.info({ 
          activePositions: accountStatus.open_positions.map(p => ({
            symbol: p.symbol,
            side: p.side,
            size: p.positionAmt || p.size,
            pnl: p.unrealizedProfit || p.pnl
          }))
        }, '💰 PORTFOLIO SNAPSHOT');
      } else {
        logger.info('No active positions at the moment.');
      }

    } catch (error) {
      logger.error({ error }, 'Main scan loop error');
    }
    
    logger.info('--- Scheduled FULL MARKET Scan End ---');
  });

  // 5. Schedule Memory Consolidation Job (Every day at midnight)
  cron.schedule('0 0 * * *', async () => {
    await runMemoryConsolidation();
  });

  logger.info('Jobs scheduled: Trading (5m), Memory Consolidation (Daily)');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to bootstrap application');
  process.exit(1);
});
