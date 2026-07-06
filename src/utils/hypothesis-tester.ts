import { Trade } from '../database/models/trade.model.js';
import { TradeResult } from '../types/enum.types.js';
import { logger } from './logger.js';

function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + 1.330274 * t))));
  return z >= 0 ? 1 - p : p;
}

export class HypothesisTester {
  async run(autoTriggerOnly: boolean = false) {
    try {
      const trades = await Trade.find({ result: { $in: [TradeResult.WIN, TradeResult.LOSS] } }).sort({ created_at: 1 });
      const cutoffDate = new Date('2026-07-06T14:00:00.000Z');

      const versionA = trades.filter(t => new Date(t.created_at) < cutoffDate);
      let versionB = trades.filter(t => new Date(t.created_at) >= cutoffDate);

      const n = versionB.length;

      // If auto-trigger is active, only run on multiples of 30 (30, 60, 90, etc.)
      if (autoTriggerOnly) {
        if (n < 30 || n % 30 !== 0) {
          return;
        }
      }

      let isDemonstration = false;
      if (versionB.length === 0) {
        // Fallback: use all historical trades if version B is empty (demo mode)
        versionB = trades;
        isDemonstration = true;
      }

      const currentN = versionB.length;
      const winsB = versionB.filter(t => t.result === TradeResult.WIN).length;
      const lossesB = versionB.filter(t => t.result === TradeResult.LOSS).length;
      const winRateB = currentN > 0 ? winsB / currentN : 0;

      const pnlValuesB = versionB.map(t => t.profit_loss || 0);
      const meanPnLB = currentN > 0 ? pnlValuesB.reduce((a, b) => a + b, 0) / currentN : 0;
      const varianceB = currentN > 1 ? pnlValuesB.reduce((sum, val) => sum + Math.pow(val - meanPnLB, 2), 0) / (currentN - 1) : 0;
      const stdDevB = Math.sqrt(varianceB);

      console.log("\n==================================================");
      console.log("📊 AUTO-REPORT: UJI STATISTIK TRINITY V2");
      console.log("==================================================");
      if (isDemonstration) {
        console.log("⚠️  [DEMO MODE] Menampilkan analisis seluruh database trade");
        console.log(`   Total sampel trade historis: ${trades.length}`);
      } else {
        console.log(`Jumlah Trade Versi A (Sebelum Fix): ${versionA.length}`);
        console.log(`Jumlah Trade Versi B (Sesudah Fix): ${versionB.length}`);
      }
      console.log("--------------------------------------------------");
      console.log(`DESKRIPTIF VERSI B (Sistem Baru):`);
      console.log(`- Win Rate: ${(winRateB * 100).toFixed(2)}% (${winsB} Win, ${lossesB} Loss)`);
      console.log(`- Rata-rata PnL per Trade: $${meanPnLB.toFixed(6)}`);
      console.log(`- Standar Deviasi PnL: $${stdDevB.toFixed(6)}`);
      console.log("--------------------------------------------------");

      if (currentN >= 30) {
        // 1. One Sample Proportion Test (Win Rate Test)
        const p0 = 0.55;
        const zProp = (winRateB - p0) / Math.sqrt((p0 * (1 - p0)) / currentN);
        const pValProp = 1 - normalCDF(zProp);

        console.log(`1. Uji Proporsi (Win Rate Test):`);
        console.log(`   - H0: Win Rate = 55% | H1: Win Rate > 55%`);
        console.log(`   - Z-Score: ${zProp.toFixed(4)}`);
        console.log(`   - p-value: ${pValProp.toFixed(4)}`);
        if (pValProp < 0.05) {
          console.log(`   - HASIL: ✅ REJECT H0. WR > 55% terbukti secara statistik.`);
        } else {
          console.log(`   - HASIL: ❌ ACCEPT H0. WR > 55% belum terbukti secara statistik.`);
        }
        console.log("");

        // 2. One Sample Mean Test (Expectancy Test)
        const tMean = stdDevB > 0 ? (meanPnLB - 0) / (stdDevB / Math.sqrt(currentN)) : 0;
        const pValMean = 1 - normalCDF(tMean);

        console.log(`2. Uji Expectancy (Mean PnL Test):`);
        console.log(`   - H0: Rata-rata PnL = 0 | H1: Rata-rata PnL > 0`);
        console.log(`   - T-Score: ${tMean.toFixed(4)}`);
        console.log(`   - p-value: ${pValMean.toFixed(4)}`);
        if (pValMean < 0.05) {
          console.log(`   - HASIL: ✅ REJECT H0. Profitabilitas terbukti secara statistik.`);
        } else {
          console.log(`   - HASIL: ❌ ACCEPT H0. Profitabilitas belum terbukti secara statistik.`);
        }
        console.log("");
      }

      // 3. Two Sample Mean Test
      if (versionA.length >= 30 && versionB.length >= 30 && !isDemonstration) {
        const nA = versionA.length;
        const pnlValuesA = versionA.map(t => t.profit_loss || 0);
        const meanPnLA = pnlValuesA.reduce((a, b) => a + b, 0) / nA;
        const varianceA = pnlValuesA.reduce((sum, val) => sum + Math.pow(val - meanPnLA, 2), 0) / (nA - 1);

        const se = Math.sqrt((varianceA / nA) + (varianceB / currentN));
        const zAB = se > 0 ? (meanPnLB - meanPnLA) / se : 0;
        const pValAB = 1 - normalCDF(zAB);

        console.log(`3. Uji Perbandingan A/B (Version Improvement Test):`);
        console.log(`   - H0: PnL B <= PnL A | H1: PnL B > PnL A`);
        console.log(`   - Rata-rata PnL A (Lama): $${meanPnLA.toFixed(6)}`);
        console.log(`   - Rata-rata PnL B (Baru): $${meanPnLB.toFixed(6)}`);
        console.log(`   - Z-Score A/B: ${zAB.toFixed(4)}`);
        console.log(`   - p-value: ${pValAB.toFixed(4)}`);
        if (pValAB < 0.05) {
          console.log(`   - HASIL: ✅ REJECT H0. Versi B terbukti superior dibanding Versi A.`);
        } else {
          console.log(`   - HASIL: ❌ ACCEPT H0. Perbaikan belum signifikan secara statistik.`);
        }
      }
      console.log("==================================================\n");
    } catch (e: any) {
      logger.error({ error: e.message }, "Error during automated hypothesis testing");
    }
  }
}

export const hypothesisTester = new HypothesisTester();
