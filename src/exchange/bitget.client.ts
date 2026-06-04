import axios from 'axios';
import { createHmac } from 'crypto';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export class BitgetClient {
  private apiKey: string;
  private secretKey: string;
  private passphrase: string;
  private baseUrl: string;
  private clientOidPrefix: string = 'bot'; // Default prefix

  constructor() {
    this.apiKey = env.BITGET_API_KEY || '';
    this.secretKey = env.BITGET_SECRET_KEY || '';
    this.passphrase = env.BITGET_PASSPHRASE || '';
    this.baseUrl = env.BITGET_BASE_URL || 'https://api.bitget.com';

    if (!this.apiKey || !this.secretKey || !this.passphrase) {
      logger.error('CRITICAL: Bitget credentials (Key, Secret, or Passphrase) missing in .env');
    }
  }

  /**
   * Set a custom prefix for clientOid (e.g., 'test' for standalone scripts)
   */
  setPrefix(prefix: string) {
    this.clientOidPrefix = prefix;
  }

  private getTimestamp(): string {
    return Date.now().toString();
  }

  private generateSignature(timestamp: string, method: string, requestPath: string, body: string = ''): string {
    const preHash = timestamp + method.toUpperCase() + requestPath + body;
    return createHmac('sha256', this.secretKey)
      .update(preHash)
      .digest('base64');
  }

  private getHeaders(timestamp: string, signature: string) {
    return {
      'ACCESS-KEY': this.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json',
      'locale': 'en-US'
    };
  }

  private formatSymbol(symbol: string): string {
    return symbol.replace('-', '').replace('/', '').replace('_UMCBL', '').toUpperCase();
  }

  async getCandles(symbol: string, granularity: string = '1H', limit: number = 100) {
    const formattedSymbol = this.formatSymbol(symbol);
    let bitgetGranularity = granularity;
    if (granularity.toLowerCase().endsWith('m')) bitgetGranularity = granularity.toLowerCase();
    else bitgetGranularity = granularity.toUpperCase();

    const requestPath = `/api/v2/mix/market/candles?symbol=${formattedSymbol}&productType=USDT-FUTURES&granularity=${bitgetGranularity}&limit=${limit}`;
    try {
      const response = await axios.get(`${this.baseUrl}${requestPath}`);
      if (response.data.code !== '00000') throw new Error(response.data.msg);
      return response.data.data;
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ symbol, error: msg }, 'Failed to fetch klines from Bitget V2');
      throw error;
    }
  }

  async getPriceHistory(symbol: string, interval: string = '5m', limit: number = 50): Promise<number[]> {
    const klines = await this.getCandles(symbol, interval, limit);
    return klines.map((k: any) => parseFloat(k[4]));
  }

  async getAllTickers() {
    const requestPath = '/api/v2/mix/market/tickers?productType=USDT-FUTURES';
    try {
      const response = await axios.get(`${this.baseUrl}${requestPath}`);
      return response.data.data.map((t: any) => ({
        symbol: t.symbol.replace('_UMCBL', ''),
        lastPrice: t.lastPr,
        priceChangePercent: (parseFloat(t.change24h || t.changeUtc24h || '0') * 100).toFixed(3),
        volume: t.usdtVolume || t.quoteVolume || t.baseVolume || '0'
      }));
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ error: msg }, 'Failed to fetch all tickers from Bitget V2');
      return [];
    }
  }

  async getAccountBalance() {
    const timestamp = this.getTimestamp();
    const requestPath = '/api/v2/mix/account/accounts?productType=USDT-FUTURES';
    const signature = this.generateSignature(timestamp, 'GET', requestPath);
    
    try {
      const response = await axios.get(`${this.baseUrl}${requestPath}`, {
        headers: this.getHeaders(timestamp, signature)
      });
      if (response.data.code !== '00000') throw new Error(response.data.msg);
      return response.data.data;
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ error: msg }, 'Failed to fetch Bitget V2 account balance');
      throw error;
    }
  }

  async setLeverage(symbol: string, leverage: number) {
    if (env.TRADING_MODE === 'PAPER') {
      logger.info({ symbol, leverage }, 'PAPER MODE: Simulating leverage set (KYC Bypass)');
      return;
    }

    const formattedSymbol = this.formatSymbol(symbol);
    const timestamp = this.getTimestamp();
    const requestPath = '/api/v2/mix/account/set-leverage';
    const body = JSON.stringify({
      symbol: formattedSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      leverage: leverage.toString()
    });

    const signature = this.generateSignature(timestamp, 'POST', requestPath, body);
    
    try {
      const response = await axios.post(`${this.baseUrl}${requestPath}`, body, {
        headers: this.getHeaders(timestamp, signature)
      });
      if (response.data.code === '00000') {
        logger.info({ symbol, leverage }, 'Leverage set successfully on Bitget V2');
      } else {
        throw new Error(response.data.msg);
      }
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.warn({ symbol, leverage, error: msg }, 'Leverage set failed');
    }
  }

  async placeOrder(order: {
    symbol: string;
    side: 'buy' | 'sell';
    orderType: 'market' | 'limit';
    size: string;
    price?: string;
    presetTakeProfitPrice?: string;
    presetStopLossPrice?: string;
  }) {
    if (env.TRADING_MODE === 'PAPER') {
      logger.info({ symbol: order.symbol, side: order.side }, 'PAPER MODE: Simulating market order (KYC Bypass)');
      return { code: '00000', data: { orderId: `mock-market-${Date.now()}` } };
    }

    const formattedSymbol = this.formatSymbol(order.symbol);
    const timestamp = this.getTimestamp();
    const requestPath = '/api/v2/mix/order/place-order';
    const body = JSON.stringify({
      symbol: formattedSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      marginMode: 'crossed',
      side: order.side, // buy or sell
      tradeSide: 'open',
      posSide: 'net',
      orderType: order.orderType,
      size: order.size,
      price: order.orderType === 'limit' ? order.price : '',
      presetStopSurplusPrice: order.presetTakeProfitPrice || '', // Take Profit
      presetStopLossPrice: order.presetStopLossPrice || '',       // Stop Loss
      clientOid: `${this.clientOidPrefix}-${Date.now()}`
    });


    const signature = this.generateSignature(timestamp, 'POST', requestPath, body);
    
    try {
      const response = await axios.post(`${this.baseUrl}${requestPath}`, body, {
        headers: this.getHeaders(timestamp, signature)
      });
      if (response.data.code !== '00000') throw new Error(response.data.msg);
      return response.data;
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ symbol: order.symbol, error: msg }, 'Failed to place order on Bitget V2');
      throw error;
    }
  }

  async getPositions() {
    const timestamp = this.getTimestamp();
    const requestPath = '/api/v2/mix/position/all-position?productType=USDT-FUTURES';
    const signature = this.generateSignature(timestamp, 'GET', requestPath);
    
    try {
      const response = await axios.get(`${this.baseUrl}${requestPath}`, {
        headers: this.getHeaders(timestamp, signature)
      });
      if (response.data.code !== '00000') throw new Error(response.data.msg);
      return response.data.data;
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ error: msg }, 'Failed to fetch Bitget V2 positions');
      throw error;
    }
  }

  async getSymbolInfo(symbol: string): Promise<{ quantityPrecision: number; pricePrecision: number; maxLeverage: number, minTradeUSDT: number }> {
    const formattedSymbol = this.formatSymbol(symbol);
    const requestPath = `/api/v2/mix/market/contracts?symbol=${formattedSymbol}&productType=USDT-FUTURES`;
    try {
      const response = await axios.get(`${this.baseUrl}${requestPath}`);
      const symbolInfo = response.data.data.find((s: any) => s.symbol === formattedSymbol);
      if (symbolInfo) {
        return {
          quantityPrecision: parseInt(symbolInfo.volumePlace) || 0,
          pricePrecision: parseInt(symbolInfo.pricePlace) || 8,
          maxLeverage: parseInt(symbolInfo.maxLever) || 20,
          minTradeUSDT: parseFloat(symbolInfo.minTradeUSDT || '5.0')
        };
      }
      return { quantityPrecision: 0, pricePrecision: 8, maxLeverage: 10, minTradeUSDT: 5.0 };
    } catch (e) {
      return { quantityPrecision: 0, pricePrecision: 8, maxLeverage: 10, minTradeUSDT: 5.0 };
    }
  }

  /**
   * DEFINITIVE SL/TP FIX for Bitget V2 Unilateral Mode.
   * Uses place-tpsl-order with planType, holdSide (long/short), and orderType.
   */
  async placeTPSLOrder(order: {
    symbol: string;
    planType: 'profit_plan' | 'loss_plan';
    triggerPrice: string;
    triggerType: 'mark_price' | 'fill_price';
    holdSide: 'long' | 'short'; // Use long/short for holdSide identity
    size: string;
  }) {
    if (env.TRADING_MODE === 'PAPER') {
      logger.info({ symbol: order.symbol, type: order.planType }, 'PAPER MODE: Simulating TPSL order');
      return { code: '00000', data: { orderId: `mock-tpsl-${Date.now()}` } };
    }

    const formattedSymbol = this.formatSymbol(order.symbol);
    const timestamp = this.getTimestamp();
    const requestPath = '/api/v2/mix/order/place-tpsl-order';
    const body = JSON.stringify({
      symbol: formattedSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      planType: order.planType,
      triggerPrice: order.triggerPrice,
      triggerType: order.triggerType,
      orderType: 'market', // Market execution on trigger
      holdSide: order.holdSide,
      size: order.size,
      clientOid: `${this.clientOidPrefix}-plan-${Date.now()}`
    });

    const signature = this.generateSignature(timestamp, 'POST', requestPath, body);
    
    try {
      const response = await axios.post(`${this.baseUrl}${requestPath}`, body, {
        headers: this.getHeaders(timestamp, signature)
      });
      if (response.data.code !== '00000') throw new Error(response.data.msg);
      return response.data;
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ symbol: order.symbol, error: msg }, 'Failed to place TPSL order on Bitget V2');
      throw error;
    }
  }
}

export const bitgetClient = new BitgetClient();
