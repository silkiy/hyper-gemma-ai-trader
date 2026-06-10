import "dotenv/config";
import { connectMongo } from "./database/mongo.js";
import { logger } from "./utils/logger.js";
import { decisionEngine } from "./core/ai/decision-engine.js";
import {
  TradeAction,
  SessionMode,
  TradingStrategy,
  TradeResult,
  TradeExitReason,
} from "./types/enum.types.js";
import { riskManager } from "./core/risk/risk-manager.js";
import { cooldownManager } from "./core/risk/cooldown-manager.js";
import { startMonitoringApi } from "./api/monitoring-api.js";
import { tradeService } from "./services/trade.service.js";
import { tradeRepository } from "./database/repositories/trade.repository.js";
import { runMemoryConsolidation } from "./jobs/memory-consolidation.job.js";
import { bitgetClient } from "./exchange/bitget.client.js";
import { marketDataProvider } from "./exchange/market-data.provider.js";
import { sessionService } from "./services/session.service.js";
import { quantEngine } from "./core/quant/quant-engine.js";
import { strategyGovernor } from "./core/ai/strategy-governor.js";
import { env } from "./config/env.js";
import type { AccountStatus } from "./types/market.types.js";
import cron from "node-cron";

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
      logger.info(
        {
          activePositions: activePositions.map((p) => {
            const size = parseFloat(p.size || "0");
            const entryPrice = parseFloat(p.entryPrice || "0");
            const markPrice = parseFloat(p.markPrice || "0");
            const leverage = parseFloat(p.leverage || "1");
            const pnl = parseFloat(p.unRealizedProfit || "0");
            const liqPrice = parseFloat(p.liquidationPrice || "0");

            // Use mapped marginUsed or calculate fallback
            const margin =
              parseFloat(p.marginUsed || "0") ||
              (leverage > 0 ? (Math.abs(size) * entryPrice) / leverage : 0);
            const roe = margin > 0 ? (pnl / margin) * 100 : 0;

            const entryPriceFormatted =
              entryPrice < 0.01
                ? entryPrice.toFixed(7)
                : entryPrice < 1
                  ? entryPrice.toFixed(4)
                  : entryPrice.toFixed(2);
            const markPriceFormatted =
              markPrice < 0.01
                ? markPrice.toFixed(7)
                : markPrice < 1
                  ? markPrice.toFixed(4)
                  : markPrice.toFixed(2);
            const liqPriceFormatted =
              liqPrice < 0.01
                ? liqPrice.toFixed(7)
                : liqPrice < 1
                  ? liqPrice.toFixed(4)
                  : liqPrice.toFixed(2);

            // FIX 3: Use holdSide for accurate direction
            let sideDisplay = "NEUTRAL";
            if (p.holdSide) sideDisplay = p.holdSide.toUpperCase();
            else
              sideDisplay = size > 0 ? "LONG" : size < 0 ? "SHORT" : "CLOSED";

            return {
              symbol: p.symbol,
              side: sideDisplay,
              size: size.toString(),
              entryPrice: entryPriceFormatted,
              markPrice: markPriceFormatted,
              liqPrice: liqPriceFormatted,
              margin: `$${margin.toFixed(4)}`,
              pnl: `$${pnl.toFixed(4)}`,
              roe: `${roe.toFixed(2)}%`,
            };
          }),
        },
        "💰 PORTFOLIO SNAPSHOT",
      );
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

  // 2. High-Speed Loop with Tactical AI Confirmation
  while (true) {
    try {
      // --- COOLDOWN CHECK ---
      if (cooldownManager.isCooldownActive()) {
        const remaining = Math.ceil(cooldownManager.getRemainingMinutes());
        process.stdout.write(`\r[SAFETY] System is in COOLDOWN mode. Remaining: ${remaining} min...      `);
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Check every 30s
        continue;
      }

      const accountStatus = await marketDataProvider.getAccountStatus();

      // --- TASK 5B: Detect Closed Positions ---
      let openTrades = await tradeRepository.findOpenTrades();
      if (env.TRADING_MODE_PAIR === "SINGLE" && env.FOCUS_PAIR) {
        openTrades = openTrades.filter((t) => t.pair === env.FOCUS_PAIR);
      }

      if (openTrades.length > 0) {
        const livePositions = await bitgetClient.getPositions();
        const liveSymbols = new Set(
          livePositions.map((p: any) => p.symbol.replace("_UMCBL", "")),
        );

        for (const trade of openTrades) {
          if (!liveSymbols.has(trade.pair)) {
            // Trade is closed on exchange
            try {
              const fills = await bitgetClient.getFillHistory(trade.pair);
              // Find the most recent fill for this pair
              const exitFill = fills[0];

              if (exitFill) {
                const realizedPnl = parseFloat(exitFill.pnl || "0");
                const exitPrice = parseFloat(exitFill.price || "0");
                const fees = parseFloat(exitFill.fee || "0");

                let result: TradeResult = TradeResult.BREAKEVEN;
                let exitReason: TradeExitReason =
                  TradeExitReason.MANUAL_OR_UNKNOWN;

                if (realizedPnl > 0) {
                  result = TradeResult.WIN;
                  exitReason = TradeExitReason.TP_HIT;
                } else if (realizedPnl < 0) {
                  result = TradeResult.LOSS;
                  exitReason = TradeExitReason.SL_HIT;
                }

                await tradeRepository.closeTradeRecord(trade._id.toString(), {
                  exit_price: exitPrice,
                  realized_pnl: realizedPnl,
                  result,
                  exit_reason: exitReason,
                  closed_at: new Date(),
                  fees,
                  profit_loss: realizedPnl, // Sync for existing stats
                });

                logger.info(
                  {
                    pair: trade.pair,
                    action: trade.action,
                    exitReason,
                    pnl: realizedPnl,
                  },
                  `[TRADE CLOSED] ${trade.pair} ${trade.action} → ${exitReason} | PnL: ${realizedPnl > 0 ? "+" : ""}${realizedPnl} USDT`,
                );

                // Start 30 min cooldown for this specific pair
                cooldownManager.startPairCooldown(trade.pair, 30);

                // Update session stats
                await sessionService.handleTradeClosed(
                  realizedPnl,
                  result === TradeResult.WIN,
                  accountStatus.current_equity
                );

                // Check for safety cooldown on LOSS
                if (result === TradeResult.LOSS) {
                  const streak = await tradeRepository.getConsecutiveLossStreak();
                  const maxLoss = env.MAX_CONSECUTIVE_LOSS || 10;
                  if (streak >= maxLoss) {
                    logger.warn(
                      { streak, limit: maxLoss },
                      `[SAFETY] Max consecutive loss reached (${streak}/${maxLoss}). Entering cooldown 60 min.`,
                    );
                    cooldownManager.startCooldown(60);
                  }
                }
              }
            } catch (fillError) {
              logger.error(
                { pair: trade.pair, error: fillError },
                "Failed to fetch fill history for closed trade",
              );
            }
          }
        }
      }

      // Check for safety blocks (Max positions or Critical Safety)
      const dummyDecision = {
        decision: TradeAction.SKIP,
        final_summary: "PRE_SCAN_CHECK",
      } as any;
      const riskValidation = riskManager.validateDecision(
        dummyDecision,
        accountStatus,
        mode,
      );

      if (
        riskValidation.decision === TradeAction.SKIP &&
        (riskValidation.final_summary?.startsWith("Blocked: Safety") ||
          riskValidation.final_summary?.startsWith("Blocked: Max positions"))
      ) {
        await displayPortfolioSnapshot(accountStatus);
        await new Promise((resolve) => setTimeout(resolve, 10000));
        continue;
      }

      let pairsToScan: string[] = [];

      if (env.TRADING_MODE_PAIR === "SINGLE" && env.FOCUS_PAIR) {
        pairsToScan = [env.FOCUS_PAIR];
        logger.info(
          { pair: env.FOCUS_PAIR },
          `[SINGLE PAIR MODE] Focus: ${env.FOCUS_PAIR}`,
        );
      } else {
        const allTickers = await bitgetClient.getAllTickers();
        const exchangeInfo = await bitgetClient.getExchangeInfo();

        // Blacklist RWA (Stocks/Commodities)
        const rwaSymbols = exchangeInfo
          .filter((c: any) => c.isRwa === "YES")
          .map((c: any) => c.symbol.replace("_UMCBL", ""));

        // Enhanced Filter: Exclude keywords (STOCK, Gold/Silver, Oil)
        const blacklistKeywords = ["STOCK", "XAU", "XAG", "CL", "GOLD", "SILVER", "OIL"];
        
        // --- MOMENTUM PRE-FILTER ---
        const cryptoTickers = allTickers.filter((t: any) => {
          const isRwa = rwaSymbols.includes(t.symbol);
          const isBlacklisted = blacklistKeywords.some(kw => t.symbol.toUpperCase().includes(kw));
          
          // Filter by momentum (24h Price Change)
          const priceChange = Math.abs(parseFloat(t.priceChangePercent));
          const hasMomentum = priceChange >= env.MIN_PRICE_CHANGE_24H;
          
          return !isRwa && !isBlacklisted && hasMomentum;
        });

        if (env.QUANT_ONLY_MODE) {
          logger.info('⚡ QUANT_ONLY_MODE active — Gemma AI bypassed');
        }

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
        } else if (env.SCAN_MODE === "TOP20") {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(0, 20)
            .map((t: any) => t.symbol);
        } else if (env.SCAN_MODE === "HOT5") {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(0, 5)
            .map((t: any) => t.symbol);
        } else if (env.SCAN_MODE === "HOT20") {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(5, 20)
            .map((t: any) => t.symbol);
        } else if (env.SCAN_MODE === "HOT40") {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(20, 40)
            .map((t: any) => t.symbol);
        } else if (env.SCAN_MODE === "HOT60") {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(40, 60)
            .map((t: any) => t.symbol);
        } else if (env.SCAN_MODE === "HOT80") {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(60, 80)
            .map((t: any) => t.symbol);
        } else if (env.SCAN_MODE === "HOT100") {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(80, 100)
            .map((t: any) => t.symbol);
        } else {
          hotPairs = cryptoTickers
            .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
            .slice(0, 100)
            .map((t: any) => t.symbol);
        }
        pairsToScan = hotPairs;
      }

      const interval =
        env.TRADING_STRATEGY === TradingStrategy.INTRADAY ? "15m" : "5m";

      for (const pair of pairsToScan) {
        // Skip if this specific pair is in cooldown
        if (cooldownManager.isPairInCooldown(pair)) continue;

        try {
          // Get full OHLCV history for Trinity analysis (100 candles)
          const ohlcv = await quantEngine.getOHLCVHistory(pair, interval, 100);

          // 1. MATH SENSOR (Trinity: Z + Hurst + VWAP)
          const {
            decision: quantDecision,
            zScore,
            threshold,
            hurst,
            vwapDev,
            trioDirection: mathDir,
          } = await quantEngine.evaluateHighSpeed(pair, ohlcv);

          // Real-time Pulse Log (Trinity View)
          const thresholdSymbol =
            zScore < 0
              ? `-${threshold.toFixed(2)}`
              : `+${threshold.toFixed(2)}`;
          const regime =
            hurst >=
            (env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 0.5 : 0.6)
              ? "TRND"
              : "RNG";
          process.stdout.write(
            `\r[PULSE] ${pair} | Z: ${zScore.toFixed(2)} (${thresholdSymbol}) | H: ${hurst.toFixed(2)} [${regime}]      `,
          );

          if (quantDecision) {
            console.log(""); // Clear pulse line
            logger.info(
              {
                pair,
                zScore: zScore.toFixed(2),
                hurst: hurst.toFixed(2),
                regime,
                mathDir,
              },
              "🎯 TRINITY SENSOR HIT!",
            );

            // 2. AI SNIPER (Gemma confirms the math signal)
            // Pass mathDir and quantMetrics to ensure guard logic is synchronized
            const tacticalDecision = await decisionEngine.evaluateTrade(
              pair,
              mode,
              mathDir,
              { 
                zScore, 
                hurst, 
                vwapDev, 
                regime: hurst >= (env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 0.5 : 0.6) ? 'TRENDING' : 'RANGING',
                leverage: quantDecision.leverage_suggestion 
              }
            );

            if (
              tacticalDecision.decision !== "SKIP" &&
              tacticalDecision.decision !== "WAIT"
            ) {
              logger.info(
                { pair },
                "⚡ TACTICAL STRIKE: Gemma confirmed! Executing trade...",
              );
              const execution = await tradeService.handleTradeDecision(
                tacticalDecision,
                pair,
              );
              if (execution) {
                console.log(""); // Clear pulse line
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
          // Log the error softly so we know if a coin is failing silently
          // process.stdout.write(`\r[QUANT PULSE] Error on ${pair}: ${e.message}      `);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      process.stdout.write(
        `\r[QUANT PULSE] Cycle complete. Waiting 10s...      `,
      );

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

  // Path 1: Strategy Governor (Every 1 hour Gemma wakes up)
  cron.schedule("0 * * * *", async () => {
    await strategyGovernor.refreshDirective();
  });

  // Path 2: Tactical Execution Engine
  runHybridTradingLoop(currentMode).catch((err) =>
    logger.fatal({ err }, "Fatal Engine Error"),
  );

  // Path 3: Background Jobs
  cron.schedule("0 0 * * *", async () => {
    await runMemoryConsolidation();
  });

  logger.info("System fully operational in Hybrid Mode.");
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "Failed to bootstrap application");
  process.exit(1);
});
