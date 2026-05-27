import type { MarketData, AccountStatus } from '../../types/market.types.js';

import { env } from '../../config/env.js';
import { TradingStrategy } from '../../types/enum.types.js';

export class PromptBuilder {
  buildTradePrompt(marketData: MarketData, account: AccountStatus, memories: any[]): string {
    const strategy = env.TRADING_STRATEGY;
    
    const strategyInstructions = strategy === TradingStrategy.SCALPING 
      ? `STRATEGY: SCALPING (High Frequency)
         1. Fokus pada micro-momentum dan pergerakan harga cepat pada timeframe 5 menit.
         2. Target Take Profit (TP) harus cepat tercapai, gunakan stop loss ketat.
         3. Utamakan koin dengan spread tipis dan volume sangat tinggi.`
      : `STRATEGY: INTRADAY/SWING (Standard)
         1. Fokus pada konfirmasi trend yang lebih solid (Timeframe 1 jam).
         2. Berikan ruang nafas bagi harga untuk bergerak sebelum mengenai SL.
         3. Target profit lebih lebar dibandingkan scalping.`;

    const systemInstruction = `
      Anda adalah "Hyper-Gemma Pro", AI Trading Engine tingkat tinggi.
      IDENTITAS: Analis probabilistik yang disiplin namun agresif mencari pertumbuhan.
      MISI: Lipatgandakan modal (Capital Multiplication) melalui peluang di seluruh market.
      PRINSIP:
      ${strategyInstructions}
      1. WAJIB Risk-to-Reward Ratio (RRR) minimal 1:1.5.
      2. LONG/SHORT dan Leverage tinggi (max 500x) diperbolehkan jika confidence > 80%.
      3. Analisis teknikal (RSI, EMA, Trend) harus sinkron.
      ATURAN: Jawab HANYA dalam format JSON valid tanpa teks penjelasan.
    `;

    const accountContext = `STATUS: Equity $${account.current_equity}, PnL ${account.daily_pnl}%, Loss Streak ${account.loss_streak}`;

    const marketContext = `
      MARKET (${marketData.pair}):
      Price: ${marketData.current_price}, 24h: ${marketData.price_change_24h}%
      EMA20: ${marketData.ema20}, EMA50: ${marketData.ema50}, RSI: ${marketData.rsi}
      Trend: ${marketData.market_trend}, ATR: ${marketData.atr}
    `;

    const memoryContext = memories.length > 0 
      ? `LESSONS:\n${memories.map(m => `- ${m.mistake}: ${m.lesson}`).join('\n')}`
      : 'No lessons yet. Trade well.';

    const responseSchema = `
      SCHEMA:
      {
        "decision": "LONG|SHORT|WAIT|SKIP",
        "confidence_score": 0-100,
        "market_regime": "TRENDING|RANGING|VOLATILE|UNCLEAR",
        "risk_level": "LOW|MEDIUM|HIGH",
        "leverage_suggestion": 1-500,
        "position_size": "SMALL|NORMAL|REDUCED",
        "entry_reason": "string",
        "risk_factors": ["string"],
        "stop_loss_logic": "string",
        "take_profit_logic": "string",
        "self_reflection": "string",
        "final_summary": "string"
      }
    `;

    return `
      ${systemInstruction}
      
      ${accountContext}
      
      ${marketContext}
      
      ${memoryContext}
      
      ${responseSchema}
      
      Lakukan analisis sekarang.
    `;
  }
}

export const promptBuilder = new PromptBuilder();
