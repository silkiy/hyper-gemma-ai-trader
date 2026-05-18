import 'dotenv/config';
import axios from 'axios';
import { env } from '../config/env.js';

async function testOllamaTrading() {
  const prompt = `
      Anda adalah mesin cerdas Hyper-Analytic Trader. 
      Lindungi modal terlebih dahulu. Hindari trading buruk. 
      Analisis market secara probabilistik. Pelajari kesalahan masa lalu. 
      Anda hanya boleh menjawab JSON valid tanpa teks tambahan.

      CURRENT STATUS:
      - Equity: $1000
      - Daily PnL: 0%
      - Loss Streak: 0

      MARKET DATA (ASTER-USDT):
      - Price: 1.25
      - EMA20: 1.20
      - EMA50: 1.15
      - RSI: 65
      - Trend: BULLISH
      - Volatility (ATR): 0.05
      - Funding Rate: 0.0001

      No past lessons yet. Trade carefully.

      STRICT RESPONSE SCHEMA (JSON):
      {
        "decision": "LONG | SHORT | WAIT | SKIP",
        "confidence_score": 0-100,
        "market_regime": "TRENDING | RANGING | VOLATILE | UNCLEAR",
        "risk_level": "LOW | MEDIUM | HIGH",
        "leverage_suggestion": 1-2,
        "position_size": "SMALL | NORMAL | REDUCED",
        "entry_reason": "string",
        "risk_factors": ["string"],
        "stop_loss_logic": "string",
        "take_profit_logic": "string",
        "self_reflection": "string",
        "final_summary": "string"
      }

      Lakukan analisis sekarang.
  `;

  console.log(`Sending full prompt to Ollama (${env.OLLAMA_MODEL})...`);
  try {
    const response = await axios.post(`${env.OLLAMA_BASE_URL}/api/generate`, {
      model: env.OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1
      }
    });
    console.log('--- RAW RESPONSE ---');
    console.log(response.data.response);
    console.log('--------------------');
  } catch (error: any) {
    console.error(`❌ FAILED: ${error.message}`);
  }
}

testOllamaTrading();
