import 'dotenv/config';
import { connectMongo } from './database/mongo.js';
import { logger } from './utils/logger.js';
import { decisionEngine } from './core/ai/decision-engine.js';
import { TradeAction, SessionMode, TradingStrategy, TradeExitReason } from './types/enum.types.js';
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
import { pulseLogRepository } from './database/repositories/pulse-log.repository.js';
import { symbolCooldown } from './core/risk/symbol-cooldown.js';
import { cooldownManager } from './core/risk/cooldown-manager.js';
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
  let modeTrading = env.TRADING_STRATEGY;
  logger.info(`🚀 HYBRID TACTICAL ENGINE STARTED WITH MODE`);

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
  // Starting balance akan diambil dari Bitget secara otomatis (universal untuk semua modal)
  const MAX_DRAWDOWN_PERCENT = process.env.MAX_DRAWDOWN_PERCENT ? parseFloat(process.env.MAX_DRAWDOWN_PERCENT) : 15; // default 15% drawdown limit
  let startingBalance = 0; // Akan di-set dari Bitget pada cycle pertama
  let MIN_BALANCE = 0;
  let pauseLogCounter = 0; // Counter to throttle TRADING PAUSED logs

  while (true) {
    try {
      // Fetch account status ONCE per cycle (reduces Bitget API calls)
      const accountStatus = await marketDataProvider.getAccountStatus();
      const currentBalance = accountStatus.current_equity;

      // ═══════════════════════════════════════════════════════════
      // MAX LOSS CHECK - BEFORE AUTO-STOP (Faster detection)
      // ═══════════════════════════════════════════════════════════
      if (accountStatus.open_positions && accountStatus.open_positions.length > 0) {
        for (const pos of accountStatus.open_positions) {
          const pnl = parseFloat(pos.unRealizedProfit || '0');
          const averageOpenPrice = parseFloat(pos.averageOpenPrice || pos.markPrice || '0');
          const posSize = parseFloat(pos.size || '0');
          const actualNotional = Math.abs(posSize * averageOpenPrice);
          const strategy = env.TRADING_STRATEGY;
          
          // Get MAX_LOSS based on strategy
          let maxLossUsd: number;
          if (strategy === 'INTRADAY') maxLossUsd = actualNotional * (env.INTRADAY_MAX_LOSS_PERCENT / 100);
          else if (strategy === 'SWING') maxLossUsd = actualNotional * (env.SWING_MAX_LOSS_PERCENT / 100);
          else maxLossUsd = actualNotional * (env.SCALP_MAX_LOSS_PERCENT / 100);
          
          // Trigger at 1.0x MAX_LOSS (Sangat ketat sesuai limit di .env)
          const maxLossThreshold = maxLossUsd * 1.0;
          
          if (pnl <= -maxLossThreshold) {
            logger.fatal({ 
              symbol: pos.symbol, 
              pnl: pnl.toFixed(4), 
              threshold: maxLossThreshold.toFixed(4),
              maxLoss: maxLossUsd
            }, `🚨 MAX LOSS TRIGGERED: PnL -$${Math.abs(pnl).toFixed(4)} exceeded threshold -$${maxLossThreshold.toFixed(4)}`);
            
              await tradeRepository.update(pos.tradeId || (await tradeRepository.findOpenTradeByPair(pos.symbol))?._id.toString() || '', { exit_reason: TradeExitReason.MAX_LOSS });
              await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
            
            // Short cooldown after max loss
            cooldownManager.startCooldown(30, 'Max loss triggered');
            continue;
          }
        }
      }

      // ═══════════════════════════════════════════════════════════
      // AUTO-STOP: Balance dropped > 15% from starting balance
      // ═══════════════════════════════════════════════════════════
      // Set starting balance dari Bitget pada cycle pertama
      if (startingBalance === 0) {
        startingBalance = currentBalance;
        MIN_BALANCE = startingBalance * (1 - MAX_DRAWDOWN_PERCENT / 100);
        logger.info({ balance: startingBalance, minBalance: MIN_BALANCE, mode: modeTrading }, 'Starting balance set from Bitget');
      }

      if (currentBalance < MIN_BALANCE) {
        logger.fatal({ 
          balance: currentBalance, 
          starting: startingBalance, 
          drawdown: `${((startingBalance - currentBalance) / startingBalance * 100).toFixed(2)}%`
        }, `🚨 AUTO-STOP: Balance dropped > ${MAX_DRAWDOWN_PERCENT}%. Trading paused for review.`);
        
        // Close all open positions
        if (accountStatus.open_positions && accountStatus.open_positions.length > 0) {
          for (const pos of accountStatus.open_positions) {
            try {
              logger.warn({ symbol: pos.symbol }, 'Auto-closing position due to drawdown limit');
              await tradeRepository.update(pos.tradeId || (await tradeRepository.findOpenTradeByPair(pos.symbol))?._id.toString() || '', { exit_reason: TradeExitReason.AUTO_STOP });
              await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
            } catch (e: any) {
              logger.error({ symbol: pos.symbol, error: e.message }, 'Failed to auto-close position');
            }
          }
        }
        
        // Enter infinite cooldown (system stops trading)
        cooldownManager.startCooldown(1440, `Auto-stop: Balance dropped > ${MAX_DRAWDOWN_PERCENT}%`); // 24 hours
        
        // Display final status
        await displayPortfolioSnapshot(accountStatus);
        logger.fatal('System stopped. Review strategy before restarting.');
        
        // Wait indefinitely (system paused)
        await new Promise(() => {}); // Never resolves - system stops
      }

      // Record WIN/LOSS results for recently closed trades
      await tradeService.syncTradeResults(accountStatus);
      // 1. CAPITAL SHIELD: Dollar-Loss Exit (BACKUP ONLY — Bitget SL is primary)
      // This only triggers if PnL exceeds the strategy's maxLossDollarLimit threshold,
      // meaning Bitget's atomic SL failed or was removed.
      if (accountStatus.open_positions?.length > 0) {
        for (const pos of accountStatus.open_positions) {
          try {
            const pnl = parseFloat(pos.unRealizedProfit || '0');
            const holdSideDisplay = (pos.holdSide || 'long').toUpperCase();

            // ═══════════════════════════════════════════════════════════
            // TACTICAL EXITS FIRST (Time & Profit) - BEFORE Backup Shield
            // ═══════════════════════════════════════════════════════════
            if (env.TRADING_STRATEGY === TradingStrategy.SCALPING || env.TRADING_STRATEGY === TradingStrategy.INTRADAY) {
              const tradeEntry = await tradeRepository.findOpenTradeByPair(pos.symbol);
              if (tradeEntry && tradeEntry.created_at) {
                const openTimeMinutes = (Date.now() - new Date(tradeEntry.created_at).getTime()) / 60000;

                // Adjust limits based on strategy
                const strategy = env.TRADING_STRATEGY as string;
                let maxHoldMinutes: number;
                let timeProfitExitMinutes: number;
                let targetProfitDollarLimit: number;
                let maxLossDollarLimit: number;
                let minFeeBuffer: number;

                // Calculate Actual Notional
                const averageOpenPrice = parseFloat(pos.averageOpenPrice || pos.markPrice || '0');
                const posSize = parseFloat(pos.size || '0');
                const positionNotional = posSize * averageOpenPrice;

                if (strategy === 'INTRADAY') {
                  maxHoldMinutes = env.INTRADAY_MAX_HOLD_MINUTES;
                  timeProfitExitMinutes = env.INTRADAY_PROFIT_EXIT_MINUTES;
                  targetProfitDollarLimit = positionNotional * (env.INTRADAY_PROFIT_TARGET_PERCENT / 100);
                  maxLossDollarLimit = positionNotional * (env.INTRADAY_MAX_LOSS_PERCENT / 100);
                  minFeeBuffer = Math.max(0.02, positionNotional * 0.001); // fallback dynamic minFeeBuffer based on size
                } else if (strategy === 'SWING') {
                  maxHoldMinutes = env.SWING_MAX_HOLD_MINUTES;
                  timeProfitExitMinutes = env.SWING_PROFIT_EXIT_MINUTES;
                  targetProfitDollarLimit = positionNotional * (env.SWING_PROFIT_TARGET_PERCENT / 100);
                  maxLossDollarLimit = positionNotional * (env.SWING_MAX_LOSS_PERCENT / 100);
                  minFeeBuffer = Math.max(0.03, positionNotional * 0.0015);
                } else {
                  // SCALPING
                  maxHoldMinutes = env.SCALP_MAX_HOLD_MINUTES;
                  timeProfitExitMinutes = env.SCALP_PROFIT_EXIT_MINUTES;
                  targetProfitDollarLimit = positionNotional * (env.SCALP_PROFIT_TARGET_PERCENT / 100);
                  maxLossDollarLimit = positionNotional * (env.SCALP_MAX_LOSS_PERCENT / 100);
                  minFeeBuffer = Math.max(0.015, positionNotional * 0.0008);
                }

                // Track Peak PnL for Trailing Stop
                const currentPeak = peakPnlMap.get(pos.symbol) || 0;
                if (pnl > currentPeak) {
                  peakPnlMap.set(pos.symbol, pnl);
                }
                const highestPnl = Math.max(currentPeak, pnl);

                // ═══════════════════════════════════════════════════════
                // EXIT LOGIC: No Fixed TP - Let Profits Run!
                // ═══════════════════════════════════════════════════════
                
                // 1. TIME EXIT (Hard Limit)
                if (openTimeMinutes > maxHoldMinutes) {
                  logger.warn({ symbol: pos.symbol, minutes: openTimeMinutes.toFixed(1), pnl: pnl.toFixed(4) }, `[TIME EXIT] ${pos.symbol} ${holdSideDisplay} force closed after ${openTimeMinutes.toFixed(0)}min (Hard Limit) | PnL: $${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  if (tradeEntry?._id) await tradeRepository.update(tradeEntry._id.toString(), { exit_reason: TradeExitReason.TIME_LIMIT });
                  await bitgetClient.closePosition(pos.symbol, (pos.holdSide === 'long' || pos.holdSide === 'short') ? pos.holdSide : 'net', Math.abs(parseFloat(pos.size)).toString());
                  continue;
                }
                
                // 2. DYNAMIC TRAILING STOP (LET PROFITS RUN - FIX RISK:REWARD)
                // Syarat: Jangan aktifkan sabuk pengaman (trailing) jika profit belum menyentuh minimal 40% dari batas kerugian (Max Loss).
                // Ini memaksa bot untuk menahan pergerakan kecil (noise) dan menolak profit recehan (misal $0.02) demi target yang lebih sepadan.
                const breakEvenTarget = maxLossDollarLimit * 0.4;

                if (pnl > 0 && highestPnl >= breakEvenTarget) {
                  let trailingPct = 0.25; // Default: Kunci profit jika turun 25% dari puncak
                  
                  if (highestPnl >= targetProfitDollarLimit * 2) {
                    trailingPct = 0.45; // Moon bag run: Longgarkan hingga 45% agar profit maksimal
                  } else if (highestPnl >= targetProfitDollarLimit) {
                    trailingPct = 0.35; // Target tercapai: Longgarkan 35%
                  }

                  const allowedDrop = highestPnl * trailingPct;
                  // Drop absolut minimal 20% dari Max Loss agar tidak tersentuh noise spread
                  const minAbsoluteDrop = Math.max(allowedDrop, maxLossDollarLimit * 0.2);
                  const currentDrop = highestPnl - pnl;

                  // Wajib drop persentase tercapai DAN drop absolut melebihi ambang batas
                  if (currentDrop >= minAbsoluteDrop && currentDrop > minFeeBuffer) {
                    logger.warn({ symbol: pos.symbol, pnl: pnl.toFixed(4), peak: highestPnl.toFixed(4), drop: currentDrop.toFixed(4) },
                      `[TRAILING STOP] ${pos.symbol} ${holdSideDisplay} profit secured after ${openTimeMinutes.toFixed(0)}min (Dropped ${(trailingPct*100).toFixed(0)}% from peak)`);
                    peakPnlMap.delete(pos.symbol);
                    if (tradeEntry?._id) await tradeRepository.update(tradeEntry._id.toString(), { exit_reason: TradeExitReason.TRAILING_STOP });
                    await bitgetClient.closePosition(pos.symbol, (pos.holdSide === 'long' || pos.holdSide === 'short') ? pos.holdSide : 'net', Math.abs(parseFloat(pos.size)).toString());
                    continue;
                  } else {
                    logger.debug({ symbol: pos.symbol, pnl: pnl.toFixed(4), peak: highestPnl.toFixed(4), trailingReq: minAbsoluteDrop.toFixed(4) },
                      `[HOLDING] ${pos.symbol} ${holdSideDisplay} profit running | PnL: +$${pnl.toFixed(4)}`);
                  }
                }
                
                // 3. PROFIT TIME EXIT: After 1 hour, if profit > fee buffer, secure it
                if (openTimeMinutes > timeProfitExitMinutes && pnl > minFeeBuffer * 1.5) {
                  logger.warn({ symbol: pos.symbol, minutes: openTimeMinutes.toFixed(1), pnl: pnl.toFixed(4) }, `[PROFIT EXIT] ${pos.symbol} ${holdSideDisplay} secured profit after ${openTimeMinutes.toFixed(0)}min | PnL: +$${pnl.toFixed(4)}`);
                  peakPnlMap.delete(pos.symbol);
                  if (tradeEntry?._id) await tradeRepository.update(tradeEntry._id.toString(), { exit_reason: TradeExitReason.PROFIT_EXIT });
                  await bitgetClient.closePosition(pos.symbol, (pos.holdSide === 'long' || pos.holdSide === 'short') ? pos.holdSide : 'net', Math.abs(parseFloat(pos.size)).toString());
                  continue;
                }
              } else {
                logger.debug({ symbol: pos.symbol, hasEntry: !!tradeEntry, hasCreatedAt: tradeEntry?.created_at }, 'Time exit: trade entry not found');
              }
            }

            // ═══════════════════════════════════════════════════════════
            // BACKUP SHIELD (Safety Net) - AFTER Time Exit check
            // ═══════════════════════════════════════════════════════════
            let backupThreshold: number;
            const currentStrategy = env.TRADING_STRATEGY as string;
            const averageOpenPriceBackup = parseFloat(pos.averageOpenPrice || pos.markPrice || '0');
            const posSizeBackup = parseFloat(pos.size || '0');
            const backupNotional = posSizeBackup * averageOpenPriceBackup;

            if (currentStrategy === 'INTRADAY') {
              backupThreshold = (backupNotional * (env.INTRADAY_MAX_LOSS_PERCENT / 100)) * 1.3;
            } else if (currentStrategy === 'SWING') {
              backupThreshold = (backupNotional * (env.SWING_MAX_LOSS_PERCENT / 100)) * 1.3;
            } else {
              backupThreshold = (backupNotional * (env.SCALP_MAX_LOSS_PERCENT / 100)) * 1.3;
            }
            
            if (pnl <= -backupThreshold) {
              logger.fatal({ symbol: pos.symbol, pnl: pnl.toFixed(4), limit: backupThreshold }, `[BACKUP SHIELD EXIT] ${pos.symbol} ${holdSideDisplay} — Bitget SL may have failed! PnL: $${pnl.toFixed(4)}`);
              const tEntry = await tradeRepository.findOpenTradeByPair(pos.symbol);
              if (tEntry?._id) await tradeRepository.update(tEntry._id.toString(), { exit_reason: TradeExitReason.BACKUP_SHIELD });
              await bitgetClient.closePosition(pos.symbol, pos.holdSide as any || 'long', Math.abs(parseFloat(pos.size)).toString());
              continue;
            }
          } catch (e: any) {
            logger.error({ symbol: pos.symbol, error: e.message }, 'Failed during position exit check');
            // EMERGENCY RETRY: If closePosition failed, retry up to 3 times
            if (e.message?.includes('close') || e.message?.includes('position')) {
              for (let retry = 1; retry <= 3; retry++) {
                try {
                  await new Promise(r => setTimeout(r, 500 * retry));
                  logger.warn({ symbol: pos.symbol, retry }, `[EMERGENCY RETRY ${retry}/3] Retrying closePosition...`);
                  await bitgetClient.closePosition(pos.symbol, (pos.holdSide === 'long' || pos.holdSide === 'short') ? pos.holdSide : 'net', Math.abs(parseFloat(pos.size)).toString());
                  logger.info({ symbol: pos.symbol, retry }, `[EMERGENCY RETRY] Successfully closed on retry ${retry}`);
                  break;
                } catch (retryErr: any) {
                  logger.error({ symbol: pos.symbol, retry, error: retryErr.message }, `[EMERGENCY RETRY ${retry}/3] Failed`);
                }
              }
            }
          }
        }
      }
      
      // STRICT POSITION BLOCKING: Completely stop scanning if we have an open position
      if (accountStatus.open_positions && accountStatus.open_positions.length >= env.MAX_POSITIONS) {
        if (pauseLogCounter % 20 === 0) { // Log only once every 30 seconds (20 * 1.5s)
          await displayPortfolioSnapshot(accountStatus);
          logger.info({ current: accountStatus.open_positions.length, limit: env.MAX_POSITIONS }, 'TRADING PAUSED: Max positions reached. Waiting for position to close...');
        }
        pauseLogCounter++;
        await new Promise(resolve => setTimeout(resolve, 1500)); // Wait 1.5 seconds (ultra-fast MAX LOSS detection for open positions)
        continue; // Skip the entire scanning and AI evaluation block
      }
      
      pauseLogCounter = 0; // Reset counter if we pass the block
      
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

      const majorPairs = [
        "BTCUSDT", "ETHUSDT", "ASTERUSDT", "BNBUSDT", "XRPUSDT",
        "ZECUSDT", "XLMUSDT", "SUIUSDT", "TONUSDT", "BCHUSDT",
        "LINKUSDT", "ADAUSDT", "AVAXUSDT", "LTCUSDT", "TRXUSDT",
        "ETCUSDT", "HYPEUSDT"
      ];

      let hotPairs: string[] = [];

      if (env.SCAN_MODE === 'VIP') {
        hotPairs = allTickers
          .filter((t: any) => majorPairs.includes(t.symbol))
          .map((t: any) => t.symbol);
      } else if (env.SCAN_MODE === 'ALL') {
        hotPairs = allTickers.map((t: any) => t.symbol);
      } else if (env.SCAN_MODE.startsWith("HOT")) {
        const limit = parseInt(env.SCAN_MODE.replace("HOT", "")) || 100;
        hotPairs = allTickers
          .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
          .slice(0, limit)
          .map((t: any) => t.symbol);
      } else {
        // Default fallback
        hotPairs = allTickers
          .sort((a: any, b: any) => parseFloat(b.volume || "0") - parseFloat(a.volume || "0"))
          .slice(0, 50)
          .map((t: any) => t.symbol);
      }
      
      const pairsToScan = hotPairs;

      // ═══════════════════════════════════════════════════════════
      // PENDING ORDER CHECK: Cancel stale orders (> 15 min)
      // ═══════════════════════════════════════════════════════════
      try {
        const pendingOrders = await bitgetClient.getPendingOrders();
        if (pendingOrders.length > 0) {
          const now = Date.now();
          const STALE_ORDER_TIMEOUT = 15 * 60 * 1000; // 15 minutes
          
          for (const order of pendingOrders) {
            const orderTime = new Date(order.created_at || order.cTime).getTime();
            const ageMs = now - orderTime;
            
            if (ageMs > STALE_ORDER_TIMEOUT) {
              logger.warn({ 
                symbol: order.symbol, 
                orderId: order.orderId, 
                age: `${Math.floor(ageMs / 60000)}min` 
              }, 'Cancelling stale pending order (> 15 min)');
              await bitgetClient.cancelOrder(order.symbol, order.orderId);
            } else {
              logger.debug({ 
                symbol: order.symbol, 
                orderId: order.orderId, 
                age: `${Math.floor(ageMs / 60000)}min` 
              }, 'Pending order still active, skipping new orders');
              // Skip scanning for this symbol
              pairsToScan.splice(pairsToScan.indexOf(order.symbol), 1);
            }
          }
        }
      } catch (e: any) {
        logger.debug({ error: e.message }, 'Failed to check pending orders');
      }

      // Don't scan if we have pending orders
      const hasPendingOrders = await bitgetClient.getPendingOrders();
      if (hasPendingOrders.length > 0) {
        logger.info({ count: hasPendingOrders.length }, 'Pending orders exist, skipping scan');
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

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
          
          const { decision: quantDecision, zScore, threshold, hurst, trioDirection: mathDir, regime, vwapDev, volumeRatio, atrPercent, skipReasons } = await quantEngine.evaluateHighSpeed(pair, macroOHLCV, microOHLCV);
          
          // 1.1 ALPHA DETECTION: High Hurst (>0.70) indicates independent momentum (Meme behavior)
          const isAlpha = hurst > 0.70;

          // Real-time Pulse Log (Trinity View) - Only show if potential signal
          const thresholdSymbol = zScore < 0 ? `-${threshold.toFixed(2)}` : `+${threshold.toFixed(2)}`;
          const regimeLabel = isAlpha ? 'ALPHA' : (hurst >= (env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 0.5 : 0.6) ? 'TRND' : 'RNG');
          
          // Filter: Only show pulse if Z-Score significant or Hurst trending
          if (Math.abs(zScore) > 0.1 || hurst > 0.55) {
            process.stdout.write(`\r[PULSE] ${pair} | Z: ${zScore.toFixed(2)} (${thresholdSymbol}) | H: ${hurst.toFixed(2)} [${regimeLabel}]      `);
          }

          // Save pulse log to MongoDB (async, don't block)
          pulseLogRepository.create({
            symbol: pair,
            zScore,
            zThreshold: threshold,
            hurst,
            regime,
            vwapDev,
            volumeRatio,
            atrPercent,
            decision: quantDecision ? (quantDecision.decision === TradeAction.LONG ? 'LONG' : quantDecision.decision === TradeAction.SHORT ? 'SHORT' : null) : null,
            skipReasons
          }).catch(err => logger.debug({ error: err.message }, 'Failed to save pulse log'));

          if (quantDecision) {
            // VOLUME GATE: Minimum 24h volume based on strategy
            const ticker = allTickers.find((t: any) => t.symbol === pair);
            const volume24hUsd = parseFloat(ticker?.volume || '0');
            
            // INTRADAY needs higher liquidity ($5M minimum)
            const minVolume = env.TRADING_STRATEGY === TradingStrategy.INTRADAY ? 5000000 : 
                              env.TRADING_STRATEGY === TradingStrategy.SCALPING ? 1000000 : 500000;
            
            if (volume24hUsd < minVolume) {
              logger.debug({ pair, volume: `$${(volume24hUsd/1000000).toFixed(2)}M`, minVolume: `$${(minVolume/1000000).toFixed(1)}M` }, 'Skipped: Low liquidity');
              continue; // Skip illiquid coins
            }

            // DIRECTIONAL MOMENTUM GUARD: Block only dangerous directions
            // (Proteksi short-term sudah ditangani oleh isSharpPump/isSharpDrop di quant-engine.ts)
            const change24h = parseFloat(ticker?.priceChangePercent || '0');

            // 1. Jangan BELI koin yang sudah pump > 10% (membeli di puncak → reversal)
            if (mathDir === 'LONG' && change24h > 10) {
              logger.warn({ pair, change24h: `${change24h.toFixed(2)}%`, mathDir }, 
                '[MOMENTUM GUARD] Blocked LONG on coin already pumped >10%. Buy-at-top risk.');
              continue;
            }
            // 2. Jangan JUAL koin yang sudah crash > 10% (menjual di dasar → bounce)
            if (mathDir === 'SHORT' && change24h < -10) {
              logger.warn({ pair, change24h: `${change24h.toFixed(2)}%`, mathDir }, 
                '[MOMENTUM GUARD] Blocked SHORT on coin already crashed >10%. Sell-at-bottom risk.');
              continue;
            }
            // 3. Jangan beli falling knife (crash > 20%)
            if (mathDir === 'LONG' && change24h < -20) {
              logger.warn({ pair, change24h: `${change24h.toFixed(2)}%`, mathDir }, '[MOMENTUM GUARD] Blocked LONG on crashing coin');
              continue;
            }
            // 4. Jangan jual parabolic pump (pump > 20%)
            if (mathDir === 'SHORT' && change24h > 20) {
              logger.warn({ pair, change24h: `${change24h.toFixed(2)}%`, mathDir }, '[MOMENTUM GUARD] Blocked SHORT on parabolic pump');
              continue;
            }

            console.log('');
            logger.info({ pair, zScore: zScore.toFixed(2), hurst: hurst.toFixed(2), regime: regimeLabel, mathDir }, '🎯 TRINITY SENSOR HIT!');
            
            // 2. AI SNIPER (Gemma confirms the math signal)
            // Pass mathDir and isAlpha to allow Momentum Override for Meme/Alpha coins
            const tacticalDecision = await decisionEngine.evaluateTrade(pair, mode, mathDir, isAlpha);
            
            // Forward ATR from quant decision for dynamic SL/TP
            if (quantDecision && (quantDecision as any).atr) {
              (tacticalDecision as any).atr = (quantDecision as any).atr;
            }
            
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
        await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay between pairs to avoid rate limit
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