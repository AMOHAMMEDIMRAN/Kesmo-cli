#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { pluginCommand } from "../src/commands/plugin.js";
import { scanCommand } from "../src/commands/scan.js";
import { chatCommand } from "../src/commands/chat.js";
import { refactorCommand } from "../src/commands/refactor.js";
import {
  ensureSetup,
  runSetup,
  getSuggestedModels,
  getModelTag,
} from "../src/utils/setup.js";

const program = new Command();

program
  .name("kesmo")
  .description("KESMO - AI Code Analysis Engine")
  .version("1.0.0");

program.action(async () => {
  try {
    await ensureSetup();

    const { configExists } = await import("../src/utils/config.js");
    if (!configExists()) {
      return;
    }

    const inquirer = await import("inquirer");
    const { mainAction } = (await inquirer.default.prompt({
      type: "select",
      name: "mainAction",
      message: chalk.white("kesmo main ?"),
      choices: [
        {
          name:
            chalk.green("●") + " Run plugin" + chalk.dim(" (select one agent)"),
          value: "plugin",
        },
        {
          name: chalk.cyan("●") + " Run scan" + chalk.dim(" (all agents)"),
          value: "scan",
        },
        {
          name:
            chalk.magenta("●") + " Open chat" + chalk.dim(" (interactive TUI)"),
          value: "chat",
        },
        {
          name:
            chalk.green("●") +
            " Refactor code" +
            chalk.dim(" (generate/apply edits)"),
          value: "refactor",
        },
        {
          name:
            chalk.blue("●") + " Config" + chalk.dim(" (show/update settings)"),
          value: "config",
        },
        { name: chalk.yellow("●") + " Test connection", value: "test" },
        { name: chalk.red("●") + " Reset config", value: "reset" },
        { name: chalk.gray("●") + " Exit", value: "exit" },
      ],
    })) as { mainAction: string };

    if (mainAction === "exit") {
      console.log(chalk.gray("Goodbye."));
      return;
    }

    if (mainAction === "config") {
      const { configAction } = (await inquirer.default.prompt({
        type: "select",
        name: "configAction",
        message: chalk.white("Config action:"),
        choices: [
          { name: chalk.cyan("●") + " Show current config", value: "show" },
          {
            name:
              chalk.green("●") +
              " Update config" +
              chalk.dim(" (setup wizard)"),
            value: "update",
          },
          {
            name:
              chalk.blue("●") +
              " Change model" +
              chalk.dim(" (keep provider/key)"),
            value: "model",
          },
          {
            name:
              chalk.magenta("●") +
              " Switch provider + model" +
              chalk.dim(" (guided)"),
            value: "providerModel",
          },
          { name: chalk.gray("●") + " Back", value: "back" },
        ],
      })) as { configAction: string };

      if (configAction === "show") {
        await program.parseAsync(["node", "kesmo", "config", "--show"]);
      } else if (configAction === "update") {
        await program.parseAsync(["node", "kesmo", "config", "--update"]);
      } else if (configAction === "model") {
        await program.parseAsync([
          "node",
          "kesmo",
          "config",
          "--select-model",
        ]);
      } else if (configAction === "providerModel") {
        await program.parseAsync([
          "node",
          "kesmo",
          "config",
          "--switch-provider-model",
        ]);
      }

      return;
    }

    if (mainAction === "refactor") {
      console.log(
        chalk.yellow("Use:") +
          chalk.white(' kesmo refactor "your goal" [--apply]'),
      );
      return;
    }

    await program.parseAsync(["node", "kesmo", mainAction]);
  } catch (error) {
    console.log(
      chalk.red(
        `❌ Setup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ),
    );
    process.exit(1);
  }
});

program.addCommand(pluginCommand);
program.addCommand(scanCommand);
program.addCommand(chatCommand);
program.addCommand(refactorCommand);

program
  .command("config")
  .description("View or update KESMO configuration")
  .option("-s, --show", "Show current configuration")
  .option("-u, --update", "Update configuration (run setup wizard)")
  .option("--set-key <key>", "Set API key directly")
  .option("--set-model <model>", "Set model directly")
  .option("--select-model", "Select model interactively for current provider")
  .option(
    "--switch-provider-model",
    "Select provider, then model interactively",
  )
  .option(
    "--set-provider <provider>",
    "Set provider (openai/claude/openrouter/google)",
  )
  .action(async (options) => {
    const { loadConfig, configExists, saveConfig } =
      await import("../src/utils/config.js");

    if (
      options.show ||
      (!options.update &&
        !options.selectModel &&
        !options.switchProviderModel &&
        !options.setKey &&
        !options.setModel &&
        !options.setProvider)
    ) {
      if (!configExists()) {
        console.log(
          chalk.yellow("No configuration found. Run `kesmo` to set up."),
        );
        return;
      }

      const config = loadConfig();
      console.log(chalk.cyan("\n📋 Current KESMO Configuration\n"));
      console.log(`  Provider: ${chalk.green(config.provider)}`);
      console.log(`  Model:    ${chalk.green(config.model)}`);
      console.log(
        `  API Key:  ${chalk.dim(config.apiKey.slice(0, 8) + "..." + config.apiKey.slice(-4))}`,
      );
      console.log(chalk.dim("\nConfig file: .kesmorc.json\n"));
      return;
    }

    if (options.update) {
      await runSetup();
      return;
    }

    if (!configExists()) {
      console.log(
        chalk.yellow("No configuration found. Run `kesmo` first to set up."),
      );
      return;
    }

    const config = loadConfig();
    let updated = false;

    if (options.setProvider) {
      const validProviders = ["openai", "claude", "openrouter", "google"];
      if (!validProviders.includes(options.setProvider)) {
        console.log(
          chalk.red(`❌ Invalid provider. Use: ${validProviders.join(", ")}`),
        );
        return;
      }
      config.provider = options.setProvider;
      updated = true;
      console.log(
        chalk.green(`✅ Provider updated to: ${options.setProvider}`),
      );
    }

    if (options.setKey) {
      if (options.setKey.length < 10) {
        console.log(chalk.red("❌ API key seems too short"));
        return;
      }
      config.apiKey = options.setKey;
      updated = true;
      console.log(chalk.green(`✅ API key updated`));
    }

    if (options.setModel) {
      config.model = options.setModel;
      updated = true;
      console.log(chalk.green(`✅ Model updated to: ${options.setModel}`));
    }

    if (options.selectModel) {
      const inquirer = await import("inquirer");
      const suggestedModels = getSuggestedModels(config.provider);

      if (suggestedModels.length === 0) {
        console.log(
          chalk.yellow(
            `No suggested models for provider ${config.provider}. Use --set-model instead.`,
          ),
        );
      } else {
        const modelChoices = suggestedModels.map((model) => {
          const tag = getModelTag(model);
          const isCurrent = model === config.model;
          const label =
            chalk.white(model) +
            (tag ? " " + chalk.yellow(`[${tag}]`) : "") +
            (isCurrent ? " " + chalk.green("(current)") : "");
          return {
            name: label,
            value: model,
          };
        });
        modelChoices.push({
          name: chalk.dim("✎ Enter custom model"),
          value: "__custom__",
        });

        const { modelChoice } = (await inquirer.default.prompt({
          type: "select",
          name: "modelChoice",
          message: chalk.white(`Select model for ${config.provider}:`),
          choices: modelChoices,
          pageSize: 12,
        })) as { modelChoice: string };

        let selectedModel = modelChoice;
        if (modelChoice === "__custom__") {
          const { customModel } = (await inquirer.default.prompt({
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
          selectedModel = customModel.trim();
        }

        config.model = selectedModel;
        updated = true;
        console.log(chalk.green(`✅ Model updated to: ${selectedModel}`));
      }
    }

    if (options.switchProviderModel) {
      const inquirer = await import("inquirer");
      const providers = ["openai", "claude", "openrouter", "google"];

      const { providerChoice } = (await inquirer.default.prompt({
        type: "select",
        name: "providerChoice",
        message: chalk.white("Select provider:"),
        choices: providers.map((provider) => ({
          name:
            chalk.white(provider) +
            (provider === config.provider
              ? " " + chalk.green("(current)")
              : ""),
          value: provider,
        })),
      })) as { providerChoice: string };

      config.provider = providerChoice as
        | "openai"
        | "claude"
        | "openrouter"
        | "google";

      const suggestedModels = getSuggestedModels(config.provider);
      const modelChoices = suggestedModels.map((model) => {
        const tag = getModelTag(model);
        return {
          name: chalk.white(model) + (tag ? " " + chalk.yellow(`[${tag}]`) : ""),
          value: model,
        };
      });
      modelChoices.push({
        name: chalk.dim("✎ Enter custom model"),
        value: "__custom__",
      });

      const { modelChoice } = (await inquirer.default.prompt({
        type: "select",
        name: "modelChoice",
        message: chalk.white(`Select model for ${config.provider}:`),
        choices: modelChoices,
        pageSize: 12,
      })) as { modelChoice: string };

      let selectedModel = modelChoice;
      if (modelChoice === "__custom__") {
        const { customModel } = (await inquirer.default.prompt({
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
        selectedModel = customModel.trim();
      }

      config.model = selectedModel;
      updated = true;
      console.log(
        chalk.green(
          `✅ Switched to provider=${config.provider}, model=${config.model}`,
        ),
      );
    }

    if (updated) {
      saveConfig(config);
      console.log(chalk.dim("\nConfiguration saved to .kesmorc.json"));
    }
  });

program
  .command("test")
  .description("Test API connection with current configuration")
  .action(async () => {
    const { configExists, loadConfig } = await import("../src/utils/config.js");
    const { runLLM } = await import("../src/core/provider/index.js");
    const ora = await import("ora");

    if (!configExists()) {
      console.log(chalk.red("❌ No configuration found. Run `kesmo` first."));
      process.exit(1);
    }

    const config = loadConfig();
    console.log(chalk.cyan("\n🧪 Testing API Connection\n"));
    console.log(`  Provider: ${config.provider}`);
    console.log(`  Model:    ${config.model}`);
    console.log();

    const spinner = ora.default("Sending test request...").start();

    try {
      const response = await runLLM(
        "Say 'KESMO connection successful!' in exactly those words.",
      );
      spinner.succeed("API connection successful!");
      console.log(chalk.green("\n✅ Response received:"));
      console.log(chalk.dim(response.slice(0, 200)));
      console.log(
        chalk.green("\n🎉 Your configuration is working correctly!\n"),
      );
    } catch (error) {
      spinner.fail("API connection failed");
      console.log(
        chalk.red(
          `\n❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
      console.log(chalk.yellow("\nTroubleshooting:"));
      console.log(chalk.dim("  • Check your API key is correct"));
      console.log(
        chalk.dim("  • Verify the model name is valid for your provider"),
      );
      console.log(chalk.dim("  • Ensure you have API credits/quota available"));
      console.log(
        chalk.dim("  • Run `kesmo config --update` to reconfigure\n"),
      );
      process.exit(1);
    }
  });

program
  .command("reset")
  .description("Reset KESMO configuration")
  .action(async () => {
    const { deleteConfig, configExists } =
      await import("../src/utils/config.js");
    const inquirer = await import("inquirer");

    if (!configExists()) {
      console.log(chalk.yellow("No configuration found."));
      return;
    }

    const { confirm } = (await inquirer.default.prompt({
      type: "confirm",
      name: "confirm",
      message: "Are you sure you want to reset the configuration?",
      default: false,
    })) as { confirm: boolean };

    if (confirm) {
      deleteConfig();
      console.log(
        chalk.green("✅ Configuration deleted. Run `kesmo` to set up again."),
      );
    }
  });

process.on("unhandledRejection", (error) => {
  console.log(
    chalk.red(
      `\n❌ Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`,
    ),
  );
  process.exit(1);
});

program.parse();
