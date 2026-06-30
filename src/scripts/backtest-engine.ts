import { QuantUtils } from '../core/quant/quant-utils.js';
import type { OHLCV } from '../core/quant/quant-utils.js';

interface BacktestResult {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
  trades: TradeRecord[];
}

interface TradeRecord {
  entry: number;
  exit: number;
  direction: 'LONG' | 'SHORT';
  pnl: number;
  result: 'WIN' | 'LOSS';
}

export class BacktestEngine {
  private initialCapital: number = 1000;
  private riskPerTrade: number = 0.02; // 2% rule
  private feePercent: number = 0.001; // 0.1% taker fee

  async runBacktest(
    ohlcvData: OHLCV[],
    strategy: 'TREND_FOLLOWING' | 'MEAN_REVERSION' = 'TREND_FOLLOWING'
  ): Promise<BacktestResult> {
    const trades: TradeRecord[] = [];
    let capital = this.initialCapital;
    let peakCapital = this.initialCapital;
    let maxDrawdown = 0;

    // Need at least 100 candles for analysis
    if (ohlcvData.length < 100) {
      return this.getEmptyResult();
    }

    // Simulate trading on historical data
    for (let i = 100; i < ohlcvData.length - 1; i++) {
      const window = ohlcvData.slice(i - 100, i);
      const prices = window.map(c => c.c);
      const lastPrice = prices[prices.length - 1] || 0;
      const nextPrice = ohlcvData[i]?.c || 0;

      // Calculate indicators
      const zScore = QuantUtils.calculateZScore(prices.slice(-20));
      const hurst = QuantUtils.hurstExponent(prices);
      const kalmanPrice = QuantUtils.applyKalmanFilter(prices.slice(-20));
      const vwap = QuantUtils.calculateVWAP(window.slice(-20));

      // Determine entry signal
      let signal: 'LONG' | 'SHORT' | null = null;

      if (strategy === 'TREND_FOLLOWING') {
        // Trend Following: Hurst > 0.60
        if (hurst >= 0.60) {
          if (lastPrice > kalmanPrice && lastPrice > vwap) {
            signal = 'LONG';
          } else if (lastPrice < kalmanPrice && lastPrice < vwap) {
            signal = 'SHORT';
          }
        }
      } else {
        // Mean Reversion: Hurst < 0.60
        if (hurst < 0.60) {
          if (zScore <= -1.8) {
            signal = 'LONG';
          } else if (zScore >= 1.8) {
            signal = 'SHORT';
          }
        }
      }

      // Execute trade if signal exists
      if (signal && lastPrice > 0 && nextPrice > 0) {
        const entryPrice = lastPrice;
        const exitPrice = nextPrice;
        const riskAmount = capital * this.riskPerTrade;
        
        let pnl: number;
        if (signal === 'LONG') {
          pnl = ((exitPrice - entryPrice) / entryPrice) * riskAmount;
        } else {
          pnl = ((entryPrice - exitPrice) / entryPrice) * riskAmount;
        }

        // Deduct fees
        const fees = riskAmount * this.feePercent * 2;
        pnl -= fees;

        const result: TradeRecord = {
          entry: entryPrice,
          exit: exitPrice,
          direction: signal,
          pnl,
          result: pnl >= 0 ? 'WIN' : 'LOSS',
        };

        trades.push(result);
        capital += pnl;

        // Track drawdown
        peakCapital = Math.max(peakCapital, capital);
        const drawdown = (peakCapital - capital) / peakCapital;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }
    }

    // Calculate statistics
    const wins = trades.filter(t => t.result === 'WIN').length;
    const losses = trades.filter(t => t.result === 'LOSS').length;
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnl = trades.length > 0 ? totalPnl / trades.length : 0;

    // Simple Sharpe Ratio
    const returns = trades.map(t => t.pnl / this.initialCapital);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 1 
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdReturn > 0 ? avgReturn / stdReturn : 0;

    return {
      totalTrades: trades.length,
      wins,
      losses,
      winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
      totalPnl,
      avgPnl,
      maxDrawdown: maxDrawdown * 100,
      sharpeRatio,
      trades,
    };
  }

  private getEmptyResult(): BacktestResult {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnl: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      trades: [],
    };
  }

  printResults(result: BacktestResult, strategy: string): void {
    console.log('\n═══════════════════════════════════════════════');
    console.log(`📊 BACKTEST RESULTS: ${strategy}`);
    console.log('═══════════════════════════════════════════════');
    console.log(`Total Trades:    ${result.totalTrades}`);
    console.log(`Wins:            ${result.wins}`);
    console.log(`Losses:          ${result.losses}`);
    console.log(`Win Rate:        ${result.winRate.toFixed(2)}%`);
    console.log(`Total PnL:       $${result.totalPnl.toFixed(4)}`);
    console.log(`Avg PnL/Trade:   $${result.avgPnl.toFixed(4)}`);
    console.log(`Max Drawdown:    ${result.maxDrawdown.toFixed(2)}%`);
    console.log(`Sharpe Ratio:    ${result.sharpeRatio.toFixed(4)}`);
    console.log('═══════════════════════════════════════════════\n');
  }
}
