import type { MarketData, AccountStatus } from '../../types/market.types.js';

export class PromptBuilder {
  buildTradePrompt(marketData: MarketData, account: AccountStatus, memories: any[]): string {
    const systemInstruction = `
      Anda adalah "Hyper-Gemma Pro", AI Trading Engine tingkat tinggi.
      IDENTITAS: Analis probabilistik yang disiplin namun agresif mencari pertumbuhan.
      MISI: Lipatgandakan modal (Capital Multiplication) melalui peluang di seluruh market.
      PRINSIP:
      1. Pilih koin dengan volatilitas dan volume yang mendukung profit cepat.
      2. WAJIB Risk-to-Reward Ratio (RRR) minimal 1:1.5 (Potensi profit harus lebih besar dari risiko).
      3. LONG/SHORT dan Leverage tinggi (max 500x) diperbolehkan jika confidence > 80%.
      3. Analisis teknikal (RSI, EMA, Trend) harus sinkron sebelum mengambil keputusan.
      4. Lindungi modal sisa agar sistem tetap bisa bertahan untuk trade berikutnya.
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
