import inquirer from "inquirer";
import chalk from "chalk";
import { configExists, saveConfig } from "./config.js";
import type { KesmoConfig, ProviderType } from "../types.js";

const KESMO_BANNER = `
${chalk.cyan("██╗  ██╗███████╗███████╗███╗   ███╗ ██████╗ ")}
${chalk.cyan("██║ ██╔╝██╔════╝██╔════╝████╗ ████║██╔═══██╗")}
${chalk.cyan("█████╔╝ █████╗  ███████╗██╔████╔██║██║   ██║")}
${chalk.cyan("██╔═██╗ ██╔══╝  ╚════██║██║╚██╔╝██║██║   ██║")}
${chalk.cyan("██║  ██╗███████╗███████║██║ ╚═╝ ██║╚██████╔╝")}
${chalk.cyan("╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ")}
${chalk.dim("        AI Code Analysis Engine v1.0.0")}
`;

export const PROVIDER_MODELS: Record<ProviderType, string[]> = {
  openai: [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "o3-mini",
    "o1",
    "o1-mini",
  ],
  claude: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ],
  openrouter: [
    "qwen/qwen3.6-plus-preview:free",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "minimax/minimax-m2.5:free",
    "openai/gpt-oss-20b:free",
    "google/gemma-3n-e4b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  google: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
};

export const MODEL_TAGS: Record<string, string> = {
  "gpt-4.1": "Latest",
  "gpt-4.1-mini": "Fast",
  "gpt-4.1-nano": "Fastest",
  "gpt-4o": "Stable",
  "gpt-4o-mini": "Budget",
  o3: "Reasoning",
  "o3-mini": "Reasoning Fast",
  o1: "Advanced",
  "o1-mini": "Advanced Fast",
  "claude-sonnet-4-20250514": "Latest",
  "claude-opus-4-20250514": "Most Powerful",
  "claude-3-7-sonnet-20250219": "Balanced",
  "claude-3-5-sonnet-20241022": "Stable",
  "claude-3-5-haiku-20241022": "Fast",
  "qwen/qwen3-235b-a22b:free": "235B FREE",
  "qwen/qwen3-32b:free": "32B FREE",
  "qwen/qwen3-14b:free": "14B FREE",
  "qwen/qwen3-8b:free": "8B FREE",
  "google/gemini-2.5-pro-exp-03-25:free": "FREE",
  "google/gemini-2.0-flash-exp:free": "FREE",
  "meta-llama/llama-4-maverick:free": "FREE",
  "meta-llama/llama-4-scout:free": "FREE",
  "deepseek/deepseek-chat-v3-0324:free": "FREE",
  "deepseek/deepseek-r1:free": "Reasoning FREE",
  "microsoft/mai-ds-r1:free": "FREE",
  "mistralai/mistral-small-3.1-24b-instruct:free": "FREE",
  "nvidia/llama-3.1-nemotron-70b-instruct:free": "70B FREE",
  "gemini-2.5-pro": "Latest",
  "gemini-2.5-flash": "Fast",
  "gemini-2.0-flash": "Stable",
  "gemini-1.5-pro": "Previous",
  "gemini-1.5-flash": "Budget",
};

export function getSuggestedModels(provider: ProviderType): string[] {
  return PROVIDER_MODELS[provider] ?? [];
}

export function getModelTag(model: string): string {
  return MODEL_TAGS[model] ?? "";
}

function printBanner(): void {
  console.clear();
  console.log(KESMO_BANNER);
  console.log();
}

function printTips(): void {
  console.log(chalk.bold.white("Tips for getting started:"));
  console.log(
    chalk.gray("1. ") +
      chalk.cyan("/help") +
      chalk.gray(" for more information."),
  );
  console.log(
    chalk.gray("2. ") +
      chalk.gray("Ask coding questions, edit code or run commands."),
  );
  console.log(
    chalk.gray("3. ") + chalk.gray("Be specific for the best results."),
  );
  console.log();
}

export async function ensureSetup(): Promise<void> {
  if (configExists()) {
    printBanner();
    printTips();
    console.log(
      chalk.green("✓") + chalk.white(" KESMO is configured and ready.\n"),
    );
    console.log(chalk.bold.white("Commands:"));
    console.log(
      chalk.gray("  kesmo plugin  ") +
        chalk.dim("Select and run an analysis agent"),
    );
    console.log(
      chalk.gray("  kesmo scan    ") + chalk.dim("Run all agents on codebase"),
    );
    console.log(
      chalk.gray("  kesmo chat    ") +
        chalk.dim("Open interactive chat interface"),
    );
    console.log(
      chalk.gray("  kesmo refactor") +
        chalk.dim("Generate and apply safe code edits"),
    );
    console.log(
      chalk.gray("  kesmo config  ") +
        chalk.dim("View or update configuration"),
    );
    console.log(
      chalk.gray("  kesmo test    ") + chalk.dim("Test API connection"),
    );
    console.log();
    return;
  }

  await runSetup();
}

export async function runSetup(): Promise<void> {
  printBanner();
  printTips();

  console.log(chalk.bold.white("Let's configure KESMO:\n"));

  const { provider } = (await inquirer.prompt({
    type: "select",
    name: "provider",
    message: chalk.white("Select your LLM provider:"),
    choices: [
      // { name: chalk.green("●") + " OpenAI      " + chalk.dim("GPT-4.1, o3, o1"), value: "openai" },
      // { name: chalk.magenta("●") + " Anthropic   " + chalk.dim("Claude Sonnet 4, Opus 4"), value: "claude" },
      {
        name:
          chalk.cyan("●") +
          " OpenRouter  " +
          chalk.dim("50+ models, many FREE"),
        value: "openrouter",
      },
      {
        name:
          chalk.blue("●") + " Google      " + chalk.dim("Gemini 2.5 Pro/Flash"),
        value: "google",
      },
    ],
  })) as { provider: ProviderType };

  const { apiKey } = (await inquirer.prompt({
    type: "password",
    name: "apiKey",
    message: chalk.white(`Enter your ${provider} API key:`),
    mask: "*",
    validate: (input: string) => {
      if (!input || input.trim().length === 0) {
        return "API key is required";
      }
      if (input.trim().length < 10) {
        return "API key seems too short";
      }
      return true;
    },
  })) as { apiKey: string };

  const suggestedModels = PROVIDER_MODELS[provider];
  const modelChoices = suggestedModels.map((m) => {
    const tag = MODEL_TAGS[m] || "";
    const isFree = tag.includes("FREE");
    const tagColor = isFree ? chalk.green : chalk.yellow;
    return {
      name: chalk.white(m) + " " + tagColor(`[${tag}]`),
      value: m,
    };
  });
  modelChoices.push({
    name: chalk.dim("✎ Enter custom model"),
    value: "__custom__",
  });

  const { modelChoice } = (await inquirer.prompt({
    type: "select",
    name: "modelChoice",
    message: chalk.white("Select model:"),
    choices: modelChoices,
    pageSize: 12,
  })) as { modelChoice: string };

  let model = modelChoice;
  if (modelChoice === "__custom__") {
    const { customModel } = (await inquirer.prompt({
      type: "input",
      name: "customModel",
      message: chalk.white("Enter model name:"),
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return "Model name is required";
        }
        return true;
      },
    })) as { customModel: string };
    model = customModel.trim();
  }

  const config: KesmoConfig = {
    provider,
    apiKey: apiKey.trim(),
    model,
  };

  saveConfig(config);

  console.log();
  console.log(chalk.green("✓") + chalk.bold.white(" Setup complete!\n"));
  console.log(chalk.bold.white("Configuration:"));
  console.log(chalk.gray("  Provider  ") + chalk.white(provider));
  console.log(chalk.gray("  Model     ") + chalk.white(model));
  console.log(chalk.gray("  Status    ") + chalk.green("Ready"));
  console.log();
  console.log(chalk.bold.white("Next steps:"));
  console.log(
    chalk.gray("  1. ") +
      chalk.cyan("kesmo test") +
      chalk.gray("    Verify API connection"),
  );
  console.log(
    chalk.gray("  2. ") +
      chalk.cyan("kesmo plugin") +
      chalk.gray("  Select an analysis agent"),
  );
  console.log(
    chalk.gray("  3. ") +
      chalk.cyan("kesmo scan") +
      chalk.gray("    Run all agents"),
  );
  console.log();
}
