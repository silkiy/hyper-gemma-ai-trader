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

async function displayPortfolioSnapshot() {
  try {
    const accountStatus = await marketDataProvider.getAccountStatus();
    const activePositions = accountStatus.open_positions || [];

    logger.info({
      equity: `$${accountStatus.current_equity.toFixed(4)}`,
      availableBalance: `$${(accountStatus.available_balance ?? 0).toFixed(4)}`,
      marginBalance: `$${(accountStatus.margin_balance ?? 0).toFixed(4)}`,
    }, '📊 ACCOUNT SUMMARY');

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
    } else {
      logger.info('No active positions to display.');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to display portfolio snapshot');
  }
}

async function runTradeScan(mode: SessionMode) {
  const now = Date.now();
  if (now - lastScanTimestamp < 60000) return;
  lastScanTimestamp = now;

  logger.info('--- FULL MARKET Scan Start ---');
  
  try {
    const accountStatus = await marketDataProvider.getAccountStatus();
    const dummyDecision = { decision: TradeAction.SKIP } as any;
    const preScanValidation = riskManager.validateDecision(dummyDecision, accountStatus, mode);
    
    if (preScanValidation.decision === TradeAction.SKIP && preScanValidation.final_summary?.startsWith('Blocked:')) {
      logger.info({ reason: preScanValidation.final_summary }, 'Scan skipped: Risk manager issued a block.');
      await displayPortfolioSnapshot();
      logger.info('--- FULL MARKET Scan End ---');
      return;
    }

    const allPairs = await asterdexClient.getAllSymbols();
    logger.info({ totalPairs: allPairs.length }, 'Scanning entire exchange...');
    
    for (const pair of allPairs) {
      try {
        logger.info({ pair }, 'Evaluating opportunity...');
        const decision = await decisionEngine.evaluateTrade(pair, mode);
        
        if (decision.decision !== 'SKIP' && decision.decision !== 'WAIT') {
          logger.info({ pair, decision: decision.decision }, 'Opportunity found! Executing...');
          await tradeService.handleTradeDecision(decision, pair);
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
  await connectMongo();
  await startMonitoringApi();
  const currentMode = SessionMode.NORMAL;
  await sessionService.startNewSession(currentMode);

  logger.info('System initialized. Triggering immediate scan...');
  runTradeScan(currentMode).catch(err => logger.error({ err }, 'Initial scan failed'));

  // 1. Trading Job (Every 5 minutes)
  cron.schedule('*/5 * * * *', async () => {
    await runTradeScan(currentMode);
  });

  // 2. Memory Consolidation Job (Every day at midnight)
  cron.schedule('0 0 * * *', async () => {
    await runMemoryConsolidation();
  });

  logger.info('Jobs scheduled: Trading (5m), Portfolio Monitor (2m), Memory Consolidation (Daily)');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to bootstrap application');
  process.exit(1);
});
