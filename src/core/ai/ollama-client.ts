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

  async generateDecision(prompt: string): Promise<AIDecision> {
    if (env.MOCK_AI) {
      logger.info("MOCK_AI is enabled, returning mock decision");
      return {
        decision: TradeAction.SKIP,
        confidence_score: 90,
        market_regime: MarketRegime.STABLE,
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
      const startTime = Date.now();

      const response = await axios.post<OllamaResponse>(
        `${this.baseUrl}/api/generate`,
        request,
        {
          timeout: 150000,
        },
      );

      const latency = Date.now() - startTime;
      logger.info({ latency }, "Received response from Ollama");

      const rawResponse = response.data.response;
      let rawJson;
      try {
        rawJson = extractJsonFromResponse(rawResponse);
      } catch (parseError) {
        logger.error(
          { rawResponse },
          "Failed to extract JSON from Ollama response",
        );
        throw parseError;
      }

      const validatedDecision = validateAIDecision(rawJson);

      return validatedDecision;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "Ollama client error",
      );
      throw error;
    }
  }
}

export const ollamaClient = new OllamaClient();
