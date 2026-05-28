import axios from 'axios';
import { Wallet } from 'ethers';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export class AsterdexClient {
  private userAddress: string;
  private signerAddress: string;
  private signerPrivateKey: string;
  private baseUrl: string;

  constructor() {
    this.userAddress = env.ASTERDEX_USER_ADDRESS;
    this.signerAddress = env.ASTERDEX_API_KEY;
    this.signerPrivateKey = env.ASTERDEX_SECRET;
    this.baseUrl = env.ASTERDEX_BASE_URL;
  }

  private getNonce(): string {
    // Nonce must be in microseconds
    return (Date.now() * 1000).toString();
  }

  private async generateV3Signature(queryString: string): Promise<string> {
    const wallet = new Wallet(this.signerPrivateKey);
    
    const domain = {
      name: 'AsterSignTransaction',
      version: '1',
      chainId: 1666,
      verifyingContract: '0x0000000000000000000000000000000000000000'
    };

    const types = {
      Message: [
        { name: 'msg', type: 'string' }
      ]
    };

    const message = {
      msg: queryString
    };

    return await wallet.signTypedData(domain, types, message);
  }

  async getCandles(symbol: string, interval: string = '1h', limit: number = 100) {
    const cleanSymbol = symbol.replace('-', '').replace('/', '');
    // Public endpoint still works on V3
    const url = `${this.baseUrl}/fapi/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      logger.error({ symbol, error }, 'Failed to fetch klines from ASTERDEX Pro API');
      throw error;
    }
  }

  async getExchangeInfo() {
    const url = `${this.baseUrl}/fapi/v3/exchangeInfo`;
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch exchange info');
      throw error;
    }
  }

  async getSymbolInfo(symbol: string): Promise<{ quantityPrecision: number; pricePrecision: number }> {
    const cleanSymbol = symbol.replace('-', '').replace('/', '');
    try {
      const info = await this.getExchangeInfo();
      const symbolInfo = info.symbols.find((s: any) => s.symbol === cleanSymbol);
      if (symbolInfo) {
        return {
          quantityPrecision: symbolInfo.quantityPrecision,
          pricePrecision: symbolInfo.pricePrecision || symbolInfo.quotePrecision || 8
        };
      }
      return { quantityPrecision: 3, pricePrecision: 8 }; // Fallback
    } catch (e) {
      return { quantityPrecision: 3, pricePrecision: 8 }; // Fallback
    }
  }

  async getSymbolPrecision(symbol: string): Promise<number> {
    const info = await this.getSymbolInfo(symbol);
    return info.quantityPrecision;
  }

  async getTicker24h(symbol: string) {
    const cleanSymbol = symbol.replace('-', '').replace('/', '');
    const url = `${this.baseUrl}/fapi/v3/ticker/24hr?symbol=${cleanSymbol}`;
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      logger.error({ symbol, error }, 'Failed to fetch 24h ticker from ASTERDEX Pro API');
      throw error;
    }
  }

  async getAllSymbols(): Promise<string[]> {
    const url = `${this.baseUrl}/fapi/v3/exchangeInfo`;
    try {
      const response = await axios.get(url);
      return response.data.symbols
        .filter((s: any) => s.status === 'TRADING')
        .map((s: any) => s.symbol);
    } catch (error) {
      logger.error({ error }, 'Failed to fetch exchange info from ASTERDEX Pro API');
      return [];
    }
  }

  async getAllTickers(): Promise<any[]> {
    const url = `${this.baseUrl}/fapi/v3/ticker/24hr`;
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch all tickers from ASTERDEX Pro API');
      return [];
    }
  }

  async getAccountBalance() {
    const nonce = this.getNonce();
    const params = new URLSearchParams({
      user: this.userAddress,
      signer: this.signerAddress,
      nonce: nonce
    });

    const queryString = params.toString();
    const signature = await this.generateV3Signature(queryString);
    
    try {
      const url = `${this.baseUrl}/fapi/v3/balance?${queryString}&signature=${signature}`;
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch ASTERDEX account balance');
      throw error;
    }
  }

  async getAccountInfo() {
    // Note: V3 might not have a single /account endpoint like V2.
    // We will primarily rely on /v3/balance and /v3/positionRisk.
    // This method is kept for future-proofing if /v3/account is added.
    const nonce = this.getNonce();
    const params = new URLSearchParams({
      user: this.userAddress,
      signer: this.signerAddress,
      nonce: nonce
    });

    const queryString = params.toString();
    const signature = await this.generateV3Signature(queryString);
    
    try {
      const url = `${this.baseUrl}/fapi/v3/account?${queryString}&signature=${signature}`;
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      // If V3 account fails, we'll fall back to calculating from balance/positions
      throw error;
    }
  }

  async getPositions() {
    const nonce = this.getNonce();
    const params = new URLSearchParams({
      user: this.userAddress,
      signer: this.signerAddress,
      nonce: nonce
    });

    const queryString = params.toString();
    const signature = await this.generateV3Signature(queryString);
    
    try {
      const url = `${this.baseUrl}/fapi/v3/positionRisk?${queryString}&signature=${signature}`;
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch ASTERDEX positions');
      throw error;
    }
  }

  async placeOrder(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
    quantity: string;
    price?: string;
    stopPrice?: string;
    leverage?: number;
    reduceOnly?: boolean;
  }) {
    if (order.leverage) {
      await this.setLeverage(order.symbol, order.leverage);
    }

    const nonce = this.getNonce();
    const symbol = order.symbol.replace('-', '').replace('/', '');
    
    const params: any = {
      symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      user: this.userAddress,
      signer: this.signerAddress,
      nonce: nonce
    };

    if (order.type === 'LIMIT' && order.price) {
      params.price = order.price;
      params.timeInForce = 'GTC';
    }

    if (order.stopPrice) {
      params.stopPrice = order.stopPrice;
    }

    if (order.reduceOnly) {
      params.reduceOnly = 'true';
    }

    // Sort keys to ensure consistent signature
    const sortedQueryString = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');

    const signature = await this.generateV3Signature(sortedQueryString);
    
    try {
      const url = `${this.baseUrl}/fapi/v3/order?${sortedQueryString}&signature=${signature}`;
      const response = await axios.post(url, null, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      return response.data;
    } catch (error: any) {
      const exchangeError = error.response?.data || { message: error.message };
      logger.error({ 
        symbol: order.symbol, 
        error: exchangeError 
      }, 'Failed to place order on ASTERDEX Pro API');
      throw error;
    }
  }

  private async setLeverage(symbol: string, leverage: number) {
    const nonce = this.getNonce();
    const cleanSymbol = symbol.replace('-', '');
    const params = new URLSearchParams({
      symbol: cleanSymbol,
      leverage: leverage.toString(),
      user: this.userAddress,
      signer: this.signerAddress,
      nonce: nonce
    });

    const queryString = params.toString();
    const signature = await this.generateV3Signature(queryString);

    try {
      await axios.post(`${this.baseUrl}/fapi/v3/leverage?${queryString}&signature=${signature}`);
    } catch (error: any) {
      // If error is code -4028 (leverage already set to this value), we can ignore it.
      // But if it's -2027 (leverage too high), we MUST throw.
      const exchangeData = error.response?.data;
      if (exchangeData?.code === -4028) {
        logger.info({ symbol, leverage }, 'Leverage already set to target value');
        return;
      }
      
      logger.error({ 
        symbol, 
        leverage, 
        response: exchangeData 
      }, 'Failed to set leverage on exchange. Trade cannot proceed safely.');
      throw new Error(`Failed to set leverage to ${leverage}x: ${exchangeData?.msg || error.message}`);
    }
  }

  async setMarginType(symbol: string, marginType: 'CROSSED' | 'ISOLATED') {
    const nonce = this.getNonce();
    const cleanSymbol = symbol.replace('-', '').replace('/', '');
    const params = new URLSearchParams({
      symbol: cleanSymbol,
      marginType: marginType,
      user: this.userAddress,
      signer: this.signerAddress,
      nonce: nonce
    });

    const queryString = params.toString();
    const signature = await this.generateV3Signature(queryString);

    try {
      await axios.post(`${this.baseUrl}/fapi/v3/marginType?${queryString}&signature=${signature}`);
      logger.info({ symbol, marginType }, 'Margin type set successfully');
    } catch (error) {
      logger.warn({ symbol, marginType }, 'Failed to set margin type (might already be set)');
    }
  }
}

export const asterdexClient = new AsterdexClient();
