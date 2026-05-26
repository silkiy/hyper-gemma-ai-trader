import 'dotenv/config';
import { connectMongo } from './database/mongo.js';
import { logger } from './utils/logger.js';
import { decisionEngine } from './core/ai/decision-engine.js';
import { TradeAction, SessionMode } from './types/enum.types.js';
import { riskManager } from './core/risk/risk-manager.js';
import { startMonitoringApi } from './api/monitoring-api.js';
import { tradeService } from './services/trade.service.js';
import { runMemoryConsolidation } from './jobs/memory-consolidation.job.js';
import { asterdexClient } from './exchange/asterdex.client.js';
import { marketDataProvider } from './exchange/market-data.provider.js';
import { sessionService } from './services/session.service.js';
import { env } from './config/env.js';
import cron from 'node-cron';

let lastScanTimestamp = 0;

async function runTradeScan(mode: SessionMode) {
  // Prevent redundant scans if called too close together (e.g. startup vs cron)
  const now = Date.now();
  if (now - lastScanTimestamp < 60000) { // 1 minute cooldown
    return;
  }
  lastScanTimestamp = now;

  logger.info('--- FULL MARKET Scan Start ---');
  
  try {
    // 0. Preliminary Account Check
    const accountStatus = await marketDataProvider.getAccountStatus();
    const activePositions = accountStatus.open_positions || [];
    
    // 0.1 Check for blocks (Max positions or Safety risk)
    const dummyDecision = { decision: TradeAction.SKIP } as any;
    const preScanValidation = riskManager.validateDecision(dummyDecision, accountStatus, mode);
    
    if (preScanValidation.decision === TradeAction.SKIP && preScanValidation.final_summary?.startsWith('Blocked:')) {
      logger.info({ 
        reason: preScanValidation.final_summary,
        activeCount: activePositions.length
      }, 'Scan skipped: Risk manager issued a block.');
      
      if (activePositions.length > 0) {
        logger.info({ 
          activePositions: activePositions.map(p => {
            const size = parseFloat(p.positionAmt || p.size || '0');
            const entryPrice = parseFloat(p.entryPrice || '0');
            const markPrice = parseFloat(p.markPrice || '0');
            const leverage = parseFloat(p.leverage || '1');
            const pnl = parseFloat(p.unRealizedProfit || p.unrealizedProfit || p.pnl || '0');
            const liqPrice = parseFloat(p.liquidationPrice || '0');
            const margin = leverage > 0 ? (Math.abs(size) * entryPrice) / leverage : 0;
            const roe = margin > 0 ? (pnl / margin) * 100 : 0;

            return {
              symbol: p.symbol,
              side: size > 0 ? 'LONG' : (size < 0 ? 'SHORT' : 'CLOSED'),
              size: size.toString(),
              entryPrice: entryPrice.toFixed(entryPrice < 1 ? 4 : 2),
              markPrice: markPrice.toFixed(markPrice < 1 ? 4 : 2),
              liqPrice: liqPrice.toFixed(liqPrice < 1 ? 4 : 2),
              margin: `$${margin.toFixed(4)}`,
              pnl: `$${pnl.toFixed(4)}`,
              roe: `${roe.toFixed(2)}%`
            };
          })
        }, '💰 PORTFOLIO SNAPSHOT');
      }
      
      logger.info('--- FULL MARKET Scan End ---');
      return;
    }

    // 1. Fetch all available trading pairs dynamically
    const allPairs = await asterdexClient.getAllSymbols();
    logger.info({ totalPairs: allPairs.length }, 'Scanning entire exchange...');
    
    for (const pair of allPairs) {
      try {
        logger.info({ pair }, 'Evaluating opportunity...');
        const decision = await decisionEngine.evaluateTrade(pair, mode);
        
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

  } catch (error) {
    logger.error({ error }, 'Main scan loop error');
  }
  
  logger.info('--- FULL MARKET Scan End ---');
}

async function bootstrap() {
  logger.info('Starting Hyper-Gemma AI Trader Service (FULL AUTONOMY MODE)');

  // 1. Connect to Database
  await connectMongo();

  // 2. Start Monitoring API
  await startMonitoringApi();

  // 3. Initialize Session
  const currentMode = SessionMode.NORMAL;
  await sessionService.startNewSession(currentMode);

  logger.info('System initialized. Triggering immediate scan...');
  
  // Trigger scan immediately on startup
  runTradeScan(currentMode).catch(err => logger.error({ err }, 'Initial scan failed'));

  // 4. Schedule Trading Job (Every 5 minutes)
  cron.schedule('*/5 * * * *', async () => {
    await runTradeScan(currentMode);
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
