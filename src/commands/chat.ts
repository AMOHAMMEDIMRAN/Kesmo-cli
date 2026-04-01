import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { configExists } from "../utils/config.js";
import { scanFiles } from "../core/scanner/scanner.js";
import { runLLM } from "../core/provider/index.js";
import { enforceTokenLimit } from "../core/tokenLimiter.js";
import { loadPlugins } from "../core/agents/loader.js";
import {
  selectToolsetPlugins,
  buildToolsetPrompt,
  shouldUseToolset,
} from "../core/agents/toolset.js";
import type { Plugin } from "../types.js";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

interface SessionState {
  id: string;
  startedAt: string;
  updatedAt: string;
  history: ChatTurn[];
  todos: TodoItem[];
  includeContext: boolean;
  toolsetEnabled: boolean;
  reasoningEnabled: boolean;
  streamEnabled: boolean;
  agentMode: boolean;
  autoApproveActions: boolean;
}

interface ChatOptions {
  maxFiles?: number;
  context?: boolean;
  maxTools?: number;
  toolset?: boolean;
  reasoning?: boolean;
  stream?: boolean;
  session?: string;
  newSession?: boolean;
  legacy?: boolean;
  opentuiRuntime?: boolean;
}

interface ChatState {
  sessionId?: string;
  includeContext: boolean;
  toolsetEnabled: boolean;
  reasoningEnabled: boolean;
  streamEnabled: boolean;
  agentMode?: boolean;
  autoApproveActions?: boolean;
  contextFiles: Array<{ path: string; content: string }>;
  history: ChatTurn[];
  todos?: TodoItem[];
  pendingApprovals?: number;
  startedAt: Date;
}

interface PendingFileSuggestion {
  filePath: string;
  content: string;
}

interface ActionPlan {
  summary?: string;
  actions: ToolAction[];
}

type ToolAction =
  | { type: "read_file"; path: string }
  | { type: "write_file"; path: string; content: string }
  | { type: "replace_in_file"; path: string; find: string; replace: string }
  | { type: "delete_file"; path: string };

const CHAT_BANNER = `
${chalk.cyan("██╗  ██╗███████╗███████╗███╗   ███╗ ██████╗ ")}
${chalk.cyan("██║ ██╔╝██╔════╝██╔════╝████╗ ████║██╔═══██╗")}
${chalk.cyan("█████╔╝ █████╗  ███████╗██╔████╔██║██║   ██║")}
${chalk.cyan("██╔═██╗ ██╔══╝  ╚════██║██║╚██╔╝██║██║   ██║")}
${chalk.cyan("██║  ██╗███████╗███████║██║ ╚═╝ ██║╚██████╔╝")}
${chalk.cyan("╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ")}
${chalk.dim("            KESMO Chat TUI")}
`;

const SESSION_DIR = path.join(process.cwd(), ".kesmo", "sessions");

function printHelp(): void {
  console.log(chalk.bold.white("Slash Commands:"));
  console.log(chalk.gray("  /help      ") + chalk.dim("Show command help"));
  console.log(chalk.gray("  /clear     ") + chalk.dim("Clear chat history"));
  console.log(
    chalk.gray("  /context   ") + chalk.dim("Toggle project context on/off"),
  );
  console.log(
    chalk.gray("  /files     ") + chalk.dim("Show indexed context files"),
  );
  console.log(
    chalk.gray("  /reindex   ") +
      chalk.dim("Re-scan project files for context"),
  );
  console.log(
    chalk.gray("  /status    ") + chalk.dim("Show current chat status"),
  );
  console.log(
    chalk.gray("  /tools     ") +
      chalk.dim("Show active JSON tools for last turn"),
  );
  console.log(
    chalk.gray("  /toolset   ") + chalk.dim("Toggle JSON toolset mode on/off"),
  );
  console.log(
    chalk.gray("  /fast      ") +
      chalk.dim("Trim history for faster responses"),
  );
  console.log(
    chalk.gray("  /reasoning ") + chalk.dim("Toggle reasoning mode on/off"),
  );
  console.log(
    chalk.gray("  /stream    ") +
      chalk.dim("Toggle streamed response rendering"),
  );
  console.log(
    chalk.gray("  /apply     ") +
      chalk.dim("Apply last generated file to disk"),
  );
  console.log(
    chalk.gray("  /agent     ") +
      chalk.dim("Toggle agent file-actions mode on/off"),
  );
  console.log(
    chalk.gray("  /autoapply ") +
      chalk.dim("Toggle auto-approve for file actions and /apply writes"),
  );
  console.log(
    chalk.gray("  /todo      ") +
      chalk.dim("Manage todos: list | add <text> | done <id> | clear"),
  );
  console.log(
    chalk.gray("  /session   ") + chalk.dim("Show current session info"),
  );
  console.log(
    chalk.gray("  /sessions  ") + chalk.dim("List recent saved sessions"),
  );
  console.log(
    chalk.gray("  /approvals ") + chalk.dim("Show pending approval count"),
  );
  console.log(
    chalk.gray("  /save      ") + chalk.dim("Save chat transcript to logs"),
  );
  console.log(
    chalk.gray("  /new       ") + chalk.dim("Start a fresh chat session"),
  );
  console.log(chalk.gray("  /exit      ") + chalk.dim("Exit chat"));
  console.log();
}

function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function createSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = Math.random().toString(36).slice(2, 8);
  return `session_${stamp}_${nonce}`;
}

function getSessionPath(sessionId: string): string {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

function saveSession(session: SessionState): string {
  ensureSessionDir();
  const payload: SessionState = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  const filePath = getSessionPath(payload.id);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
}

function loadSession(sessionId: string): SessionState | null {
  ensureSessionDir();
  const filePath = getSessionPath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.id !== "string" ||
      !Array.isArray(parsed.history)
    ) {
      return null;
    }
    return {
      id: parsed.id,
      startedAt:
        typeof parsed.startedAt === "string"
          ? parsed.startedAt
          : new Date().toISOString(),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
      history: parsed.history.filter(
        (turn): turn is ChatTurn =>
          Boolean(turn) &&
          typeof turn === "object" &&
          (turn.role === "user" || turn.role === "assistant") &&
          typeof turn.content === "string",
      ),
      todos: Array.isArray(parsed.todos)
        ? parsed.todos.filter(
            (todo): todo is TodoItem =>
              Boolean(todo) &&
              typeof todo === "object" &&
              typeof todo.id === "number" &&
              typeof todo.text === "string" &&
              typeof todo.done === "boolean",
          )
        : [],
      includeContext: Boolean(parsed.includeContext ?? true),
      toolsetEnabled: Boolean(parsed.toolsetEnabled ?? true),
      reasoningEnabled: Boolean(parsed.reasoningEnabled),
      streamEnabled: Boolean(parsed.streamEnabled ?? true),
      agentMode: Boolean(parsed.agentMode ?? true),
      autoApproveActions: Boolean(parsed.autoApproveActions),
    };
  } catch {
    return null;
  }
}

function listRecentSessions(limit = 10): SessionState[] {
  ensureSessionDir();
  const files = fs
    .readdirSync(SESSION_DIR)
    .filter((file) => file.endsWith(".json"));

  const sessions: SessionState[] = [];
  for (const file of files) {
    const sessionId = file.replace(/\.json$/, "");
    const loaded = loadSession(sessionId);
    if (loaded) {
      sessions.push(loaded);
    }
  }

  return sessions
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(1, limit));
}

function getNextTodoId(todos: TodoItem[]): number {
  if (todos.length === 0) {
    return 1;
  }
  return Math.max(...todos.map((t) => t.id)) + 1;
}

function printTodos(todos: TodoItem[]): void {
  console.log(chalk.bold.white("Todos:"));
  if (todos.length === 0) {
    console.log(chalk.dim("  (empty)"));
    console.log();
    return;
  }
  for (const todo of todos) {
    const status = todo.done ? chalk.green("[x]") : chalk.yellow("[ ]");
    console.log(`${chalk.gray("  " + todo.id + ".")} ${status} ${todo.text}`);
  }
  console.log();
}

function printDivider(): void {
  console.log(chalk.dim("─".repeat(72)));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function padRight(text: string, width: number): string {
  const clean = stripAnsi(text);
  if (clean.length >= width) {
    return text;
  }
  return text + " ".repeat(width - clean.length);
}

function truncatePlain(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }
  if (width <= 1) {
    return text.slice(0, width);
  }
  return text.slice(0, width - 1) + "…";
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) {
    return [""];
  }
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) {
      lines.push("");
      continue;
    }
    let rest = line;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(" ", width);
      const idx = cut > Math.floor(width * 0.5) ? cut : width;
      lines.push(rest.slice(0, idx).trimEnd());
      rest = rest.slice(idx).trimStart();
    }
    lines.push(rest);
  }
  return lines;
}

function renderPanel(
  title: string,
  mainLines: string[],
  sidebarLines: string[] = [],
): void {
  const totalWidth = Math.max(90, output.columns || 120);
  const contentWidth = totalWidth - 4;
  const sidebarWidth = Math.max(30, Math.floor(contentWidth * 0.3));
  const mainWidth = contentWidth - sidebarWidth - 3;

  const top = `┌${"─".repeat(contentWidth)}┐`;
  const mid = `├${"─".repeat(mainWidth + 1)}┬${"─".repeat(sidebarWidth + 1)}┤`;
  const bottom = `└${"─".repeat(contentWidth)}┘`;

  console.log(chalk.dim(top));
  const titleText = chalk.bold.white(` ${title} `);
  console.log(chalk.dim("│") + padRight(titleText, contentWidth) + chalk.dim("│"));
  console.log(chalk.dim(mid));

  const left = mainLines.flatMap((line) => wrapText(line, mainWidth));
  const right = sidebarLines.flatMap((line) => wrapText(line, sidebarWidth));
  const rows = Math.max(left.length, right.length, 1);

  for (let i = 0; i < rows; i++) {
    const mainCell = padRight(left[i] ?? "", mainWidth);
    const sideCell = padRight(right[i] ?? "", sidebarWidth);
    console.log(
      chalk.dim("│") +
        ` ${mainCell} ` +
        chalk.dim("│") +
        ` ${sideCell} ` +
        chalk.dim("│"),
    );
  }

  console.log(chalk.dim(bottom));
}

function buildSidebar(state: ChatState): string[] {
  const todoPending = (state.todos ?? []).filter((todo) => !todo.done).length;
  return [
    chalk.cyan("Session"),
    `ID: ${state.sessionId ?? "(ephemeral)"}`,
    `Msgs: ${state.history.length}`,
    `Todos: ${todoPending}`,
    `Approvals: ${state.pendingApprovals ?? 0}`,
    "",
    chalk.cyan("Modes"),
    `Context: ${state.includeContext ? "ON" : "OFF"}`,
    `Toolset: ${state.toolsetEnabled ? "ON" : "OFF"}`,
    `Reason: ${state.reasoningEnabled ? "ON" : "OFF"}`,
    `Stream: ${state.streamEnabled ? "ON" : "OFF"}`,
    `Agent: ${state.agentMode ? "ON" : "OFF"}`,
    `Auto: ${state.autoApproveActions ? "ON" : "OFF"}`,
    "",
    chalk.cyan("Workspace"),
    `Files: ${state.contextFiles.length}`,
    `Uptime: ${formatDuration(state.startedAt)}`,
  ];
}

function buildConversationLines(history: ChatTurn[], width: number): string[] {
  const turns = history.slice(-12);
  const lines: string[] = [];
  for (const turn of turns) {
    const prefix = turn.role === "user" ? "You" : "Kesmo";
    const header = `${prefix}:`;
    lines.push(chalk.bold(turn.role === "user" ? chalk.blue(header) : chalk.magenta(header)));
    const wrapped = wrapText(turn.content, width).slice(0, 8);
    for (const line of wrapped) {
      lines.push(`  ${truncatePlain(line, width - 2)}`);
    }
    lines.push("");
  }
  if (lines.length === 0) {
    lines.push(chalk.dim("No messages yet. Ask for edits, scans, or docs updates."));
  }
  return lines;
}

function renderConversationScreen(state: ChatState): void {
  if (!output.isTTY) {
    return;
  }
  console.clear();
  const sidebar = buildSidebar(state);
  const main = [
    chalk.bold.white("KESMO Workspace"),
    chalk.dim("Slash commands: /help  /todo  /session  /approvals (diff approval via prompts)"),
    "",
    ...buildConversationLines(state.history, Math.max(40, Math.floor((output.columns || 120) * 0.62))),
  ];
  renderPanel("Chat", main, sidebar);
}

function printHeader(state: ChatState): void {
  renderConversationScreen(state);
  if (!output.isTTY) {
    const sidebar = buildSidebar(state);
    renderPanel(
      "KESMO Chat",
      [
        chalk.bold.white("Conversation"),
        "Type your request naturally. Use /help for commands.",
        "Use /todo to track tasks, /sessions to inspect history.",
        "Approval prompts show a diff and ask for y/n/a/q.",
      ],
      sidebar,
    );
  }
}

function printMessage(role: "user" | "assistant", content: string): void {
  const title = role === "user" ? "You" : "Kesmo";
  const accent =
    role === "user" ? chalk.blue("USER") : chalk.magenta("ASSISTANT");
  renderPanel(`${title} Message`, [chalk.bold(accent), content]);
}

async function printMessageStreamed(content: string): Promise<void> {
  output.write(chalk.bgMagenta.black(" KESMO ") + " " + chalk.white(content));
  output.write("\n\n");
}

function extractFirstCodeBlockContent(response: string): string | null {
  const codeMatch = response.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  if (!codeMatch?.[1]) {
    return null;
  }
  return codeMatch[1].trimEnd() + "\n";
}

function inferRequestedFilePath(message: string): string | null {
  const quoted = message.match(/[`"']([./a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)[`"']/);
  const inline = message.match(/\b([./a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)\b/);
  const candidate = quoted?.[1] ?? inline?.[1];
  if (!candidate) {
    return null;
  }
  const filePath = candidate.trim();
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return null;
  }
  return filePath;
}

function extractFileSuggestionFromResponse(
  response: string,
): PendingFileSuggestion | null {
  const codeContent = extractFirstCodeBlockContent(response);
  if (!codeContent) {
    return null;
  }

  const explicitPath = response.match(
    /(?:^|\n)(?:file|path|filename)\s*:\s*`?([./a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)`?/i,
  );
  const actionPath = response.match(
    /(?:save (?:it|this|the file)? to|write (?:it|this|the file)? to|create (?:a )?file(?: named)?|put (?:it|this) in)\s+`?([./a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)`?/i,
  );

  const detected = explicitPath?.[1] ?? actionPath?.[1];
  if (!detected) {
    return null;
  }

  const filePath = detected.trim();
  if (filePath.includes("..") || path.isAbsolute(filePath)) {
    return null;
  }

  return {
    filePath,
    content: codeContent,
  };
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found");
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function parseActionPlan(raw: string): ActionPlan {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<ActionPlan>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.actions)) {
    throw new Error("Invalid action plan schema");
  }

  const actions: ToolAction[] = [];
  for (const action of parsed.actions as Array<Record<string, unknown>>) {
    if (
      !action ||
      typeof action !== "object" ||
      typeof action.type !== "string"
    ) {
      continue;
    }

    if (action.type === "read_file" && typeof action.path === "string") {
      actions.push({ type: "read_file", path: action.path });
      continue;
    }
    if (
      action.type === "write_file" &&
      typeof action.path === "string" &&
      typeof action.content === "string"
    ) {
      actions.push({
        type: "write_file",
        path: action.path,
        content: action.content,
      });
      continue;
    }
    if (
      action.type === "replace_in_file" &&
      typeof action.path === "string" &&
      typeof action.find === "string" &&
      typeof action.replace === "string"
    ) {
      actions.push({
        type: "replace_in_file",
        path: action.path,
        find: action.find,
        replace: action.replace,
      });
      continue;
    }
    if (action.type === "delete_file" && typeof action.path === "string") {
      actions.push({ type: "delete_file", path: action.path });
      continue;
    }
  }

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    actions,
  };
}

function resolveWorkspaceFilePath(filePath: string): string {
  const normalized = filePath.trim().replace(/^\.\//, "");
  const fullPath = path.resolve(process.cwd(), normalized);
  const workspaceRoot = path.resolve(process.cwd()) + path.sep;
  if (!fullPath.startsWith(workspaceRoot)) {
    throw new Error(`Refusing to access outside workspace: ${filePath}`);
  }
  return fullPath;
}

function colorDiffLine(line: string): string {
  if (line.startsWith("+")) {
    return chalk.green(line);
  }
  if (line.startsWith("-")) {
    return chalk.red(line);
  }
  if (line.startsWith("@@")) {
    return chalk.cyan(line);
  }
  return chalk.dim(line);
}

function buildUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
  maxLines = 220,
): string[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    beforeLines[endBefore] === afterLines[endAfter]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const context = 3;
  const from = Math.max(0, start - context);
  const toBefore = Math.min(beforeLines.length - 1, endBefore + context);
  const toAfter = Math.min(afterLines.length - 1, endAfter + context);

  const diff: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${from + 1},${Math.max(0, toBefore - from + 1)} +${from + 1},${Math.max(0, toAfter - from + 1)} @@`,
  ];

  for (let i = from; i <= toBefore; i++) {
    if (i < start || i > endBefore) {
      diff.push(` ${beforeLines[i] ?? ""}`);
    } else {
      diff.push(`-${beforeLines[i] ?? ""}`);
    }
  }

  for (let i = start; i <= endAfter; i++) {
    diff.push(`+${afterLines[i] ?? ""}`);
  }

  const clipped = diff.slice(0, maxLines);
  if (diff.length > clipped.length) {
    clipped.push(`... truncated ${diff.length - clipped.length} more diff lines`);
  }
  return clipped;
}

function renderDiffPreview(title: string, diffLines: string[]): void {
  const colored = diffLines.map((line) => colorDiffLine(line));
  renderPanel(title, colored, [chalk.cyan("Approval"), "y = yes", "n = no", "a = all", "q = quit"]);
}

async function askApprovalWithDiff(
  ask: (question: string) => Promise<string>,
  actionLabel: string,
  diffLines: string[],
): Promise<"yes" | "no" | "all" | "quit"> {
  renderDiffPreview(`Review ${actionLabel}`, diffLines);
  const raw = (await ask(chalk.yellow("Approve? [y]es / [n]o / [a]ll / [q]uit: ")))
    .trim()
    .toLowerCase();
  if (raw === "a" || raw === "all") {
    return "all";
  }
  if (raw === "q" || raw === "quit") {
    return "quit";
  }
  if (raw === "y" || raw === "yes") {
    return "yes";
  }
  return "no";
}

function buildActionPlannerPrompt(
  message: string,
  contextFiles: Array<{ path: string }>,
): string {
  const fileHints = contextFiles
    .slice(0, 60)
    .map((f) => f.path)
    .join("\n");

  const prompt = [
    "You are a tool planner for a coding CLI.",
    "Return ONLY JSON matching this schema:",
    '{"summary":"string","actions":[{"type":"read_file|write_file|replace_in_file|delete_file","path":"string","content":"string?","find":"string?","replace":"string?"}]}',
    "Rules:",
    "- Use relative paths only.",
    "- For write_file, include full desired file content in content.",
    "- For replace_in_file, find must be exact and unique.",
    "- If no tool actions are needed, return actions as empty array.",
    "- No markdown. No prose outside JSON.",
    "Known files:",
    fileHints || "(none)",
    "User request:",
    message,
  ].join("\n\n");

  return enforceTokenLimit(prompt, 2600);
}

function mightNeedToolActions(message: string): boolean {
  return /\b(create|make|write|edit|update|modify|change|delete|remove|read|open|refactor|rename)\b/i.test(
    message,
  );
}

async function executeActionPlan(
  plan: ActionPlan,
  ask: (question: string) => Promise<string>,
  autoApprove: boolean,
): Promise<{ logs: string[]; autoApprove: boolean; aborted: boolean }> {
  const logs: string[] = [];
  let approveAll = autoApprove;
  let aborted = false;

  for (const action of plan.actions) {
    const actionName = `${action.type} ${action.path}`;
    try {
      if (action.type === "read_file") {
        const fullPath = resolveWorkspaceFilePath(action.path);
        const content = fs.readFileSync(fullPath, "utf-8");
        const preview = content.slice(0, 600);
        logs.push(`Read ${action.path} (${content.length} chars)`);
        logs.push(
          `Preview: ${preview.replace(/\n/g, " ")}${content.length > preview.length ? " ..." : ""}`,
        );
        continue;
      }

      if (!approveAll) {
        let before = "";
        let after = "";
        if (action.type === "write_file") {
          const fullPath = resolveWorkspaceFilePath(action.path);
          before = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf-8") : "";
          after = action.content;
        }
        if (action.type === "replace_in_file") {
          const fullPath = resolveWorkspaceFilePath(action.path);
          before = fs.readFileSync(fullPath, "utf-8");
          after = before.replace(action.find, action.replace);
        }
        if (action.type === "delete_file") {
          const fullPath = resolveWorkspaceFilePath(action.path);
          before = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf-8") : "";
          after = "";
        }

        const diff = buildUnifiedDiff(action.path, before, after);
        const decision = await askApprovalWithDiff(ask, actionName, diff);
        if (decision === "quit") {
          logs.push("User aborted remaining actions.");
          aborted = true;
          break;
        }
        if (decision === "all") {
          approveAll = true;
        }
        if (decision === "no") {
          logs.push(`Skipped ${actionName}`);
          continue;
        }
      }

      if (action.type === "write_file") {
        const fullPath = resolveWorkspaceFilePath(action.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, action.content, "utf-8");
        logs.push(`Wrote ${action.path}`);
        continue;
      }

      if (action.type === "replace_in_file") {
        const fullPath = resolveWorkspaceFilePath(action.path);
        const source = fs.readFileSync(fullPath, "utf-8");
        const matches = source.split(action.find).length - 1;
        if (matches === 0) {
          logs.push(`Skipped replace in ${action.path}: find text not found`);
          continue;
        }
        if (matches > 1) {
          logs.push(
            `Skipped replace in ${action.path}: ambiguous find (${matches} matches)`,
          );
          continue;
        }
        fs.writeFileSync(
          fullPath,
          source.replace(action.find, action.replace),
          "utf-8",
        );
        logs.push(`Updated ${action.path}`);
        continue;
      }

      if (action.type === "delete_file") {
        const fullPath = resolveWorkspaceFilePath(action.path);
        if (!fs.existsSync(fullPath)) {
          logs.push(`Skipped delete ${action.path}: not found`);
          continue;
        }
        fs.unlinkSync(fullPath);
        logs.push(`Deleted ${action.path}`);
      }
    } catch (error) {
      logs.push(
        `Failed ${actionName}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return { logs, autoApprove: approveAll, aborted };
}

function formatDuration(startedAt: Date): string {
  const seconds = Math.max(
    1,
    Math.floor((Date.now() - startedAt.getTime()) / 1000),
  );
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem}s`;
}

function saveTranscript(history: ChatTurn[]): string {
  const logsDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const filename = `chat_${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  const fullPath = path.join(logsDir, filename);

  const lines = ["# KESMO Chat Transcript", ""];
  for (const turn of history) {
    const speaker = turn.role === "user" ? "User" : "KESMO";
    lines.push(`## ${speaker}`);
    lines.push(turn.content);
    lines.push("");
  }

  fs.writeFileSync(fullPath, lines.join("\n"), "utf-8");
  return fullPath;
}

function buildProjectContext(
  files: Array<{ path: string; content: string }>,
  maxChars = 12000,
): string {
  if (files.length === 0) {
    return "";
  }

  let context = "# Project Context\n";
  for (const file of files) {
    const snippet = file.content.slice(0, 2500);
    const section = `\n## ${file.path}\n\`\`\`\n${snippet}\n\`\`\`\n`;
    if ((context + section).length > maxChars) {
      break;
    }
    context += section;
  }

  return enforceTokenLimit(context, 2500);
}

function buildPrompt(
  history: ChatTurn[],
  projectContext: string,
  includeContext: boolean,
  toolsetPrompt: string,
  reasoningEnabled: boolean,
): string {
  const recentHistory = history.slice(-6);
  const historyText = recentHistory
    .map(
      (turn) =>
        `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`,
    )
    .join("\n\n");

  const contextBlock =
    includeContext && projectContext ? `\n\n${projectContext}` : "";
  const toolsetBlock = toolsetPrompt ? `\n\n${toolsetPrompt}` : "";

  const prompt = [
    "You are KESMO Chat, an expert coding assistant.",
    "Give practical, concise answers with direct implementation guidance.",
    "Prefer low-token responses unless user requests deep detail.",
    "Do not repeat large code blocks unless needed.",
    reasoningEnabled
      ? "Reasoning mode is ON: perform deep analysis internally and provide a concise final answer."
      : "Reasoning mode is OFF: keep responses short and direct.",
    "When user asks to create/update a file, ALWAYS include: first line 'File: <relative/path.ext>' then one complete code block only.",
    toolsetBlock,
    contextBlock,
    historyText ? `\nConversation so far:\n${historyText}` : "",
    "Assistant:",
  ].join("\n");

  return enforceTokenLimit(prompt, 4200);
}

async function scanContextFiles(
  maxFiles: number,
): Promise<Array<{ path: string; content: string }>> {
  const scanned = await scanFiles();
  return scanned.slice(0, Math.max(1, maxFiles));
}

export const chatCommand = new Command("chat")
  .description("Open interactive TUI chat interface")
  .option(
    "--max-files <number>",
    "Max files to include in context",
    parseInt,
    5,
  )
  .option(
    "--max-tools <number>",
    "Max JSON tools to activate per turn",
    parseInt,
    3,
  )
  .option("--no-context", "Start chat without project context")
  .option("--no-toolset", "Disable JSON toolset routing")
  .option("--reasoning", "Enable reasoning mode")
  .option("--no-stream", "Disable streamed response rendering")
  .option("--session <id>", "Resume a specific session id")
  .option("--new-session", "Start a new session without resuming")
  .option("--legacy", "Use legacy chat mode")
  .option("--opentui-runtime", "Internal OpenTUI runtime flag")
  .action(async (options: ChatOptions) => {
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

    const maxFiles = Number.isFinite(options.maxFiles)
      ? Math.max(1, Number(options.maxFiles))
      : 5;
    const maxTools = Number.isFinite(options.maxTools)
      ? Math.max(1, Number(options.maxTools))
      : 3;

    if (!options.legacy) {
      const runningInBun = Boolean((globalThis as { Bun?: unknown }).Bun);
      if (!runningInBun && !options.opentuiRuntime) {
        const entry = path.resolve(process.argv[1] ?? "dist/bin/kesmo.js");
        const args = [entry, "chat", "--opentui-runtime"];
        if (options.maxFiles) {
          args.push("--max-files", String(options.maxFiles));
        }
        if (options.maxTools) {
          args.push("--max-tools", String(options.maxTools));
        }
        if (options.context === false) {
          args.push("--no-context");
        }
        if (options.toolset === false) {
          args.push("--no-toolset");
        }

        await new Promise<void>((resolve, reject) => {
          const child = spawn("bun", args, {
            cwd: process.cwd(),
            stdio: "inherit",
            env: process.env,
          });

          child.on("error", (error) => {
            reject(
              new Error(
                `Failed to start Bun OpenTUI runtime: ${error.message}. Install Bun or run 'kesmo chat --legacy'.`,
              ),
            );
          });

          child.on("exit", (code) => {
            if (code === 0) {
              resolve();
              return;
            }
            reject(
              new Error(
                `OpenTUI runtime exited with code ${code}. Use 'kesmo chat --legacy' as fallback.`,
              ),
            );
          });
        });
        return;
      }

      const { runOpenTuiChat } = await import("./chatOpenTui.js");
      await runOpenTuiChat({
        maxFiles,
        maxTools,
        includeContext: options.context ?? true,
        toolsetEnabled: options.toolset ?? true,
      });
      return;
    }

    console.clear();
    console.log(CHAT_BANNER);
    printHelp();

    const indexSpinner = ora("Indexing project context...").start();
    let contextFiles: Array<{ path: string; content: string }> = [];
    try {
      contextFiles = await scanContextFiles(maxFiles);
      indexSpinner.succeed(`Indexed ${contextFiles.length} files for context`);
    } catch (error) {
      indexSpinner.fail(
        "Context indexing failed; continuing without project context",
      );
      if (error instanceof Error) {
        console.log(chalk.dim(error.message));
      }
    }

    let sessionId = options.session?.trim() || "";
    let includeContext = options.context ?? true;
    let toolsetEnabled = options.toolset ?? true;
    let reasoningEnabled = Boolean(options.reasoning);
    let streamEnabled = options.stream ?? false;
    let agentMode = true;
    let autoApproveActions = false;
    let projectContext = buildProjectContext(contextFiles);
    const history: ChatTurn[] = [];
    let todos: TodoItem[] = [];
    let startedAt = new Date();
    const responseCache = new Map<string, string>();
    const availableTools: Plugin[] = loadPlugins();
    let activeTools: Plugin[] = [];
    let pendingFileSuggestion: PendingFileSuggestion | null = null;
    let pendingApprovals = 0;
    let lastRequestedFilePath: string | null = null;

    if (!options.newSession) {
      const resume = sessionId
        ? loadSession(sessionId)
        : listRecentSessions(1)[0] ?? null;
      if (resume) {
        sessionId = resume.id;
        history.push(...resume.history);
        todos = resume.todos;
        includeContext = options.context ?? resume.includeContext;
        toolsetEnabled = options.toolset ?? resume.toolsetEnabled;
        reasoningEnabled = options.reasoning
          ? true
          : resume.reasoningEnabled;
        streamEnabled = options.stream ?? resume.streamEnabled;
        agentMode = resume.agentMode;
        autoApproveActions = resume.autoApproveActions;
        startedAt = new Date(resume.startedAt);
        console.log(
          chalk.green("✓ Resumed session: ") +
            chalk.cyan(sessionId) +
            chalk.dim(` (${history.length} messages)`),
        );
      }
    }

    if (!sessionId) {
      sessionId = createSessionId();
      console.log(chalk.green("✓ Started session: ") + chalk.cyan(sessionId));
    }

    const persistSession = (): void => {
      saveSession({
        id: sessionId,
        startedAt: startedAt.toISOString(),
        updatedAt: new Date().toISOString(),
        history,
        todos,
        includeContext,
        toolsetEnabled,
        reasoningEnabled,
        streamEnabled,
        agentMode,
        autoApproveActions,
      });
    };

    const renderHeader = (): void => {
      printHeader({
        sessionId,
        includeContext,
        toolsetEnabled,
        reasoningEnabled,
        streamEnabled,
        agentMode,
        autoApproveActions,
        contextFiles,
        history,
        todos,
        pendingApprovals,
        startedAt,
      });
    };

    persistSession();
    renderHeader();

    const rl = createInterface({ input, output });

    try {
      while (true) {
        const raw = await rl.question(chalk.cyan("kesmo chat > "));
        const message = raw.trim();

        if (!message) {
          continue;
        }

        if (message === "/exit" || message === "/quit") {
          persistSession();
          console.log(chalk.gray("Ending chat session."));
          break;
        }

        if (message === "/help") {
          printHelp();
          continue;
        }

        if (message === "/clear") {
          history.length = 0;
          console.log(chalk.green("✓ Chat history cleared."));
          persistSession();
          renderHeader();
          continue;
        }

        if (message === "/context") {
          includeContext = !includeContext;
          console.log(
            chalk.green("✓ Project context ") +
              chalk.white(includeContext ? "enabled" : "disabled"),
          );
          persistSession();
          renderHeader();
          continue;
        }

        if (message === "/toolset") {
          toolsetEnabled = !toolsetEnabled;
          console.log(
            chalk.green("✓ JSON toolset ") +
              chalk.white(toolsetEnabled ? "enabled" : "disabled"),
          );
          persistSession();
          renderHeader();
          continue;
        }

        if (message === "/reasoning") {
          reasoningEnabled = !reasoningEnabled;
          console.log(
            chalk.green("✓ Reasoning mode ") +
              chalk.white(reasoningEnabled ? "enabled" : "disabled"),
          );
          persistSession();
          renderHeader();
          continue;
        }

        if (message === "/stream") {
          streamEnabled = !streamEnabled;
          console.log(
            chalk.green("✓ Stream rendering ") +
              chalk.white(streamEnabled ? "enabled" : "disabled"),
          );
          persistSession();
          renderHeader();
          continue;
        }

        if (message === "/agent") {
          agentMode = !agentMode;
          console.log(
            chalk.green("✓ Agent mode ") +
              chalk.white(agentMode ? "enabled" : "disabled"),
          );
          persistSession();
          continue;
        }

        if (message === "/autoapply") {
          autoApproveActions = !autoApproveActions;
          console.log(
            chalk.green("✓ Auto-approve writes/actions ") +
              chalk.white(autoApproveActions ? "enabled" : "disabled"),
          );
          persistSession();
          continue;
        }

        if (message.startsWith("/todo")) {
          const args = message.slice(5).trim();
          if (!args || args === "list") {
            printTodos(todos);
            continue;
          }

          if (args === "clear") {
            todos = [];
            console.log(chalk.green("✓ Todos cleared."));
            persistSession();
            continue;
          }

          if (args.startsWith("add ")) {
            const text = args.slice(4).trim();
            if (!text) {
              console.log(chalk.yellow("Usage: /todo add <text>"));
              continue;
            }
            todos.push({ id: getNextTodoId(todos), text, done: false });
            console.log(chalk.green("✓ Todo added."));
            persistSession();
            continue;
          }

          if (args.startsWith("done ")) {
            const id = Number(args.slice(5).trim());
            if (!Number.isFinite(id)) {
              console.log(chalk.yellow("Usage: /todo done <id>"));
              continue;
            }
            const todo = todos.find((item) => item.id === id);
            if (!todo) {
              console.log(chalk.yellow(`Todo ${id} not found.`));
              continue;
            }
            todo.done = true;
            console.log(chalk.green(`✓ Todo ${id} marked done.`));
            persistSession();
            continue;
          }

          console.log(
            chalk.yellow("Todo usage: /todo list | /todo add <text> | /todo done <id> | /todo clear"),
          );
          continue;
        }

        if (message === "/session") {
          const sessionPath = getSessionPath(sessionId);
          console.log(chalk.bold.white("Session:"));
          console.log(chalk.gray("  ID:         ") + chalk.cyan(sessionId));
          console.log(
            chalk.gray("  Started:    ") + chalk.cyan(startedAt.toISOString()),
          );
          console.log(
            chalk.gray("  Updated:    ") + chalk.cyan(new Date().toISOString()),
          );
          console.log(chalk.gray("  File:       ") + chalk.dim(sessionPath));
          console.log(
            chalk.gray("  Messages:   ") + chalk.cyan(String(history.length)),
          );
          console.log(
            chalk.gray("  Open todos: ") +
              chalk.cyan(String(todos.filter((t) => !t.done).length)),
          );
          console.log();
          continue;
        }

        if (message === "/sessions") {
          const sessions = listRecentSessions(8);
          console.log(chalk.bold.white("Recent sessions:"));
          if (sessions.length === 0) {
            console.log(chalk.dim("  (none yet)"));
            console.log();
            continue;
          }
          for (const session of sessions) {
            console.log(
              chalk.gray("  - ") +
                chalk.white(session.id) +
                chalk.dim(
                  `  messages=${session.history.length} todos=${session.todos.filter((t) => !t.done).length} updated=${session.updatedAt}`,
                ),
            );
          }
          console.log();
          continue;
        }

        if (message === "/approvals") {
          console.log(chalk.bold.white("Approvals:"));
          console.log(
            chalk.gray("  Pending planned actions: ") +
              chalk.cyan(String(pendingApprovals)),
          );
          console.log(
            chalk.gray("  Pending generated file: ") +
              chalk.cyan(pendingFileSuggestion?.filePath ?? "none"),
          );
          console.log();
          continue;
        }

        if (message === "/files") {
          console.log(chalk.bold.white("Indexed files:"));
          if (contextFiles.length === 0) {
            console.log(chalk.dim("  (none)"));
          } else {
            const visible = contextFiles.slice(0, 20);
            for (const file of visible) {
              console.log(chalk.gray("  - ") + chalk.dim(file.path));
            }
            if (contextFiles.length > visible.length) {
              console.log(
                chalk.gray("  ... and ") +
                  chalk.cyan(String(contextFiles.length - visible.length)) +
                  chalk.gray(" more"),
              );
            }
          }
          console.log();
          continue;
        }

        if (message === "/status") {
          console.log(chalk.bold.white("Chat status:"));
          console.log(chalk.gray("  Session:       ") + chalk.cyan(sessionId));
          console.log(
            chalk.gray("  History turns: ") +
              chalk.cyan(String(history.length)),
          );
          console.log(
            chalk.gray("  Context files: ") +
              chalk.cyan(String(contextFiles.length)),
          );
          console.log(
            chalk.gray("  Context mode:  ") +
              chalk.cyan(includeContext ? "on" : "off"),
          );
          console.log(
            chalk.gray("  Toolset mode:  ") +
              chalk.cyan(toolsetEnabled ? "on" : "off"),
          );
          console.log(
            chalk.gray("  Reasoning:     ") +
              chalk.cyan(reasoningEnabled ? "on" : "off"),
          );
          console.log(
            chalk.gray("  Streaming:     ") +
              chalk.cyan(streamEnabled ? "on" : "off"),
          );
          console.log(
            chalk.gray("  Active tools:  ") +
              chalk.cyan(String(activeTools.length)),
          );
          console.log(
            chalk.gray("  Pending file:  ") +
              chalk.cyan(pendingFileSuggestion?.filePath ?? "none"),
          );
          console.log(
            chalk.gray("  Agent mode:    ") +
              chalk.cyan(agentMode ? "on" : "off"),
          );
          console.log(
            chalk.gray("  Auto-apply:    ") +
              chalk.cyan(autoApproveActions ? "on" : "off"),
          );
          console.log(
            chalk.gray("  Duration:      ") +
              chalk.cyan(formatDuration(startedAt)),
          );
          console.log(
            chalk.gray("  Open todos:    ") +
              chalk.cyan(String(todos.filter((todo) => !todo.done).length)),
          );
          console.log();
          continue;
        }

        if (message === "/tools") {
          console.log(chalk.bold.white("Active tools:"));
          if (activeTools.length === 0) {
            console.log(chalk.dim("  (none selected yet)"));
          } else {
            for (const tool of activeTools) {
              console.log(
                chalk.gray("  - ") +
                  chalk.white(tool.name) +
                  chalk.dim(` [${tool.id}] (${tool.category})`),
              );
            }
          }
          console.log();
          continue;
        }

        if (message === "/fast") {
          if (history.length > 6) {
            const compacted = history.slice(-6);
            history.length = 0;
            history.push(...compacted);
          }
          console.log(chalk.green("✓ Fast mode applied: history trimmed."));
          continue;
        }

        if (message === "/apply") {
          if (!pendingFileSuggestion) {
            console.log(chalk.yellow("No pending generated file to apply."));
            continue;
          }

          const fullPath = path.resolve(
            process.cwd(),
            pendingFileSuggestion.filePath,
          );
          const cwdRoot = path.resolve(process.cwd()) + path.sep;
          if (!fullPath.startsWith(cwdRoot)) {
            console.log(chalk.red("Refusing to write outside workspace."));
            pendingFileSuggestion = null;
            continue;
          }

          if (!autoApproveActions) {
            const before = fs.existsSync(fullPath)
              ? fs.readFileSync(fullPath, "utf-8")
              : "";
            const after = pendingFileSuggestion.content;
            const decision = await askApprovalWithDiff(
              (q) => rl.question(q),
              `write_file ${pendingFileSuggestion.filePath}`,
              buildUnifiedDiff(pendingFileSuggestion.filePath, before, after),
            );
            if (decision === "quit" || decision === "no") {
              console.log(chalk.gray("Apply cancelled."));
              continue;
            }
            if (decision === "all") {
              autoApproveActions = true;
            }
          }

          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, pendingFileSuggestion.content, "utf-8");
          console.log(
            chalk.green("✓ File written: ") +
              chalk.white(pendingFileSuggestion.filePath),
          );
          pendingFileSuggestion = null;
          pendingApprovals = 0;
          persistSession();
          renderHeader();
          continue;
        }

        if (message === "/reindex") {
          const spin = ora("Re-indexing project context...").start();
          try {
            contextFiles = await scanContextFiles(maxFiles);
            projectContext = buildProjectContext(contextFiles);
            spin.succeed(`Indexed ${contextFiles.length} files for context`);
            persistSession();
            renderHeader();
          } catch (error) {
            spin.fail("Re-index failed");
            if (error instanceof Error) {
              console.log(chalk.dim(error.message));
            }
          }
          continue;
        }

        if (message === "/save") {
          const transcriptPath = saveTranscript(history);
          console.log(
            chalk.green("✓ Transcript saved: ") + chalk.dim(transcriptPath),
          );
          console.log();
          persistSession();
          continue;
        }

        if (message === "/new") {
          sessionId = createSessionId();
          history.length = 0;
          todos = [];
          startedAt = new Date();
          pendingFileSuggestion = null;
          responseCache.clear();
          persistSession();
          console.clear();
          console.log(CHAT_BANNER);
          printHelp();
          renderHeader();
          continue;
        }

        history.push({ role: "user", content: message });
        lastRequestedFilePath = inferRequestedFilePath(message);
        persistSession();
        printMessage("user", message);

        if (agentMode && mightNeedToolActions(message)) {
          const plannerSpinner = ora("Planning file actions...").start();
          try {
            const plannerPrompt = buildActionPlannerPrompt(
              message,
              contextFiles,
            );
            const plannerRaw = await runLLM(plannerPrompt, {
              maxOutputTokens: 700,
              temperature: 0.1,
            });
            const plan = parseActionPlan(plannerRaw);

            if (plan.actions.length > 0) {
              pendingApprovals = plan.actions.length;
              renderHeader();
              plannerSpinner.succeed(
                `Planned ${plan.actions.length} action(s)${plan.summary ? `: ${plan.summary}` : ""}`,
              );

              const execution = await executeActionPlan(
                plan,
                (q) => rl.question(q),
                autoApproveActions,
              );
              autoApproveActions = execution.autoApprove;
              pendingApprovals = 0;

              const executionReport = [
                "Executed file actions:",
                ...execution.logs.map((line) => `- ${line}`),
              ].join("\n");

              history.push({ role: "assistant", content: executionReport });
              persistSession();
              printMessage("assistant", executionReport);

              // Refresh indexed context after writes/deletes.
              contextFiles = await scanContextFiles(maxFiles);
              projectContext = buildProjectContext(contextFiles);
              persistSession();
              renderHeader();
              if (execution.aborted) {
                continue;
              }
              continue;
            }

            plannerSpinner.stop();
          } catch (error) {
            plannerSpinner.fail(
              "Action planning failed; continuing with normal chat",
            );
            if (error instanceof Error) {
              console.log(chalk.dim(error.message));
            }
          }
        }

        activeTools = toolsetEnabled && shouldUseToolset(message)
          ? selectToolsetPlugins(availableTools, message, maxTools)
          : [];

        const toolsetPrompt = buildToolsetPrompt(activeTools, 700);
        const llmPrompt = buildPrompt(
          history,
          projectContext,
          includeContext,
          toolsetPrompt,
          reasoningEnabled,
        );
        const cacheKey = llmPrompt;

        if (responseCache.has(cacheKey)) {
          const cached = responseCache.get(cacheKey) || "";
          history.push({ role: "assistant", content: cached });
          persistSession();
          console.log(chalk.dim("(cached response)"));
          if (streamEnabled && output.isTTY) {
            await printMessageStreamed(cached);
          } else {
            printMessage("assistant", cached);
          }

          pendingFileSuggestion = extractFileSuggestionFromResponse(cached);
          if (!pendingFileSuggestion && lastRequestedFilePath) {
            const fallbackContent = extractFirstCodeBlockContent(cached);
            if (fallbackContent) {
              pendingFileSuggestion = {
                filePath: lastRequestedFilePath,
                content: fallbackContent,
              };
            }
          }
          if (pendingFileSuggestion) {
            pendingApprovals = Math.max(1, pendingApprovals);
            console.log(
              chalk.cyan("Detected file output: ") +
                chalk.white(pendingFileSuggestion.filePath) +
                chalk.dim(" (run /apply to write it)"),
            );
            if (autoApproveActions) {
              const fullPath = resolveWorkspaceFilePath(
                pendingFileSuggestion.filePath,
              );
              fs.mkdirSync(path.dirname(fullPath), { recursive: true });
              fs.writeFileSync(
                fullPath,
                pendingFileSuggestion.content,
                "utf-8",
              );
              console.log(
                chalk.green("✓ Auto-applied file: ") +
                  chalk.white(pendingFileSuggestion.filePath),
              );
              pendingFileSuggestion = null;
              pendingApprovals = 0;
            }
          }
          persistSession();
          renderHeader();
          continue;
        }

        const spinner = ora("Thinking...").start();
        try {
          const reply = await runLLM(llmPrompt, {
            reasoning: reasoningEnabled,
            maxOutputTokens: reasoningEnabled ? 1800 : 1000,
            temperature: reasoningEnabled ? 0.2 : 0.35,
          });
          spinner.stop();

          const answer = reply.trim();
          history.push({ role: "assistant", content: answer });
          responseCache.set(cacheKey, answer);
          persistSession();

          if (streamEnabled && output.isTTY) {
            await printMessageStreamed(answer);
          } else {
            printMessage("assistant", answer);
          }

          pendingFileSuggestion = extractFileSuggestionFromResponse(answer);
          if (!pendingFileSuggestion && lastRequestedFilePath) {
            const fallbackContent = extractFirstCodeBlockContent(answer);
            if (fallbackContent) {
              pendingFileSuggestion = {
                filePath: lastRequestedFilePath,
                content: fallbackContent,
              };
            }
          }
          if (pendingFileSuggestion) {
            pendingApprovals = Math.max(1, pendingApprovals);
            console.log(
              chalk.cyan("Detected file output: ") +
                chalk.white(pendingFileSuggestion.filePath) +
                chalk.dim(" (run /apply to write it)"),
            );
            if (autoApproveActions) {
              const fullPath = resolveWorkspaceFilePath(
                pendingFileSuggestion.filePath,
              );
              fs.mkdirSync(path.dirname(fullPath), { recursive: true });
              fs.writeFileSync(
                fullPath,
                pendingFileSuggestion.content,
                "utf-8",
              );
              console.log(
                chalk.green("✓ Auto-applied file: ") +
                  chalk.white(pendingFileSuggestion.filePath),
              );
              pendingFileSuggestion = null;
              pendingApprovals = 0;
            }
          }
          persistSession();
          renderHeader();
        } catch (error) {
          spinner.fail("Chat request failed");
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          console.log(chalk.red(errorMessage));
        }
      }
    } finally {
      persistSession();
      rl.close();
    }
  });
