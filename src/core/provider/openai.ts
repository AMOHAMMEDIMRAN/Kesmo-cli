import OpenAI from "openai";
import type { KesmoConfig } from "../../types.js";
import type { LLMRunOptions } from "./index.js";

export async function runOpenAI(
  prompt: string,
  config: KesmoConfig,
  options: LLMRunOptions = {},
): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey });

  const res = await client.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: options.maxOutputTokens ?? (options.reasoning ? 2200 : 1100),
    temperature: options.temperature ?? (options.reasoning ? 0.2 : 0.4),
  });

  const content = res.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response received from OpenAI");
  }

  return content;
}
