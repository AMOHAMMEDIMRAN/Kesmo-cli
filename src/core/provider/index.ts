import { loadConfig } from "../../utils/config.js";
import { runOpenAI } from "./openai.js";
import { runClaude } from "./claude.js";
import { runOpenRouter } from "./openrouter.js";
import { runGemini } from "./gemini.js";
import type { KesmoConfig } from "../../types.js";

export interface LLMRunOptions {
  maxOutputTokens?: number;
  temperature?: number;
  reasoning?: boolean;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const RESPONSE_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 45_000;
const CACHE_MAX_ITEMS = 64;

function buildCacheKey(
  config: KesmoConfig,
  prompt: string,
  options: LLMRunOptions,
): string {
  return [
    config.provider,
    config.model,
    String(options.maxOutputTokens ?? ""),
    String(options.temperature ?? ""),
    String(options.reasoning ?? false),
    prompt,
  ].join("|");
}

function getCached(key: string): string | null {
  const hit = RESPONSE_CACHE.get(key);
  if (!hit) {
    return null;
  }
  if (Date.now() > hit.expiresAt) {
    RESPONSE_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key: string, value: string): void {
  if (RESPONSE_CACHE.size >= CACHE_MAX_ITEMS) {
    const first = RESPONSE_CACHE.keys().next().value;
    if (first) {
      RESPONSE_CACHE.delete(first);
    }
  }
  RESPONSE_CACHE.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export async function runLLM(
  prompt: string,
  options: LLMRunOptions = {},
): Promise<string> {
  const config = loadConfig();
  const cacheKey = buildCacheKey(config, prompt, options);
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    let response = "";
    switch (config.provider) {
      case "openai":
        response = await runOpenAI(prompt, config, options);
        break;
      case "claude":
        response = await runClaude(prompt, config, options);
        break;
      case "openrouter":
        response = await runOpenRouter(prompt, config, options);
        break;
      case "google":
        response = await runGemini(prompt, config, options);
        break;
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }

    setCached(cacheKey, response);
    return response;
  } catch (error) {
    if (error instanceof Error) {
      if (
        error.message.includes("401") ||
        error.message.includes("Unauthorized")
      ) {
        throw new Error(
          `Authentication failed for ${config.provider}. Please check your API key.`,
        );
      }
      if (
        error.message.includes("429") ||
        error.message.includes("rate limit")
      ) {
        throw new Error(
          `Rate limit exceeded for ${config.provider}. Please wait and try again.`,
        );
      }
      if (error.message.includes("model")) {
        throw new Error(
          `Invalid model "${config.model}" for ${config.provider}. Please check your configuration.`,
        );
      }
      throw error;
    }
    throw new Error(`Unknown error occurred while calling ${config.provider}`);
  }
}

export { runOpenAI, runClaude, runOpenRouter, runGemini };
export type { KesmoConfig };
