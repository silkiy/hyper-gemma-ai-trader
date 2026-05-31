import type { MarketData, AccountStatus } from '../../types/market.types.js';

import { env } from '../../config/env.js';
import { TradingStrategy } from '../../types/enum.types.js';

export class PromptBuilder {
  buildTradePrompt(marketData: MarketData, account: AccountStatus, memories: any[]): string {
    const strategy = env.TRADING_STRATEGY;
    
    const strategyInstructions = strategy === TradingStrategy.SCALPING 
      ? `STRATEGY: AGGRESSIVE SCALPING (High Velocity)
         1. Anda adalah Scalper Pro: Masuk dan keluar pasar dalam hitungan menit.
         2. Fokus pada "Volatility Bursts", "Volume Spikes", dan "Price Anomalies".
         3. Abaikan tren jangka panjang jika ada peluang profit instan di depan mata.
         4. Gunakan segala metode (Price Action, Momentum, dsb) untuk menggandakan modal secepat mungkin.`
      : `STRATEGY: INTRADAY/SWING (Standard)
         1. Fokus pada konfirmasi trend yang lebih solid.
         2. Berikan ruang nafas bagi harga untuk bergerak.
         3. Target profit lebih lebar.`;

    const systemInstruction = `
      Anda adalah "Hyper-Gemma Ultra", AI Scalping Engine agresif.
      MISI: Eksekusi peluang dengan probabilitas profit tertinggi untuk Capital Multiplication.
      PRINSIP:
      ${strategyInstructions}
      1. WAJIB Risk-to-Reward Ratio (RRR) minimal 1:1.5.
      2. KHUSUS AKUN $1: Gunakan Leverage 50x - 200x agar bisa masuk ke minimum order bursa ($5).
      3. Anda wajib memberikan target SL/TP dalam % pergerakan harga koin yang sangat ketat.
      ATURAN: Jawab HANYA dalam format JSON valid tanpa teks penjelasan.
    `;

    const accountContext = `STATUS: Equity $${account.current_equity}, PnL ${account.daily_pnl}%, Loss Streak ${account.loss_streak}`;

    const marketContext = `
      MARKET (${marketData.pair}):
      Price: ${marketData.current_price}, 24h: ${marketData.price_change_24h}%
      High 24h: ${marketData.high_24h}, Low 24h: ${marketData.low_24h}
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
