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
import { tradeRepository } from './database/repositories/trade.repository.js';
import { symbolCooldown } from './core/risk/symbol-cooldown.js';
import { env } from './config/env.js';
import type { AccountStatus } from './types/market.types.js';
import cron from 'node-cron';

// In-memory tracker for Smart Breakeven (Trailing Stop)
const peakPnlMap = new Map<string, number>();

async function displayPortfolioSnapshot(status?: AccountStatus) {
  try {
    const accountStatus =
      status || (await marketDataProvider.getAccountStatus());
    const activePositions = accountStatus.open_positions || [];

    logger.info(
      {
        equity: `$${accountStatus.current_equity.toFixed(4)}`,
        availableBalance: `$${(accountStatus.available_balance ?? 0).toFixed(4)}`,
        marginBalance: `$${(accountStatus.margin_balance ?? 0).toFixed(4)}`,
      },
      "📊 ACCOUNT SUMMARY",
    );

    if (activePositions.length > 0) {
      logger.info({ 
        activePositions: activePositions.map(p => {
          const size = parseFloat(p.size || '0');
          const entryPrice = parseFloat(p.entryPrice || '0');
          const markPrice = parseFloat(p.markPrice || '0');
          const leverage = parseFloat(p.leverage || '1');
          const pnl = parseFloat(p.unRealizedProfit || '0');
          const liqPrice = parseFloat(p.liquidationPrice || '0');
          
          const margin = parseFloat(p.marginUsed || '0') || (leverage > 0 ? (Math.abs(size) * entryPrice) / leverage : 0);
          const roe = margin > 0 ? (pnl / margin) * 100 : 0;

          const entryPriceFormatted = entryPrice < 0.01 ? entryPrice.toFixed(7) : (entryPrice < 1 ? entryPrice.toFixed(4) : entryPrice.toFixed(2));
          const markPriceFormatted = markPrice < 0.01 ? markPrice.toFixed(7) : (markPrice < 1 ? markPrice.toFixed(4) : markPrice.toFixed(2));
          const liqPriceFormatted = liqPrice < 0.01 ? liqPrice.toFixed(7) : (liqPrice < 1 ? liqPrice.toFixed(4) : liqPrice.toFixed(2));

          let sideDisplay = 'NEUTRAL';
          if (p.holdSide) sideDisplay = p.holdSide.toUpperCase();
          else sideDisplay = size > 0 ? 'LONG' : (size < 0 ? 'SHORT' : 'CLOSED');

          return {
            symbol: p.symbol,
            side: sideDisplay,
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
      logger.info("No active positions to display.");
    }
  } catch (error) {
    logger.error({ error }, "Failed to display portfolio snapshot");
  }
}

async function runHybridTradingLoop(mode: SessionMode) {
  logger.info("🚀 HYBRID TACTICAL ENGINE STARTED");

  // 1. Initial Strategy Refresh
  await strategyGovernor.refreshDirective();

  let cachedRwaSymbols: string[] = [];
  let lastRwaRefresh = 0;
  const RWA_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

  const blacklistedKeywords = [
    "GOLD", "SILVER", "OIL", "XAU", "XAG", "AAPL", "TSLA", "NVDA", "MSFT", 
    "GOOGL", "AMZN", "META", "NFLX", "SPX", "NDX", "US30"
  ];

  const majorPairs = [
    'BTCUSDT', 'ETHUSDT', 'ASTERUSDT', 'BNBUSDT', 'XRPUSDT', 
    'ZECUSDT', 'XLMUSDT', 'SUIUSDT', 'TONUSDT', 'BCHUSDT',
    'LINKUSDT', 'ADAUSDT', 'AVAXUSDT', 'LTCUSDT', 'TRXUSDT', 'ETCUSDT',
    'HYPEUSDT'
  ];

  // 2. High-Speed Loop with Tactical AI Confirmation
  while (true) {
    try {
      // Fetch account status ONCE per cycle (reduces Bitget API calls)
      const accountStatus = await marketDataProvider.getAccountStatus();

      // Record WIN/LOSS results for recently closed trades
      await tradeService.syncTradeResults(accountStatus);
      // 1. CAPITAL SHIELD: Dollar-Loss Exit (BACKUP ONLY — Bitget SL is primary)
      // This only triggers if PnL exceeds 2x the SCALP_MAX_LOSS_USD threshold,
      // meaning Bitget's atomic SL failed or was removed.
      if (accountStatus.open_positions?.length > 0) {
        for (const pos of accountStatus.open_positions) {
          try {
            const pnl = parseFloat(pos.unRealizedProfit || '0');
            const holdSideDisplay = (pos.holdSide || 'long').toUpperCase();

            // BACKUP SHIELD: Only fire at 2x threshold (Bitget SL should catch it first)
            const backupThreshold = env.SCALP_MAX_LOSS_USD * 2;
            if (pnl <= -backupThreshold) {
              logger.fatal({ symbol: pos.symbol, pnl: pnl.toFixed(4), limit: backupThreshold }, `[BACKUP SHIELD EXIT] ${pos.symbol} ${holdSideDisplay} — Bitget SL may have failed! PnL: $${pnl.toFixed(4)}`);
              await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
              continue;
            }

            // 2. TACTICAL EXITS (Time & Profit based for Scalping & Intraday)
            if (env.TRADING_STRATEGY === TradingStrategy.SCALPING || env.TRADING_STRATEGY === TradingStrategy.INTRADAY) {
              const tradeEntry = await tradeRepository.findOpenTradeByPair(pos.symbol);
              if (tradeEntry && tradeEntry.created_at) {
                const openTimeMinutes = (Date.now() - new Date(tradeEntry.created_at).getTime()) / 60000;

                // Adjust limits based on strategy
                const isIntraday = env.TRADING_STRATEGY === TradingStrategy.INTRADAY;
                const maxHoldMinutes = isIntraday ? 480 : env.SCALP_MAX_HOLD_MINUTES; // 8 hours for Intraday
                const timeProfitExitMinutes = isIntraday ? 120 : env.SCALP_PROFIT_EXIT_MINUTES; // 2 hours for Intraday
                const targetProfitUsd = isIntraday ? env.SCALP_PROFIT_EXIT_USD * 3 : env.SCALP_PROFIT_EXIT_USD; // 3x target for Intraday

                // Track Peak PnL for Trailing Stop
                const currentPeak = peakPnlMap.get(pos.symbol) || 0;
                if (pnl > currentPeak) {
                  peakPnlMap.set(pos.symbol, pnl);
                }
                const highestPnl = Math.max(currentPeak, pnl);

                const minFeeBuffer = 0.015; // Estimated round-trip fee for small margin scalping

                // EXITS
                if (openTimeMinutes > maxHoldMinutes) {
                  logger.warn({ symbol: pos.symbol, minutes: openTimeMinutes.toFixed(1), pnl: pnl.toFixed(4) }, `[TIME EXIT] ${pos.symbol} ${holdSideDisplay} force closed after ${openTimeMinutes.toFixed(0)}min (Hard Limit) | PnL: $${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
                } else if (openTimeMinutes > timeProfitExitMinutes && pnl > minFeeBuffer) {
                  logger.warn({ symbol: pos.symbol, minutes: openTimeMinutes.toFixed(1), pnl: pnl.toFixed(4) }, `[TIME EXIT] ${pos.symbol} ${holdSideDisplay} force closed after ${openTimeMinutes.toFixed(0)}min (Time+Profit) | PnL: +$${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
                } else if (pnl >= targetProfitUsd) {
                  logger.warn({ symbol: pos.symbol, pnl: pnl.toFixed(4), target: targetProfitUsd }, `[PROFIT EXIT] ${pos.symbol} ${holdSideDisplay} target +$${targetProfitUsd} reached | PnL: +$${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
                } else if (highestPnl >= targetProfitUsd * 0.8 && pnl <= targetProfitUsd * 0.5) {
                  // TRAILING STOP TIER 1: Reached 80%, lock in 50%
                  logger.warn({ symbol: pos.symbol, highest: highestPnl.toFixed(4), pnl: pnl.toFixed(4) }, `[TRAILING STOP] ${pos.symbol} ${holdSideDisplay} secured 50% profit after 80% peak! | PnL: $${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
                } else if (highestPnl >= targetProfitUsd * 0.5 && pnl <= targetProfitUsd * 0.2) {
                  // TRAILING STOP TIER 2: Reached 50%, lock in 20%
                  logger.warn({ symbol: pos.symbol, highest: highestPnl.toFixed(4), pnl: pnl.toFixed(4) }, `[TRAILING STOP] ${pos.symbol} ${holdSideDisplay} secured 20% profit after 50% peak! | PnL: $${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
                } else if (highestPnl >= targetProfitUsd * 0.3 && pnl <= minFeeBuffer) {
                  // SMART BREAKEVEN TIER 3: Reached 30% target but reversed. Securing fee!
                  logger.warn({ symbol: pos.symbol, highest: highestPnl.toFixed(4), pnl: pnl.toFixed(4) }, `[SMART BREAKEVEN] ${pos.symbol} ${holdSideDisplay} reversed from profit! Securing fee buffer | PnL: $${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
                }
              }
            }
          } catch (e: any) {
            logger.error({ symbol: pos.symbol, error: e.message }, 'Failed during position exit check');
          }
        }
      }
      
      // STRICT POSITION BLOCKING: Completely stop scanning if we have an open position
      if (accountStatus.open_positions && accountStatus.open_positions.length >= env.MAX_POSITIONS) {
        await displayPortfolioSnapshot(accountStatus);
        logger.info({ current: accountStatus.open_positions.length, limit: env.MAX_POSITIONS }, 'TRADING PAUSED: Max positions reached. Waiting for position to close...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds before polling again
        continue; // Skip the entire scanning and AI evaluation block
      }
      
      // Check for other critical safety blocks (Cooldowns, Daily Loss Limits)
      const dummyDecision = { decision: TradeAction.SKIP, final_summary: 'PRE_SCAN_CHECK' } as any;
      const riskValidation = riskManager.validateDecision(dummyDecision, accountStatus, mode);
      
      if (riskValidation.decision === TradeAction.SKIP && riskValidation.final_summary?.startsWith('Blocked:')) {
        await displayPortfolioSnapshot(accountStatus);
        await new Promise((resolve) => setTimeout(resolve, 10000));
        continue;
      }

      let allTickers = await bitgetClient.getAllTickers();
      
      // Filter out RWA and non-crypto assets
      const now = Date.now();
      if (now - lastRwaRefresh > RWA_REFRESH_INTERVAL || cachedRwaSymbols.length === 0) {
        logger.info('Refreshing RWA symbol list from Bitget...');
        const exchangeInfo = await bitgetClient.getExchangeInfo();
        cachedRwaSymbols = exchangeInfo
          .filter((s: any) => s.isRwa === 'YES')
          .map((s: any) => s.symbol.replace('_UMCBL', ''));
        lastRwaRefresh = now;
      }

      allTickers = allTickers.filter((t: any) => {
        const isRwa = cachedRwaSymbols.includes(t.symbol);
        const hasBlacklistedKeyword = blacklistedKeywords.some(kw => t.symbol.includes(kw));
        return !isRwa && !hasBlacklistedKeyword;
      });

      let hotPairs: string[] = [];

      if (env.SCAN_MODE === 'VIP') {
        hotPairs = allTickers
          .filter((t: any) => majorPairs.includes(t.symbol))
          .map((t: any) => t.symbol);
      } else if (env.SCAN_MODE === 'ALL') {
        hotPairs = allTickers.map((t: any) => t.symbol);
      } else {
        const allTickers = await bitgetClient.getAllTickers();
        const exchangeInfo = await bitgetClient.getExchangeInfo();

        // Blacklist RWA (Stocks/Commodities)
        const rwaSymbols = exchangeInfo
          .filter((c: any) => c.isRwa === "YES")
          .map((c: any) => c.symbol.replace("_UMCBL", ""));

        // Filter: Only pure crypto tickers
        const cryptoTickers = allTickers.filter(
          (t: any) => !rwaSymbols.includes(t.symbol),
        );

        const majorPairs = [
          "BTCUSDT",
          "ETHUSDT",
          "ASTERUSDT",
          "BNBUSDT",
          "XRPUSDT",
          "ZECUSDT",
          "XLMUSDT",
          "SUIUSDT",
          "TONUSDT",
          "BCHUSDT",
          "LINKUSDT",
          "ADAUSDT",
          "AVAXUSDT",
          "LTCUSDT",
          "TRXUSDT",
          "ETCUSDT",
          "HYPEUSDT",
        ];

        let hotPairs: string[] = [];

        if (env.SCAN_MODE === "VIP") {
          hotPairs = cryptoTickers
            .filter((t: any) => majorPairs.includes(t.symbol))
            .map((t: any) => t.symbol);
        } else if (env.SCAN_MODE === "ALL") {
          hotPairs = cryptoTickers.map((t: any) => t.symbol);
        } else if (env.SCAN_MODE.startsWith("HOT")) {
          const limit = parseInt(env.SCAN_MODE.replace("HOT", "")) || 100;
          hotPairs = cryptoTickers
            .sort(
              (a: any, b: any) =>
                parseFloat(b.volume || "0") - parseFloat(a.volume || "0"),
            )
            .slice(0, limit)
            .map((t: any) => t.symbol);
        } else {
          // Default fallback
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(0, 50)
            .map((t: any) => t.symbol);
        }
      }
      const pairsToScan = hotPairs;

      let macroInterval = '1h';
      let microInterval = '1h';
      if (env.TRADING_STRATEGY === TradingStrategy.SCALPING) { macroInterval = '15m'; microInterval = '1m'; }
      else if (env.TRADING_STRATEGY === TradingStrategy.INTRADAY) { macroInterval = '1h'; microInterval = '15m'; }
      else if (env.TRADING_STRATEGY === TradingStrategy.SWING) { macroInterval = '4h'; microInterval = '1h'; }

      for (const pair of pairsToScan) {
        try {
          // SYMBOL COOLDOWN CHECK: Skip symbols on cooldown after recent LOSS
          if (symbolCooldown.isOnCooldown(pair)) {
            continue;
          }

          const macroLimit = 100;
          const microLimit = env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 50 : 100;
          
          const [macroOHLCV, microOHLCV] = await Promise.all([
            quantEngine.getOHLCVHistory(pair, macroInterval, macroLimit),
            quantEngine.getOHLCVHistory(pair, microInterval, microLimit)
          ]);
          
          const { decision: quantDecision, zScore, threshold, hurst, trioDirection: mathDir } = await quantEngine.evaluateHighSpeed(pair, macroOHLCV, microOHLCV);
          
          // 1.1 ALPHA DETECTION: High Hurst (>0.70) indicates independent momentum (Meme behavior)
          const isAlpha = hurst > 0.70;

          // Real-time Pulse Log (Trinity View)
          const thresholdSymbol = zScore < 0 ? `-${threshold.toFixed(2)}` : `+${threshold.toFixed(2)}`;
          const regimeLabel = isAlpha ? 'ALPHA' : (hurst >= (env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 0.5 : 0.6) ? 'TRND' : 'RNG');
          process.stdout.write(`\r[PULSE] ${pair} | Z: ${zScore.toFixed(2)} (${thresholdSymbol}) | H: ${hurst.toFixed(2)} [${regimeLabel}]      `);

          if (quantDecision) {
            // VOLUME GATE: Minimum 24h volume
            const ticker = allTickers.find((t: any) => t.symbol === pair);
            const volume24hUsd = parseFloat(ticker?.volume || '0');
            if (volume24hUsd < 100000) {
              continue; // Skip illiquid coins silently
            }

            // MOMENTUM GUARD: Block entry against extreme 24h momentum
            const change24h = parseFloat(ticker?.priceChangePercent || '0');
            
            if (mathDir === 'LONG' && change24h < -5) {
              logger.warn({ pair, change24h: `${change24h.toFixed(2)}%`, mathDir }, '[MOMENTUM GUARD] Blocked LONG on crashing coin');
              continue;
            }
            if (mathDir === 'SHORT' && change24h > 5) {
              logger.warn({ pair, change24h: `${change24h.toFixed(2)}%`, mathDir }, '[MOMENTUM GUARD] Blocked SHORT on pumping coin');
              continue;
            }

            console.log('');
            logger.info({ pair, zScore: zScore.toFixed(2), hurst: hurst.toFixed(2), regime: regimeLabel, mathDir }, '🎯 TRINITY SENSOR HIT!');
            
            // 2. AI SNIPER (Gemma confirms the math signal)
            // Pass mathDir and isAlpha to allow Momentum Override for Meme/Alpha coins
            const tacticalDecision = await decisionEngine.evaluateTrade(pair, mode, mathDir, isAlpha);
            
            if (tacticalDecision.decision !== 'SKIP' && tacticalDecision.decision !== 'WAIT') {
              logger.info({ pair }, '⚡ TACTICAL STRIKE: Gemma confirmed! Executing trade...');
              const execution = await tradeService.handleTradeDecision(tacticalDecision, pair);
              if (execution) {
                console.log('');
                break; 
              }
            } else {
              logger.info(
                { pair, reason: tacticalDecision.final_summary },
                "❌ TACTICAL VETO: Gemma rejected the math signal.",
              );
            }
          }
        } catch (e: any) {
          logger.debug({ symbol: pair, error: e.message }, 'Pair evaluation failed, skipping');
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      
      process.stdout.write(`\r[QUANT PULSE] Cycle complete. Waiting for next cycle...      `);
      await new Promise(resolve => setTimeout(resolve, 1000));

      await new Promise((resolve) => setTimeout(resolve, 10000));
    } catch (error) {
      logger.error({ error }, "Tactical loop error");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function bootstrap() {
  logger.info("Starting Hyper-Gemma AI Trader (HYBRID TACTICAL MODE)");
  await connectMongo();
  await startMonitoringApi();
  const currentMode = SessionMode.NORMAL;
  await sessionService.startNewSession(currentMode);

  cron.schedule('0 * * * *', async () => {
    await strategyGovernor.refreshDirective();
  });

  runHybridTradingLoop(currentMode).catch(err => logger.fatal({ err }, 'Fatal Engine Error'));

  cron.schedule('0 0 * * *', async () => {
    await runMemoryConsolidation();
  });

  logger.info("System fully operational in Hybrid Mode.");
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Failed to bootstrap application");
  process.exit(1);
});