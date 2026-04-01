import { enforceTokenLimit } from "../tokenLimiter.js";
import type { Plugin } from "../../types.js";

const STOP_WORDS = new Set([
  "the",
  "is",
  "are",
  "a",
  "an",
  "to",
  "of",
  "for",
  "in",
  "on",
  "and",
  "or",
  "with",
  "from",
  "this",
  "that",
  "it",
  "be",
  "as",
  "at",
  "by",
  "i",
  "you",
  "we",
  "they",
  "my",
  "our",
  "your",
  "can",
  "could",
  "should",
  "would",
  "need",
  "want",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !STOP_WORDS.has(s));
}

const TOOLSET_KEYWORDS = [
  "scan",
  "analyze",
  "security",
  "performance",
  "optimize",
  "refactor",
  "plugin",
  "bug",
  "fix",
  "test",
  "error",
  "stack",
  "trace",
  "vulnerability",
  "architecture",
  "codebase",
  "file",
  "function",
  "class",
  "typescript",
  "javascript",
  "api",
  "endpoint",
  "query",
];

export function shouldUseToolset(userQuery: string): boolean {
  const text = userQuery.toLowerCase();
  if (text.length < 8) {
    return false;
  }
  if (/^(hi|hello|hey|thanks|ok|cool|yo|sup)\b/i.test(text.trim())) {
    return false;
  }
  return TOOLSET_KEYWORDS.some((keyword) => text.includes(keyword));
}

function scorePlugin(plugin: Plugin, queryTokens: string[]): number {
  const haystack =
    `${plugin.id} ${plugin.name} ${plugin.category} ${plugin.description ?? ""} ${plugin.prompt.slice(0, 800)}`.toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    if (plugin.id.toLowerCase().includes(token)) {
      score += 8;
    }
    if (plugin.name.toLowerCase().includes(token)) {
      score += 6;
    }
    if (plugin.category.toLowerCase().includes(token)) {
      score += 4;
    }
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

export function selectToolsetPlugins(
  plugins: Plugin[],
  userQuery: string,
  maxTools = 3,
): Plugin[] {
  const queryTokens = tokenize(userQuery);
  if (queryTokens.length === 0) {
    return plugins.slice(0, Math.max(1, maxTools));
  }

  const ranked = plugins
    .map((plugin) => ({ plugin, score: scorePlugin(plugin, queryTokens) }))
    .sort(
      (a, b) => b.score - a.score || a.plugin.name.localeCompare(b.plugin.name),
    );

  const selected = ranked
    .filter((item) => item.score > 0)
    .slice(0, Math.max(1, maxTools))
    .map((item) => item.plugin);

  if (selected.length > 0) {
    return selected;
  }

  return ranked.slice(0, Math.max(1, maxTools)).map((item) => item.plugin);
}

export function buildToolsetPrompt(tools: Plugin[], maxTokens = 1200): string {
  if (tools.length === 0) {
    return "";
  }

  const sections: string[] = [
    "# Active Toolset",
    "Use these analysis tools only when relevant. Do not execute all tools blindly.",
  ];

  for (const tool of tools) {
    const compactPrompt = tool.prompt.slice(0, 1200).trim();
    sections.push(
      [
        `## ${tool.name} (${tool.id})`,
        `Category: ${tool.category}`,
        tool.description ? `Description: ${tool.description}` : "",
        "Instructions:",
        compactPrompt,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return enforceTokenLimit(sections.join("\n\n"), maxTokens);
}
