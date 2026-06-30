import { tradeRepository } from '../database/repositories/trade.repository.js';
import { orderExecutor } from '../exchange/order.executor.js';
import { bitgetClient } from '../exchange/bitget.client.js';
import { marketDataProvider } from '../exchange/market-data.provider.js';
import { env } from '../config/env.js';
import type { AIDecision } from '../types/ai.types.js';
import { logger } from '../utils/logger.js';
import { sessionService } from './session.service.js';
import { TradeResult, TradeAction, TradeExitReason } from '../types/enum.types.js';
import { symbolCooldown } from '../core/risk/symbol-cooldown.js';

export class TradeService {
  async handleTradeDecision(decision: AIDecision, pair: string) {
    if (decision.decision === 'SKIP' || decision.decision === 'WAIT') {
      logger.info({ reason: decision.final_summary }, 'Trade skipped by AI');
      return;
    }

    try {
      const execution = await orderExecutor.executeOrder(decision, pair);
      
      // Save to database
      await tradeRepository.create({
        pair: pair, 
        action: decision.decision,
        entry_price: execution.price || 0,
        leverage: execution.leverage || decision.leverage_suggestion,
        confidence_score: decision.confidence_score,
        market_regime: decision.market_regime,
        risk_level: decision.risk_level,
        position_size: decision.position_size,
        latency_ms: 0,
        validation_passed: true,
        ollama_raw_response: 'N/A',
        ai_reasoning: decision.entry_reason,
        self_reflection: decision.self_reflection,
        session_id: sessionService.getCurrentSessionId()
      } as any);

      return execution;
    } catch (error: any) {
      logger.error({ 
        message: error.message,
        data: error.response?.data 
      }, 'Failed to handle trade decision');
      
      // Prevent retry loop if execution fails (e.g. CANNOT AFFORD)
      logger.warn({ symbol: pair, minutes: 15 }, '[SYMBOL COOLDOWN] Pair blocked after execution failure');
      symbolCooldown.addCooldown(pair, 15);
    }
  }

  async syncTradeResults(cachedAccountStatus?: any) {
    try {
      const activeTrades = await tradeRepository.findActiveTrades();
      const accountStatus = cachedAccountStatus || await marketDataProvider.getAccountStatus();
      
      const currentSessionId = sessionService.getCurrentSessionId();
      const dailyStats = await tradeRepository.getDailyStats();
      const lossStreak = await tradeRepository.getConsecutiveLosses(currentSessionId);
      
      // Calculate win streak (mirror of loss streak logic)
      const recentTrades = await tradeRepository.findRecent(10);
      let winStreak = 0;
      for (const t of recentTrades) {
        if (t.result === 'WIN') winStreak++;
        else if (t.result) break;
      }

      await sessionService.updateStats(
        dailyStats.tradeCount, 
        dailyStats.dailyPnL, 
        accountStatus.current_equity,
        lossStreak,
        winStreak
      );

      if (activeTrades.length === 0) return;
      const activeSymbols = accountStatus.open_positions.map((p: any) => p.symbol);

      logger.debug({ 
        activeTrades: activeTrades.length, 
        activeSymbols,
        pairs: activeTrades.map(t => t.pair)
      }, 'Sync check: active trades vs positions');

      for (const trade of activeTrades) {
        if (!activeSymbols.includes(trade.pair)) {
          logger.info({ 
            pair: trade.pair, 
            tradeId: trade._id,
            entry: trade.entry_price,
            action: trade.action,
            createdAt: trade.created_at
          }, 'Detected closed position. Syncing results...');

          if (env.TRADING_MODE === 'PAPER') {
            // PAPER MODE: Simulated result using last known price
            const tickers = await bitgetClient.getAllTickers();
            const lastTicker = tickers.find((t: any) => t.symbol === trade.pair);
            const exitPrice = lastTicker ? parseFloat(lastTicker.lastPrice) : trade.entry_price;
            
            const priceDiff = trade.action === TradeAction.LONG 
              ? (exitPrice - trade.entry_price) 
              : (trade.entry_price - exitPrice);
            
            const quantity = 5.1 / trade.entry_price;
            const grossPnl = priceDiff * quantity;
            // Deduct estimated round-trip fee (0.12% of notional)
            const notional = trade.entry_price * quantity;
            const estimatedFee = notional * 0.0012;
            const pnl = grossPnl - estimatedFee;
            
            const result = pnl >= 0 ? TradeResult.WIN : TradeResult.LOSS;

            await tradeRepository.update((trade._id as any).toString(), {
              exit_price: exitPrice,
              profit_loss: pnl,
              result: result,
              exit_reason: trade.exit_reason || TradeExitReason.MANUAL_OR_UNKNOWN
            });
            logger.info({ pair: trade.pair, result, pnl: `$${pnl.toFixed(4)} (gross: $${grossPnl.toFixed(4)})` }, '📊 PAPER TRADE RESULT RECORDED');
            if (result === TradeResult.LOSS) symbolCooldown.addCooldown(trade.pair);
            continue;
          }

          const fills = await bitgetClient.getFillHistory(trade.pair, 20);
          let synced = false;

          logger.debug({ 
            pair: trade.pair, 
            fillCount: fills?.length || 0,
            fills: fills?.map((f: any) => ({
              orderId: f.orderId,
              tradeSide: f.tradeSide,
              price: f.price,
              profit: f.profit
            }))
          }, 'Fill history check');

          if (fills && fills.length > 0) {
            const tradeTime = new Date(trade.created_at).getTime();
            const lastFill = fills.find((f: any) => f.tradeSide === 'close' && parseInt(f.cTime) >= tradeTime);
            
            if (lastFill) {
              const exitPrice = parseFloat(lastFill.price);
              
              logger.info({ 
                pair: trade.pair, 
                exitPrice,
                fillOrderId: lastFill.orderId,
                fillProfit: lastFill.profit
              }, 'Found close fill in history');
              
              // EXACT PNL FROM BITGET FILLS
              let exactGrossPnl = 0;
              let exitFee = 0;
              const closeFills = fills.filter((f: any) => f.orderId === lastFill.orderId);
              for (const f of closeFills) {
                exactGrossPnl += parseFloat(f.profit || '0');
                if (f.feeDetail && Array.isArray(f.feeDetail)) {
                  exitFee += f.feeDetail.reduce((sum: number, fd: any) => sum + parseFloat(fd.totalFee || '0'), 0);
                } else {
                  exitFee += parseFloat(f.fee || '0');
                }
              }

              let entryFee = 0;
              const openFills = fills.filter((f: any) => f.tradeSide === 'open');
              if (openFills.length > 0) {
                const lastOpenOrderId = openFills[0].orderId;
                const matchedOpenFills = openFills.filter((f: any) => f.orderId === lastOpenOrderId);
                for (const f of matchedOpenFills) {
                  if (f.feeDetail && Array.isArray(f.feeDetail)) {
                    entryFee += f.feeDetail.reduce((sum: number, fd: any) => sum + parseFloat(fd.totalFee || '0'), 0);
                  } else {
                    entryFee += parseFloat(f.fee || '0');
                  }
                }
              }

              // If Bitget doesn't return profit, fallback to manual diff
              if (exactGrossPnl === 0 && exitFee === 0) {
                const priceDiff = trade.action === TradeAction.LONG
                  ? (exitPrice - trade.entry_price)
                  : (trade.entry_price - exitPrice);
                const quantity = 5.1 / trade.entry_price;
                exactGrossPnl = priceDiff * quantity;
                const notional = trade.entry_price * quantity;
                exitFee = -(notional * 0.0006);
                entryFee = -(notional * 0.0006);
              }

              const pnl = exactGrossPnl + exitFee + entryFee; // Net PnL (Gross + Negative Fees)
              const result = pnl >= 0 ? TradeResult.WIN : TradeResult.LOSS;

              await tradeRepository.update((trade._id as any).toString(), {
                exit_price: exitPrice,
                profit_loss: pnl,
                result: result,
                exit_reason: trade.exit_reason || TradeExitReason.MANUAL_OR_UNKNOWN
              });

              logger.info({ 
                pair: trade.pair, 
                result, 
                pnl: `$${pnl.toFixed(4)} (gross: $${exactGrossPnl.toFixed(4)}, fees: $${(exitFee+entryFee).toFixed(4)})`, 
                exit: exitPrice 
              }, '📊 TRADE RESULT RECORDED');
              if (result === TradeResult.LOSS) symbolCooldown.addCooldown(trade.pair);
              synced = true;
            }
          }

          // FALLBACK: Position gone from Bitget but no close fill found in history
          if (!synced) {
            logger.warn({ pair: trade.pair }, 'No close fill found in history. Using market price as fallback exit.');
            const tickers = await bitgetClient.getAllTickers();
            const lastTicker = tickers.find((t: any) => t.symbol === trade.pair);
            const exitPrice = lastTicker ? parseFloat(lastTicker.lastPrice) : trade.entry_price;

            const priceDiff = trade.action === TradeAction.LONG 
              ? (exitPrice - trade.entry_price) 
              : (trade.entry_price - exitPrice);
            const quantity = 5.1 / trade.entry_price;
            const grossPnl = priceDiff * quantity;
            const notional = trade.entry_price * quantity;
            const estimatedFee = notional * 0.0012;
            const pnl = grossPnl - estimatedFee;
            
            const result = pnl >= 0 ? TradeResult.WIN : TradeResult.LOSS;

            await tradeRepository.update((trade._id as any).toString(), {
              exit_price: exitPrice,
              profit_loss: pnl,
              result: result,
              exit_reason: trade.exit_reason || TradeExitReason.MANUAL_OR_UNKNOWN
            });
            logger.info({ pair: trade.pair, result, pnl: `$${pnl.toFixed(4)} (gross: $${grossPnl.toFixed(4)})`, exit: exitPrice }, '📊 TRADE RESULT RECORDED (FALLBACK)');
            if (result === TradeResult.LOSS) symbolCooldown.addCooldown(trade.pair);
          }
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to sync trade results');
    }
  }
}

export const tradeService = new TradeService();
