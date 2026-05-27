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

  async getSymbolPrecision(symbol: string): Promise<number> {
    const cleanSymbol = symbol.replace('-', '').replace('/', '');
    try {
      const info = await this.getExchangeInfo();
      const symbolInfo = info.symbols.find((s: any) => s.symbol === cleanSymbol);
      return symbolInfo ? symbolInfo.quantityPrecision : 3; // Default to 3 if not found
    } catch (e) {
      return 3; // Fallback
    }
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
      // V3 POST usually sends params in URL or body? 
      // Documentation says "Parameters must be sent as a query string" for GET.
      // For POST "send data in the request body (content type application/x-www-form-urlencoded)"
      // But the example shows appending it to URL. Let's try appending to URL first as it's common in DEX APIs.
      const response = await axios.post(url, null, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      return response.data;
    } catch (error) {
      logger.error({ order, error }, 'Failed to place order on ASTERDEX Pro API');
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
    } catch (error) {
      logger.warn({ symbol, leverage }, 'Failed to set leverage (might already be set)');
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
