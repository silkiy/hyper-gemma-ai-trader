import axios from "axios";
import { logger } from "../../utils/logger.js";
import type {
  AIDecision,
  OllamaRequest,
  OllamaResponse,
} from "../../types/ai.types.js";
import {
  extractJsonFromResponse,
  validateAIDecision,
} from "../../utils/json-validator.js";
import { env } from "../../config/env.js";
import {
  TradeAction,
  MarketRegime,
  RiskLevel,
  PositionSize,
} from "../../types/enum.types.js";

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private fallbackMode: boolean = false;

  constructor() {
    this.baseUrl = env.OLLAMA_BASE_URL;
    this.model = env.OLLAMA_MODEL;
  }

  /**
   * Internal helper for raw JSON generation with retry and fallback.
   */
  private async generateRawJson(prompt: string): Promise<any> {
    const request: OllamaRequest = {
      model: this.model,
      prompt: prompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.6,
        top_k: 64,
        top_p: 0.95,
        num_predict: 800,
      },
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info({ model: this.model, attempt }, "Sending request to Ollama");
        const response = await axios.post<OllamaResponse>(
          `${this.baseUrl}/api/generate`,
          request,
          { timeout: 300000 }
        );
        this.retryCount = 0; // Reset on success
        this.fallbackMode = false;
        return extractJsonFromResponse(response.data.response);
      } catch (error: any) {
        const errorMsg = error.response?.data?.error || error.message;
        logger.warn({ attempt, maxRetries: this.maxRetries, error: errorMsg }, "Ollama request failed");
        
        if (attempt < this.maxRetries) {
          // Exponential backoff
          const backoffMs = Math.pow(2, attempt) * 1000;
          logger.info({ backoffMs }, "Retrying after backoff...");
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          // All retries failed - enable fallback mode
          this.retryCount++;
          if (this.retryCount >= 3) {
            logger.error("Ollama failed 3 consecutive times, enabling fallback mode");
            this.fallbackMode = true;
          }
          throw new Error(`Ollama API Error after ${this.maxRetries} attempts: ${errorMsg}`);
        }
      }
    }
  }

  /**
   * Get fallback decision when Ollama is unavailable
   */
  private getFallbackDecision(): AIDecision {
    logger.warn("Using fallback decision - AI validation skipped");
    return {
      decision: TradeAction.SKIP,
      confidence: 'LOW',
      confidence_score: 50,
      market_regime: MarketRegime.UNCLEAR,
      risk_level: RiskLevel.HIGH,
      leverage_suggestion: 1,
      position_size: PositionSize.SMALL,
      entry_reason: "Fallback: Ollama unavailable, skipping trade for safety",
      risk_factors: ["AI validation bypassed due to Ollama failure"],
      stop_loss_logic: "N/A",
      take_profit_logic: "N/A",
      self_reflection: "System in fallback mode",
      final_summary: "Ollama unavailable - trade skipped for safety",
    };
  }

  /**
   * Specifically for trading decisions.
   */
  async generateDecision(prompt: string): Promise<AIDecision> {
    if (env.MOCK_AI || this.fallbackMode) {
      if (this.fallbackMode) {
        logger.warn("Fallback mode active - returning safe SKIP decision");
      } else {
        logger.info("MOCK_AI is enabled, returning mock decision");
      }
      return this.getFallbackDecision();
    }

    try {
      const rawJson = await this.generateRawJson(prompt);
      return validateAIDecision(rawJson);
    } catch (error: any) {
      logger.error({ error: error.message }, "AI decision generation failed, using fallback");
      return this.getFallbackDecision();
    }
  }

  /**
   * Public method for generic validated JSON generation (Cold Path / Commander).
   */
  async generateValidatedJson<T>(prompt: string, validator: (json: any) => T): Promise<T> {
    const startTime = Date.now();
    try {
      const rawJson = await this.generateRawJson(prompt);
      const latency = Date.now() - startTime;
      logger.info({ latency }, "Received validated JSON from Ollama");
      return validator(rawJson);
    } catch (error: any) {
      logger.error({ error: error.message }, "Ollama validated generation failed");
      throw error;
    }
  }
}

export const ollamaClient = new OllamaClient();
