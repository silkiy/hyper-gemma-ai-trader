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

  constructor() {
    this.baseUrl = env.OLLAMA_BASE_URL;
    this.model = env.OLLAMA_MODEL;
  }

  /**
   * Internal helper for raw JSON generation.
   */
  private async generateRawJson(prompt: string): Promise<any> {
    const request: OllamaRequest = {
      model: this.model,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1,
        top_k: 40,
        top_p: 0.85,
      },
    };

    try {
      logger.info({ model: this.model }, "Sending request to Ollama");
      const response = await axios.post<OllamaResponse>(
        `${this.baseUrl}/api/generate`,
        request,
        { timeout: 300000 }
      );
      return extractJsonFromResponse(response.data.response);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      logger.error(`Ollama raw generation failed: ${errorMsg}`);
      throw new Error(`Ollama API Error: ${errorMsg}`);
    }
  }

  /**
   * Specifically for trading decisions.
   */
  async generateDecision(prompt: string): Promise<AIDecision> {
    if (env.MOCK_AI) {
      logger.info("MOCK_AI is enabled, returning mock decision");
      return {
        decision: TradeAction.SKIP,
        confidence: 'LOW',
        confidence_score: 90,
        market_regime: MarketRegime.RANGING,
        risk_level: RiskLevel.LOW,
        leverage_suggestion: 1,
        position_size: PositionSize.SMALL,
        entry_reason: "Mock: AI is disabled in environment.",
        risk_factors: ["N/A"],
        stop_loss_logic: "N/A",
        take_profit_logic: "N/A",
        self_reflection: "Mock decision",
        final_summary: "Mocking AI response",
      };
    }

    const rawJson = await this.generateRawJson(prompt);
    return validateAIDecision(rawJson);
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
