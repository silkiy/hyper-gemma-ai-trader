import { ollamaClient } from './ollama-client.js';
import { marketDataProvider } from '../../exchange/market-data.provider.js';
import { directiveRepository } from '../../database/repositories/directive.repository.js';
import { validateBattleDirective } from '../../utils/json-validator.js';
import { logger } from '../../utils/logger.js';
import { env } from '../../config/env.js';

export class StrategyGovernor {
  /**
   * Gemma acts as the "Commander" (Cold Path).
   * Analyzes macro market conditions to issue Battle Directives.
   */
  async refreshDirective(): Promise<void> {
    logger.info('🧠 COMMANDER: Gemma is formulating new macro strategy...');

    try {
      // 1. Gather Macro Context (Major coins only)
      const btcData = await marketDataProvider.getMarketData('BTCUSDT');
      const ethData = await marketDataProvider.getMarketData('ETHUSDT');
      const accountStatus = await marketDataProvider.getAccountStatus();

      const isScalping = env.TRADING_STRATEGY === 'SCALPING';
      const zScoreInstruction = isScalping
        ? 'KARENA KITA SCALPING, gunakan threshold RENDAH (rekomendasi 1.0 - 1.8) agar bot sering melakukan entry. Jangan gunakan angka di atas 2.0.'
        : 'KARENA KITA INTRADAY, gunakan threshold MENENGAH (rekomendasi 1.5 - 2.5) untuk menangkap ayunan harga yang lebih besar dan terkonfirmasi.';

      const prompt = `
        Identitas: Anda adalah "Gubernur Strategi" untuk bot quant trading.
        Tugas: Berikan "Battle Directive" makro untuk strategi ${env.TRADING_STRATEGY}.
        
        DATA PASAR:
        - BTC: $${btcData.current_price}, 24h Change ${btcData.price_change_24h}%
        - ETH: $${ethData.current_price}, 24h Change ${ethData.price_change_24h}%
        - Akun: Equity $${accountStatus.current_equity}, Available $${accountStatus.available_balance}

        INSTRUKSI:
        1. Tentukan BIAS (LONG jika pasar bullish, SHORT jika bearish, NEUTRAL jika tidak jelas).
        2. Tentukan z_score_threshold. ${zScoreInstruction}
        3. Tentukan max_leverage. WAJIB perintahkan penggunaan LEVERAGE MAKSIMAL (rata kanan) yang tersedia di bursa. Jangan ragu memberikan angka tinggi, karena sistem eksekutor kami akan otomatis menyesuaikannya (menurunkannya) sesuai batas maksimal koin tersebut. Ini krusial agar akun mikro bisa trading.
        4. Dalam menuliskan 'reasoning', sebutkan saja "modal akun yang sangat kecil", JANGAN menuliskan nominal dolar pastinya (seperti $0.70) karena angka ini akan terus berubah.
        
        FORMAT OUTPUT (WAJIB JSON VALID):
        {
          "bias": "LONG" | "SHORT" | "NEUTRAL",
          "z_score_threshold": number,
          "kalman_aggressiveness": number (0.01 - 0.5),
          "max_leverage": number,
          "allowed_symbols": ["string"],
          "reasoning": "string"
        }
      `;

      const response = await ollamaClient.generateValidatedJson(prompt, validateBattleDirective);
      
      // 2. Save Directive
      await directiveRepository.update({
        bias: response.bias,
        z_score_threshold: response.z_score_threshold,
        kalman_aggressiveness: response.kalman_aggressiveness,
        max_leverage: response.max_leverage,
        allowed_symbols: response.allowed_symbols,
      });
      
      logger.info({ 
        bias: response.bias, 
        leverage: response.max_leverage,
        reason: response.reasoning
      }, '📜 NEW BATTLE DIRECTIVE ISSUED');

    } catch (error) {
      logger.error({ error }, 'Commander failed to issue directive. Staying with last known strategy.');
    }
  }
}

export const strategyGovernor = new StrategyGovernor();
