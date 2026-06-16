import type { MarketData, AccountStatus } from '../../types/market.types.js';

import { env } from '../../config/env.js';
import { TradingStrategy } from '../../types/enum.types.js';

export class PromptBuilder {
  buildTradePrompt(
    marketData: MarketData, 
    account: AccountStatus, 
    memories: any[],
    regimeContext?: { hurst: number, regime: string, trioDirection: string }
  ): string {
    const strategy = env.TRADING_STRATEGY;
    
    const strategyInstructions = strategy === TradingStrategy.SCALPING 
      ? `STRATEGY: AGGRESSIVE SCALPING
         1. Kecepatan adalah segalanya. Masuk cepat, keluar cepat.
         2. Jangan overthink — sinyal Trinity sudah tervalidasi secara matematis.
         3. Ikuti arah Quant Direction tanpa ragu.
         4. SL/TP sudah diatur otomatis oleh sistem. Tugas Anda hanya konfirmasi arah.`
      : `STRATEGY: INTRADAY/SWING
         1. Ikuti trend yang terkonfirmasi oleh Trinity Sensor.
         2. Target profit lebih lebar dari stop loss (min R:R 1:1.5).
         3. Hanya gunakan SKIP jika data benar-benar bertentangan dengan sinyal Trinity.`;

    const regimeAlert = regimeContext ? `
      TRINITY SENSOR RESULT (SUDAH TERVALIDASI SECARA MATEMATIS):
      Hurst Exponent: ${regimeContext.hurst.toFixed(2)}
      Regime: ${regimeContext.regime}
      Quant Direction: ${regimeContext.trioDirection}

      PERINTAH WAJIB:
      - Sinyal ini sudah melewati filter Z-Score, Hurst, dan VWAP. ANDA WAJIB MENGIKUTI Quant Direction (${regimeContext.trioDirection}).
      - Anda HANYA boleh menolak jika ada kontradiksi FATAL (contoh: RSI > 90 untuk LONG atau RSI < 10 untuk SHORT).
      - Jika tidak ada kontradiksi fatal, kembalikan ${regimeContext.trioDirection} dengan confidence >= 70.
    ` : '';

    const systemInstruction = `
      Anda adalah "Execution Gemma", AI Trading Executor yang PATUH pada Trinity Sensor.
      
      MISI: Mengeksekusi sinyal trading yang sudah divalidasi oleh mesin matematika (Trinity Sensor).
      
      PRINSIP UTAMA:
      ${strategyInstructions}
      ${regimeAlert}
      
      ATURAN:
      1. Trinity Sensor sudah memvalidasi entry ini. Default Anda adalah MENGEKSEKUSI (LONG atau SHORT sesuai Quant Direction).
      2. HANYA gunakan SKIP/WAIT jika ada kontradiksi FATAL (RSI > 90 atau < 10).
      3. Loss streak BUKAN alasan untuk menolak. Setiap trade baru adalah independen.
      4. Leverage dan SL/TP sudah diatur otomatis oleh sistem — jangan khawatirkan itu.
      
      FORMAT: Jawab HANYA dalam format JSON valid tanpa teks penjelasan.
    `;

    const accountContext = `STATUS: Equity $${account.current_equity.toFixed(4)}, Session Loss Streak ${account.loss_streak}`;

    const marketContext = `
      MARKET (${marketData.pair}):
      Price: ${marketData.current_price}, 24h Change: ${marketData.price_change_24h}%
      RSI: ${marketData.rsi}, ATR: ${marketData.atr}
      Trend: ${marketData.market_trend}
    `;

    const memoryContext = memories.length > 0 
      ? `KONTEKS TRADE SEBELUMNYA (referensi saja, BUKAN alasan untuk menolak):\n${memories.map(m => `- ${m.mistake}: ${m.lesson}`).join('\n')}`
      : '';

    const responseSchema = `
      SCHEMA:
      {
        "decision": "LONG|SHORT|WAIT|SKIP",
        "confidence": "LOW|MEDIUM|HIGH",
        "confidence_score": 0-100,
        "market_regime": "TRENDING|RANGING|VOLATILE|UNCLEAR",
        "risk_level": "LOW|MEDIUM|HIGH",
        "leverage_suggestion": 1-25,
        "position_size": "SMALL|NORMAL|REDUCED",
        "entry_reason": "string (jelaskan alasan teknikal)",
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
      
      Eksekusi sekarang. Ikuti Quant Direction.
    `;
  }
}

export const promptBuilder = new PromptBuilder();
