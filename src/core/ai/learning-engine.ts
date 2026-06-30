import { Memory } from '../../database/models/memory.model.js';
import { Trade } from '../../database/models/trade.model.js';
import { logger } from '../../utils/logger.js';
import { MemoryCategory, TradeResult } from '../../types/enum.types.js';

export class LearningEngine {
  async consolidateMemory() {
    logger.info('Starting memory consolidation process');
    
    try {
      // 1. Fetch recent closed trades (last 50)
      const recentTrades = await Trade.find({ result: { $ne: null } })
        .sort({ created_at: -1 })
        .limit(50);

      if (recentTrades.length === 0) {
        logger.info('No closed trades found for consolidation');
        return;
      }

      // 2. Identify loss trades for pattern analysis
      const lossTrades = recentTrades.filter(t => t.result === TradeResult.LOSS);
      const winTrades = recentTrades.filter(t => t.result === TradeResult.WIN);

      logger.info({ 
        total: recentTrades.length, 
        losses: lossTrades.length, 
        wins: winTrades.length 
      }, 'Trade distribution for consolidation');

      // 3. Analyze loss patterns and record lessons
      const lossPatterns = this.analyzeLossPatterns(lossTrades);
      
      for (const pattern of lossPatterns) {
        await this.recordLesson(
          pattern.category,
          pattern.mistake,
          pattern.lesson,
          pattern.marketCondition
        );
      }

      // 4. Analyze win patterns for positive reinforcement
      const winPatterns = this.analyzeWinPatterns(winTrades);
      
      for (const pattern of winPatterns) {
        await this.recordLesson(
          MemoryCategory.ENTRY,
          pattern.mistake,
          pattern.lesson,
          pattern.marketCondition
        );
      }

      // 5. Update effectiveness scores for existing memories
      await this.updateEffectivenessScores(recentTrades);

      logger.info({ 
        lossPatterns: lossPatterns.length, 
        winPatterns: winPatterns.length 
      }, 'Memory consolidation completed');

    } catch (error) {
      logger.error({ error }, 'Memory consolidation failed');
    }
  }

  private analyzeLossPatterns(lossTrades: any[]): Array<{
    category: MemoryCategory;
    mistake: string;
    lesson: string;
    marketCondition: string;
  }> {
    const patterns: Array<{
      category: MemoryCategory;
      mistake: string;
      lesson: string;
      marketCondition: string;
    }> = [];

    // Group losses by exit reason
    const exitReasonGroups = new Map<string, any[]>();
    
    for (const trade of lossTrades) {
      const reason = trade.exit_reason || 'UNKNOWN';
      if (!exitReasonGroups.has(reason)) {
        exitReasonGroups.set(reason, []);
      }
      exitReasonGroups.get(reason)!.push(trade);
    }

    // Analyze each exit reason group
    for (const [reason, trades] of exitReasonGroups) {
      if (trades.length >= 2) {
        const avgPnL = trades.reduce((sum, t) => sum + (t.profit_loss || 0), 0) / trades.length;
        const pairs = [...new Set(trades.map((t: any) => t.pair))];
        
        let category: MemoryCategory;
        let lesson: string;

        switch (reason) {
          case 'SL_HIT':
            category = MemoryCategory.RISK;
            lesson = `Stop Loss triggered ${trades.length}x. Avg loss: $${avgPnL.toFixed(4)}. Consider wider SL or better entry timing.`;
            break;
          case 'TP_HIT':
            category = MemoryCategory.EXIT;
            lesson = `Unexpected TP_HIT on loss trades (${trades.length}x). Check SL/TP calibration.`;
            break;
          case 'TIME_EXIT':
            category = MemoryCategory.EXIT;
            lesson = `Time-based exit resulted in loss ${trades.length}x. Consider extending hold time or adjusting strategy.`;
            break;
          case 'CAPITAL_SHIELD':
            category = MemoryCategory.RISK;
            lesson = `Capital Shield triggered ${trades.length}x. Max loss threshold hit. Review risk parameters.`;
            break;
          default:
            category = MemoryCategory.PSYCHOLOGY;
            lesson = `Loss pattern with reason: ${reason}. Occurred ${trades.length}x.`;
        }

        patterns.push({
          category,
          mistake: `Repeated ${reason} on ${pairs.join(', ')} (${trades.length} times)`,
          lesson,
          marketCondition: trades[0].market_regime || 'UNKNOWN'
        });
      }
    }

    // Analyze leverage-related losses
    const highLeverageLosses = lossTrades.filter(t => t.leverage > 20);
    if (highLeverageLosses.length >= 2) {
      patterns.push({
        category: MemoryCategory.RISK,
        mistake: `High leverage losses (${highLeverageLosses.length}x with leverage > 20x)`,
        lesson: `Excessive leverage led to losses. Consider reducing leverage for better risk management.`,
        marketCondition: 'HIGH_LEVERAGE_RISK'
      });
    }

    // Analyze consecutive losses on same pair
    const pairLossCounts = new Map<string, number>();
    for (const trade of lossTrades) {
      const count = pairLossCounts.get(trade.pair) || 0;
      pairLossCounts.set(trade.pair, count + 1);
    }

    for (const [pair, count] of pairLossCounts) {
      if (count >= 3) {
        patterns.push({
          category: MemoryCategory.PSYCHOLOGY,
          mistake: `Repeated losses on ${pair} (${count} consecutive losses)`,
          lesson: `Avoid trading ${pair} after consecutive losses. Take a break or switch pairs.`,
          marketCondition: pair
        });
      }
    }

    return patterns;
  }

  private analyzeWinPatterns(winTrades: any[]): Array<{
    mistake: string;
    lesson: string;
    marketCondition: string;
  }> {
    const patterns: Array<{
      mistake: string;
      lesson: string;
      marketCondition: string;
    }> = [];

    // Group wins by action type
    const longWins = winTrades.filter(t => t.action === 'LONG');
    const shortWins = winTrades.filter(t => t.action === 'SHORT');

    if (longWins.length >= 3) {
      const avgPnL = longWins.reduce((sum, t) => sum + (t.profit_loss || 0), 0) / longWins.length;
      patterns.push({
        mistake: `Successful LONG trades (${longWins.length}x)`,
        lesson: `LONG entries performing well. Avg PnL: $${avgPnL.toFixed(4)}. Continue LONG bias in similar conditions.`,
        marketCondition: longWins[0].market_regime || 'UNKNOWN'
      });
    }

    if (shortWins.length >= 3) {
      const avgPnL = shortWins.reduce((sum, t) => sum + (t.profit_loss || 0), 0) / shortWins.length;
      patterns.push({
        mistake: `Successful SHORT trades (${shortWins.length}x)`,
        lesson: `SHORT entries performing well. Avg PnL: $${avgPnL.toFixed(4)}. Continue SHORT bias in similar conditions.`,
        marketCondition: shortWins[0].market_regime || 'UNKNOWN'
      });
    }

    return patterns;
  }

  private async updateEffectivenessScores(recentTrades: any[]) {
    try {
      // Get all memories
      const memories = await Memory.find();
      
      for (const memory of memories) {
        // Count how many times this memory's pattern was avoided in recent trades
        const relevantTrades = recentTrades.filter(t => 
          t.market_regime === memory.market_condition
        );
        
        if (relevantTrades.length > 0) {
          const successCount = relevantTrades.filter(t => t.result === TradeResult.WIN).length;
          const successRate = (successCount / relevantTrades.length) * 100;
          
          await Memory.findByIdAndUpdate(memory._id, {
            effectiveness_score: Math.round(successRate),
            avoidance_success_rate: Math.round(successRate)
          });
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to update effectiveness scores');
    }
  }

  async recordLesson(category: MemoryCategory, mistake: string, lesson: string, marketCondition: string) {
    logger.info({ category, mistake }, 'Recording new lesson in memory');
    
    try {
      await Memory.findOneAndUpdate(
        { mistake, category },
        { 
          $set: { lesson, market_condition: marketCondition, last_triggered_at: new Date() },
          $inc: { occurrence_count: 1 }
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      logger.error({ error }, 'Failed to record lesson');
    }
  }
}

export const learningEngine = new LearningEngine();
