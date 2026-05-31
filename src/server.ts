import 'dotenv/config';
import { connectMongo } from './database/mongo.js';
import { logger } from './utils/logger.js';
import { decisionEngine } from './core/ai/decision-engine.js';
import { TradeAction, SessionMode, TradingStrategy } from './types/enum.types.js';
import { riskManager } from './core/risk/risk-manager.js';
import { startMonitoringApi } from './api/monitoring-api.js';
import { tradeService } from './services/trade.service.js';
import { runMemoryConsolidation } from './jobs/memory-consolidation.job.js';
import { bitgetClient } from './exchange/bitget.client.js';
import { marketDataProvider } from './exchange/market-data.provider.js';
import { sessionService } from './services/session.service.js';
import { quantEngine } from './core/quant/quant-engine.js';
import { strategyGovernor } from './core/ai/strategy-governor.js';
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

          const entryPriceFormatted = entryPrice < 0.01 ? entryPrice.toFixed(7) : (entryPrice < 1 ? entryPrice.toFixed(4) : entryPrice.toFixed(2));
          const markPriceFormatted = markPrice < 0.01 ? markPrice.toFixed(7) : (markPrice < 1 ? markPrice.toFixed(4) : markPrice.toFixed(2));
          const liqPriceFormatted = liqPrice < 0.01 ? liqPrice.toFixed(7) : (liqPrice < 1 ? liqPrice.toFixed(4) : liqPrice.toFixed(2));

          return {
            symbol: p.symbol,
            side: size > 0 ? 'LONG' : (size < 0 ? 'SHORT' : 'CLOSED'),
            size: size.toString(),
            entryPrice: entryPriceFormatted,
            markPrice: markPriceFormatted,
            liqPrice: liqPriceFormatted,
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

async function runHybridTradingLoop(mode: SessionMode) {
  logger.info('🚀 HYBRID TACTICAL ENGINE STARTED');
  
  // 1. Initial Strategy Refresh
  await strategyGovernor.refreshDirective();

  // 2. High-Speed Loop with Tactical AI Confirmation
  while (true) {
    try {
      const accountStatus = await marketDataProvider.getAccountStatus();
      
      // Check for safety blocks (Max positions or Critical Safety)
      const dummyDecision = { decision: TradeAction.SKIP, final_summary: 'PRE_SCAN_CHECK' } as any;
      const riskValidation = riskManager.validateDecision(dummyDecision, accountStatus, mode);
      
      if (riskValidation.decision === TradeAction.SKIP && riskValidation.final_summary?.startsWith('Blocked: Safety')) {
        await displayPortfolioSnapshot(accountStatus);
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      const allTickers = await bitgetClient.getAllTickers();
      
      const majorPairs = [
        'BTCUSDT', 'ETHUSDT', 'ASTERUSDT', 'BNBUSDT', 'XRPUSDT', 
        'ZECUSDT', 'XLMUSDT', 'SUIUSDT', 'TONUSDT', 'BCHUSDT',
        'LINKUSDT', 'ADAUSDT', 'AVAXUSDT', 'LTCUSDT', 'TRXUSDT', 'ETCUSDT',
        'HYPEUSDT'
      ];

      let hotPairs: string[] = [];

      if (env.SCAN_MODE === 'VIP') {
        hotPairs = allTickers
          .filter((t: any) => majorPairs.includes(t.symbol))
          .map((t: any) => t.symbol);
      } else if (env.SCAN_MODE === 'ALL') {
        hotPairs = allTickers.map((t: any) => t.symbol);
      } else {
        // Default: HOT50 (Top 50 by volume)
        hotPairs = allTickers
          .sort((a: any, b: any) => parseFloat(b.volume || '0') - parseFloat(a.volume || '0'))
          .slice(0, 50)
          .map((t: any) => t.symbol);
      }

      const interval = env.TRADING_STRATEGY === TradingStrategy.INTRADAY ? '15m' : '5m';

      for (const pair of hotPairs) {
        try {
          // Get full OHLCV history for Trinity analysis (100 candles)
          const ohlcv = await quantEngine.getOHLCVHistory(pair, interval, 100);
          
          // 1. MATH SENSOR (Trinity: Z + Hurst + VWAP)
          const { decision: quantDecision, zScore, threshold, hurst } = await quantEngine.evaluateHighSpeed(pair, ohlcv);
          
          // Real-time Pulse Log (Trinity View)
          const thresholdSymbol = zScore < 0 ? `-${threshold.toFixed(2)}` : `+${threshold.toFixed(2)}`;
          const regime = hurst >= (env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 0.5 : 0.6) ? 'TRND' : 'RNG';
          process.stdout.write(`\r[PULSE] ${pair} | Z: ${zScore.toFixed(2)} (${thresholdSymbol}) | H: ${hurst.toFixed(2)} [${regime}]      `);

          if (quantDecision) {
            console.log(''); // Clear pulse line
            logger.info({ pair, zScore: zScore.toFixed(2), hurst: hurst.toFixed(2), regime }, '🎯 TRINITY SENSOR HIT!');
            
            // 2. AI SNIPER (Gemma confirms the math signal)
            const tacticalDecision = await decisionEngine.evaluateTrade(pair, mode);
            
            if (tacticalDecision.decision !== 'SKIP' && tacticalDecision.decision !== 'WAIT') {
              logger.info({ pair }, '⚡ TACTICAL STRIKE: Gemma confirmed! Executing trade...');
              const execution = await tradeService.handleTradeDecision(tacticalDecision, pair);
              if (execution) {
                console.log(''); // Clear pulse line
                break; 
              }
            } else {
              logger.info({ pair, reason: tacticalDecision.final_summary }, '❌ TACTICAL VETO: Gemma rejected the math signal.');
            }
          }
        } catch (e: any) {
          // Log the error softly so we know if a coin is failing silently
          // process.stdout.write(`\r[QUANT PULSE] Error on ${pair}: ${e.message}      `);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      process.stdout.write(`\r[QUANT PULSE] Cycle complete. Waiting for next cycle...      `);

      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      logger.error({ error }, 'Tactical loop error');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function bootstrap() {
  logger.info('Starting Hyper-Gemma AI Trader (HYBRID TACTICAL MODE)');
  await connectMongo();
  await startMonitoringApi();
  const currentMode = SessionMode.NORMAL;
  await sessionService.startNewSession(currentMode);

  // Path 1: Strategy Governor (Every 1 hour Gemma wakes up)
  cron.schedule('0 * * * *', async () => {
    await strategyGovernor.refreshDirective();
  });

  // Path 2: Tactical Execution Engine
  runHybridTradingLoop(currentMode).catch(err => logger.fatal({ err }, 'Fatal Engine Error'));

  // Path 3: Background Jobs
  cron.schedule('0 0 * * *', async () => {
    await runMemoryConsolidation();
  });

  logger.info('System fully operational in Hybrid Mode.');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to bootstrap application');
  process.exit(1);
});
