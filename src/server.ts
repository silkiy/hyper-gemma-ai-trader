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
import type { AccountStatus } from './types/market.types.js';
import cron from 'node-cron';

async function displayPortfolioSnapshot(status?: AccountStatus) {
  try {
    const accountStatus = status || await marketDataProvider.getAccountStatus();
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

async function startTradingEngine(mode: SessionMode) {
  logger.info('🚀 TRADING ENGINE STARTED (INFINITE SCAN MODE)');
  
  while (true) {
    try {
      // 1. Check Account & Risk Status
      const accountStatus = await marketDataProvider.getAccountStatus();
      const dummyDecision = { decision: TradeAction.SKIP, final_summary: 'PRE_SCAN_CHECK' } as any;
      const riskValidation = riskManager.validateDecision(dummyDecision, accountStatus, mode);
      
      // 2. If Blocked (Max positions or safety risk), show portfolio and wait
      if (riskValidation.decision === TradeAction.SKIP && riskValidation.final_summary?.startsWith('Blocked:')) {
        logger.info({ reason: riskValidation.final_summary }, 'Scanning paused: Risk manager block active.');
        await displayPortfolioSnapshot(accountStatus);
        
        // Wait 10 seconds before re-checking (don't spam API when blocked)
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      // 3. Scan Exchange
      logger.info('--- CONTINUOUS MARKET SCAN START ---');
      // Fetch all tickers to filter by activity
      const allTickers = await asterdexClient.getAllTickers();
      
      // Filter: Only coins with > 2% move in 24h OR high volume spike
      // This ensures we only call AI for coins that are actually "moving"
      const hotPairs = allTickers
        .filter(t => {
          const change = Math.abs(parseFloat(t.priceChangePercent || '0'));
          const volume = parseFloat(t.volume || '0');
          return change > 2.0 || volume > 1000000; // Adjust thresholds as needed
        })
        .sort((a, b) => parseFloat(b.volume || '0') - parseFloat(a.volume || '0'))
        .map(t => t.symbol);

      logger.info({ totalHot: hotPairs.length }, 'Scanning high-velocity coins only...');
      
      for (const pair of hotPairs) {
        try {
          // Check if position was opened by previous pair in this loop
          // (Brief check to avoid unnecessary AI calls if limit reached mid-scan)
          
          const decision = await decisionEngine.evaluateTrade(pair, mode);
          
          if (decision.decision !== 'SKIP' && decision.decision !== 'WAIT') {
            logger.info({ pair, decision: decision.decision }, 'Opportunity found! Executing...');
            const execution = await tradeService.handleTradeDecision(decision, pair);

            // Only exit the symbol loop if the trade was actually successful.
            // If it failed (e.g., insufficient margin), continue scanning the next coin.
            if (execution) {
              break; 
            }
          }
          // Small micro-delay between pairs to be API friendly
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error({ pair, error }, 'Evaluation failed for pair');
        }
      }
      
      logger.info('--- CONTINUOUS MARKET SCAN END ---');
      
      // Brief pause between full market scans
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      logger.error({ error }, 'Trading engine loop error');
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s on crash
    }
  }
}

async function bootstrap() {
  logger.info('Starting Hyper-Gemma AI Trader Service (FULL AUTONOMY MODE)');
  await connectMongo();
  await startMonitoringApi();
  const currentMode = SessionMode.NORMAL;
  await sessionService.startNewSession(currentMode);

  // Start the infinite trading engine
  startTradingEngine(currentMode).catch(err => logger.fatal({ err }, 'Trading engine fatal error'));

  // Schedule background jobs
  cron.schedule('0 0 * * *', async () => {
    await runMemoryConsolidation();
  });

  logger.info('System initialized. Mode: Continuous Infinite Scan.');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to bootstrap application');
  process.exit(1);
});
