import { MarketRegime } from '../../types/enum.types.js';

export class MarketRegimeDetector {
  detect(rsi: number, adx: number = 0): MarketRegime {
    if (rsi > 70 || rsi < 30) return MarketRegime.VOLATILE;
    if (adx > 25) return MarketRegime.TRENDING;
    if (adx < 20) return MarketRegime.RANGING;
    return MarketRegime.UNCLEAR;
  }
}

export const marketRegimeDetector = new MarketRegimeDetector();
