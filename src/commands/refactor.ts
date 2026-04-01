import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { readFileSync } from "node:fs";
import { configExists } from "../utils/config.js";
import { scanFiles } from "../core/scanner/scanner.js";
import { runLLM } from "../core/provider/index.js";
import { loadPlugins } from "../core/agents/loader.js";
import {
  selectToolsetPlugins,
  buildToolsetPrompt,
} from "../core/agents/toolset.js";
import { enforceTokenLimit } from "../core/tokenLimiter.js";
import { parseEditPlan, applyEditPlan } from "../core/diff/diff.js";
import type { ScannedFile } from "../types.js";

interface RefactorOptions {
  file?: string;
  maxFiles?: number;
  maxTools?: number;
  yes?: boolean;
  dryRun?: boolean;
}

function buildRefactorPrompt(
  goal: string,
  files: ScannedFile[],
  toolsetPrompt: string,
): string {
  const fileBlocks = files
    .map((file) => {
      return `## FILE: ${file.path}\n\`\`\`\n${file.content.slice(0, 5000)}\n\`\`\``;
    })
    .join("\n\n");

  const prompt = [
    "You are an expert refactoring engine.",
    "Return ONLY valid JSON with this exact schema:",
    '{"summary":"string","notes":["string"],"edits":[{"action":"replace","file":"path","find":"exact text","replace":"new text","reason":"optional"}]}',
    "Rules:",
    "- Only use action=replace",
    "- file must match one of the provided FILE paths",
    "- find must be exact and unique in the file",
    "- keep edits minimal and safe",
    "- no markdown, no prose outside JSON",
    toolsetPrompt ? `\n${toolsetPrompt}` : "",
    `\nRefactor goal:\n${goal}`,
    "\nTarget files:\n" + fileBlocks,
  ].join("\n\n");

  return enforceTokenLimit(prompt, 7000);
}

async function gatherFiles(
  specificFile: string | undefined,
  maxFiles: number,
): Promise<ScannedFile[]> {
  if (specificFile) {
    const content = readFileSync(specificFile, "utf-8");
    return [{ path: specificFile, content }];
  }

  const scanned = await scanFiles();
  return scanned.slice(0, Math.max(1, maxFiles));
}

function printPlanSummary(
  summary: string,
  editsCount: number,
  dryRun: boolean,
): void {
  console.log();
  console.log(chalk.bold.white("Refactor Plan"));
  console.log(chalk.gray("  Summary: ") + chalk.white(summary));
  console.log(chalk.gray("  Edits:   ") + chalk.cyan(String(editsCount)));
  console.log(
    chalk.gray("  Mode:    ") + chalk.cyan(dryRun ? "dry-run" : "apply"),
  );
  console.log();
}

export const refactorCommand = new Command("refactor")
  .description("Generate and apply safe code refactors")
  .argument("<goal>", "Refactor goal in natural language")
  .option("-f, --file <path>", "Refactor a single file")
  .option("--max-files <number>", "Max files for context", parseInt, 6)
  .option(
    "--max-tools <number>",
    "Max JSON tool prompts to inject",
    parseInt,
    3,
  )
  .option("-y, --yes", "Skip confirmation prompts")
  .option("--dry-run", "Preview changes only (default)", true)
  .option("--apply", "Apply changes to files")
  .action(
    async (goal: string, options: RefactorOptions & { apply?: boolean }) => {
      if (!configExists()) {
        console.log(
          chalk.red("Error: ") + chalk.white("KESMO is not configured."),
        );
        console.log(
          chalk.gray("Run ") +
            chalk.cyan("kesmo") +
            chalk.gray(" first to set up."),
        );
        process.exit(1);
      }

      const dryRun = options.apply ? false : true;
      const maxFiles = Number.isFinite(options.maxFiles)
        ? Math.max(1, Number(options.maxFiles))
        : 6;
      const maxTools = Number.isFinite(options.maxTools)
        ? Math.max(1, Number(options.maxTools))
        : 3;

      const scanSpinner = ora("Preparing refactor context...").start();
      let files: ScannedFile[] = [];
      try {
        files = await gatherFiles(options.file, maxFiles);
        scanSpinner.succeed(`Loaded ${files.length} file(s)`);
      } catch (error) {
        scanSpinner.fail("Failed to load target files");
        throw error;
      }

      if (files.length === 0) {
        console.log(chalk.yellow("No files found to refactor."));
        return;
      }

      const plugins = loadPlugins();
      const selectedTools = selectToolsetPlugins(plugins, goal, maxTools);
      const toolsetPrompt = buildToolsetPrompt(selectedTools, 1000);

      const llmSpinner = ora("Generating refactor plan...").start();
      let rawResponse = "";
      try {
        const prompt = buildRefactorPrompt(goal, files, toolsetPrompt);
        rawResponse = await runLLM(prompt);
        llmSpinner.succeed("Refactor plan generated");
      } catch (error) {
        llmSpinner.fail("Failed to generate refactor plan");
        throw error;
      }

      let plan;
      try {
        plan = parseEditPlan(rawResponse);
      } catch (error) {
        console.log(chalk.red("Failed to parse model output as edit plan."));
        console.log(chalk.dim(rawResponse.slice(0, 1200)));
        throw error;
      }

      printPlanSummary(plan.summary, plan.edits.length, dryRun);

      if (!dryRun && !options.yes) {
        const { confirm } = (await inquirer.prompt({
          type: "confirm",
          name: "confirm",
          message: "Apply these changes to files?",
          default: false,
        })) as { confirm: boolean };

        if (!confirm) {
          console.log(chalk.yellow("Refactor cancelled."));
          return;
        }
      }

      const applyResult = applyEditPlan(plan, {
        dryRun,
        cwd: process.cwd(),
      });

      console.log(chalk.bold.white("Result"));
      console.log(
        chalk.gray("  Applied: ") +
          chalk.green(String(applyResult.applied.length)),
      );
      console.log(
        chalk.gray("  Skipped: ") +
          chalk.yellow(String(applyResult.skipped.length)),
      );
      console.log(
        chalk.gray("  Failed:  ") +
          chalk.red(String(applyResult.failed.length)),
      );
      console.log();

      if (applyResult.applied.length > 0) {
        console.log(chalk.bold.white("Applied/Planned edits:"));
        for (const item of applyResult.applied) {
          console.log(chalk.gray("- ") + chalk.white(item.file));
          if (item.reason) {
            console.log(chalk.dim(`  reason: ${item.reason}`));
          }
        }
        console.log();
      }

      if (applyResult.skipped.length > 0) {
        console.log(chalk.bold.yellow("Skipped:"));
        for (const item of applyResult.skipped) {
          console.log(
            chalk.gray("- ") +
              chalk.white(item.file) +
              chalk.dim(` (${item.reason})`),
          );
        }
        console.log();
      }

      if (applyResult.failed.length > 0) {
        console.log(chalk.bold.red("Failed:"));
        for (const item of applyResult.failed) {
          console.log(
            chalk.gray("- ") +
              chalk.white(item.file) +
              chalk.dim(` (${item.reason})`),
          );
        }
        console.log();
      }

      if (dryRun) {
        console.log(
          chalk.cyan("Dry-run complete. Re-run with --apply to write changes."),
        );
      } else {
        console.log(chalk.green("Refactor applied successfully."));
      }
    },
  );
