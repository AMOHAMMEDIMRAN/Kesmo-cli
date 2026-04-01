import axios from "axios";
import type { KesmoConfig } from "../../types.js";
import type { LLMRunOptions } from "./index.js";

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

export async function runGemini(
  prompt: string,
  config: KesmoConfig,
  options: LLMRunOptions = {},
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1/models/${config.model}:generateContent?key=${config.apiKey}`;

  const res = await axios.post<GeminiResponse>(
    url,
    {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens:
          options.maxOutputTokens ?? (options.reasoning ? 2200 : 1100),
        temperature: options.temperature ?? (options.reasoning ? 0.2 : 0.4),
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 120000,
    },
  );

  const text = res.data.candidates[0]?.content?.parts[0]?.text;
  if (!text) {
    throw new Error("No response received from Gemini");
  }

  return text;
}
