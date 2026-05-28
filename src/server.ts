import 'dotenv/config';
import { connectMongo } from './database/mongo.js';
import { logger } from './utils/logger.js';
import { decisionEngine } from './core/ai/decision-engine.js';
import { TradeAction, SessionMode, TradingStrategy } from './types/enum.types.js';
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

async function runMarketScan(mode: SessionMode) {
  try {
    // 1. Check Account & Risk Status
    const accountStatus = await marketDataProvider.getAccountStatus();
    const dummyDecision = { decision: TradeAction.SKIP, final_summary: 'PRE_SCAN_CHECK' } as any;
    const riskValidation = riskManager.validateDecision(dummyDecision, accountStatus, mode);
    
    // 2. If Blocked (Max positions or safety risk), show portfolio and exit scan
    if (riskValidation.decision === TradeAction.SKIP && riskValidation.final_summary?.startsWith('Blocked:')) {
      logger.info({ reason: riskValidation.final_summary }, 'Scan skipped: Risk manager block active.');
      await displayPortfolioSnapshot(accountStatus);
      return false; // Indicating scan didn't complete due to block
    }

    // 3. Scan Exchange
    logger.info(`--- ${env.TRADING_STRATEGY} MARKET SCAN START ---`);
    
    // Fetch all tickers to filter by activity
    const allTickers = await asterdexClient.getAllTickers();
    
    // For Scalping, we only focus on High Velocity coins. 
    // For Intraday/Swing, we scan everything but still sort by volume.
    const hotPairs = env.TRADING_STRATEGY === TradingStrategy.SCALPING
      ? allTickers
          .filter(t => {
            const change = Math.abs(parseFloat(t.priceChangePercent || '0'));
            const volume = parseFloat(t.volume || '0');
            return change > 2.0 || volume > 1000000;
          })
          .sort((a, b) => parseFloat(b.volume || '0') - parseFloat(a.volume || '0'))
          .map(t => t.symbol)
      : allTickers
          .sort((a, b) => parseFloat(b.volume || '0') - parseFloat(a.volume || '0'))
          .map(t => t.symbol);

    logger.info({ totalToScan: hotPairs.length }, `Scanning ${env.TRADING_STRATEGY} opportunities...`);
    
    for (const pair of hotPairs) {
      try {
        const decision = await decisionEngine.evaluateTrade(pair, mode);
        
        if (decision.decision !== 'SKIP' && decision.decision !== 'WAIT') {
          logger.info({ pair, decision: decision.decision }, 'Opportunity found! Executing...');
          const execution = await tradeService.handleTradeDecision(decision, pair);

          if (execution) {
            logger.info(`--- ${env.TRADING_STRATEGY} MARKET SCAN END (TRADE EXECUTED) ---`);
            return true; 
          }
        }
        
        // Micro-delay between pairs
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error({ pair, error }, 'Evaluation failed for pair');
      }
    }
    
    logger.info(`--- ${env.TRADING_STRATEGY} MARKET SCAN END ---`);
    return true;

  } catch (error) {
    logger.error({ error }, 'Market scan error');
    return false;
  }
}

async function startInfiniteLoop(mode: SessionMode) {
  logger.info('🚀 TRADING ENGINE: INFINITE SCAN MODE ENABLED (SCALPING)');
  while (true) {
    await runMarketScan(mode);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function startScheduledTasks(mode: SessionMode) {
  const strategy = env.TRADING_STRATEGY;
  const interval = strategy === TradingStrategy.INTRADAY ? '*/15 * * * *' : '0 * * * *'; // 15m for Intraday, 1h for Swing
  
  logger.info({ strategy, schedule: strategy === TradingStrategy.INTRADAY ? 'Every 15 mins' : 'Every 1 hour' }, '🚀 TRADING ENGINE: SCHEDULED MODE ENABLED');
  
  // Initial scan on startup
  await runMarketScan(mode);

  cron.schedule(interval, async () => {
    await runMarketScan(mode);
  });
}

async function bootstrap() {
  logger.info('Starting Hyper-Gemma AI Trader Service (FULL AUTONOMY MODE)');
  await connectMongo();
  await startMonitoringApi();
  const currentMode = SessionMode.NORMAL;
  await sessionService.startNewSession(currentMode);

  // Strategy-based engine selection
  if (env.TRADING_STRATEGY === TradingStrategy.SCALPING) {
    startInfiniteLoop(currentMode).catch(err => logger.fatal({ err }, 'Infinite loop fatal error'));
  } else {
    startScheduledTasks(currentMode).catch(err => logger.error({ err }, 'Scheduled engine error'));
  }

  // Common background jobs
  cron.schedule('0 0 * * *', async () => {
    await runMemoryConsolidation();
  });

  logger.info({ strategy: env.TRADING_STRATEGY }, 'System initialized and ready.');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to bootstrap application');
  process.exit(1);
});
