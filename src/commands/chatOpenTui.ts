import fs from "node:fs";
import path from "node:path";
import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { loadPlugins } from "../core/agents/loader.js";
import { runLLM } from "../core/provider/index.js";
import { scanFiles } from "../core/scanner/scanner.js";
import { enforceTokenLimit } from "../core/tokenLimiter.js";
import {
  buildToolsetPrompt,
  selectToolsetPlugins,
  shouldUseToolset,
} from "../core/agents/toolset.js";
import { loadConfig, saveConfig } from "../utils/config.js";
import { getSuggestedModels } from "../utils/setup.js";
import type { Plugin, ProviderType } from "../types.js";

interface OpenTuiOptions {
  maxFiles: number;
  maxTools: number;
  includeContext: boolean;
  toolsetEnabled: boolean;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface PendingFileSuggestion {
  filePath: string;
  content: string;
}

type ThemeName = "aurora" | "nord" | "solarized" | "graphite";

type ChatMode = "auto" | "build" | "plan";

const THEMES: Record<ThemeName, {
  appBg: string;
  panelBg: string;
  panelSoftBg: string;
  inputBg: string;
  border: string;
  borderFocus: string;
  text: string;
  muted: string;
  accent: string;
  accentWarm: string;
  success: string;
}> = {
  aurora: {
  appBg: "#0b1220",
  panelBg: "#111b2e",
  panelSoftBg: "#0f1727",
  inputBg: "#0d1626",
  border: "#2a3b5d",
  borderFocus: "#4cc9f0",
  text: "#e6edf9",
  muted: "#93a4c3",
  accent: "#4cc9f0",
  accentWarm: "#f4a261",
  success: "#2ec4b6",
  },
  nord: {
    appBg: "#2e3440",
    panelBg: "#3b4252",
    panelSoftBg: "#434c5e",
    inputBg: "#4c566a",
    border: "#81a1c1",
    borderFocus: "#88c0d0",
    text: "#eceff4",
    muted: "#d8dee9",
    accent: "#8fbcbb",
    accentWarm: "#ebcb8b",
    success: "#a3be8c",
  },
  solarized: {
    appBg: "#002b36",
    panelBg: "#073642",
    panelSoftBg: "#0b3a45",
    inputBg: "#0f3f4a",
    border: "#268bd2",
    borderFocus: "#2aa198",
    text: "#eee8d5",
    muted: "#93a1a1",
    accent: "#b58900",
    accentWarm: "#cb4b16",
    success: "#859900",
  },
  graphite: {
    appBg: "#0e0f12",
    panelBg: "#171a1f",
    panelSoftBg: "#1d2127",
    inputBg: "#14171c",
    border: "#3a414c",
    borderFocus: "#7aa2f7",
    text: "#e5e9f0",
    muted: "#9aa3b2",
    accent: "#7aa2f7",
    accentWarm: "#f7768e",
    success: "#9ece6a",
  },
};

const SLASH_COMMANDS = [
  "/help",
  "/clear",
  "/context",
  "/toolset",
  "/autoapply",
  "/apply",
  "/theme",
  "/mode",
  "/model",
  "/exit",
];

function extractCodeBlock(text: string): string | null {
  const match = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  return match?.[1] ? match[1].trimEnd() + "\n" : null;
}

function inferPath(text: string): string | null {
  const explicit = text.match(
    /(?:^|\n)(?:file|path|filename)\s*:\s*([./a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/i,
  );
  const quoted = text.match(/[`"']([./a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)[`"']/);
  const inline = text.match(/\b([./a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)\b/);
  const candidate = explicit?.[1] ?? quoted?.[1] ?? inline?.[1];
  if (!candidate || candidate.includes("..") || path.isAbsolute(candidate)) {
    return null;
  }
  return candidate;
}

function detectSuggestion(
  response: string,
  userMessage: string,
): PendingFileSuggestion | null {
  const content = extractCodeBlock(response);
  if (!content) {
    return null;
  }
  const filePath = inferPath(response) ?? inferPath(userMessage);
  if (!filePath) {
    return null;
  }
  return { filePath, content };
}

function buildPrompt(
  history: ChatTurn[],
  context: string,
  includeContext: boolean,
  toolsetPrompt: string,
  mode: ChatMode,
): string {
  const recent = history.slice(-6);
  const historyText = recent
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n\n");

  const prompt = [
    "You are KESMO Chat, a coding CLI assistant.",
    "Respond with concise, practical guidance.",
    mode === "plan"
      ? "Mode is PLAN: produce implementation plans, no file generation unless explicitly asked."
      : mode === "build"
        ? "Mode is BUILD: prioritize concrete code edits, runnable commands, and implementation output."
        : "Mode is AUTO: balance planning and implementation based on user intent.",
    "When creating/updating files ALWAYS output: File: <relative/path.ext> followed by a single complete code block.",
    toolsetPrompt ? `\n${toolsetPrompt}` : "",
    includeContext && context
      ? `\nProject Context:\n${enforceTokenLimit(context, mode === "plan" ? 1200 : 1800)}`
      : "",
    historyText ? `\nConversation:\n${historyText}` : "",
    "Assistant:",
  ].join("\n");

  return enforceTokenLimit(prompt, mode === "plan" ? 3600 : 4200);
}

function buildDiff(filePath: string, before: string, after: string): string {
  const left = before.split("\n");
  const right = after.split("\n");
  const max = Math.max(left.length, right.length);
  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (let i = 0; i < max; i++) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    if (l === r) {
      out.push(` ${l}`);
      continue;
    }
    if (l) {
      out.push(`-${l}`);
    }
    if (r) {
      out.push(`+${r}`);
    }
  }

  return out.slice(0, 220).join("\n");
}

export async function runOpenTuiChat(options: OpenTuiOptions): Promise<void> {
  let currentTheme: ThemeName = "aurora";
  let theme = THEMES[currentTheme];

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    screenMode: "alternate-screen",
    useMouse: true,
    autoFocus: true,
    backgroundColor: theme.appBg,
  });

  const root = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
    backgroundColor: theme.appBg,
  });
  renderer.root.add(root);

  const header = new BoxRenderable(renderer, {
    id: "header",
    width: "100%",
    height: 3,
    border: true,
    borderStyle: "single",
    title: " KESMO OpenTUI ",
    paddingX: 1,
    backgroundColor: theme.panelSoftBg,
    borderColor: theme.accent,
    focusedBorderColor: theme.borderFocus,
  });
  const headerText = new TextRenderable(renderer, {
    id: "header-text",
    content: "Chat | /help /apply /autoapply /context /toolset /mode /theme /model /clear /exit",
    fg: theme.text,
    bg: theme.panelSoftBg,
  });
  header.add(headerText);

  const body = new BoxRenderable(renderer, {
    id: "body",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 1,
  });

  const chatPanel = new BoxRenderable(renderer, {
    id: "chat-panel",
    width: "72%",
    height: "100%",
    border: true,
    title: " Conversation ",
    padding: 1,
    backgroundColor: theme.panelBg,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocus,
  });
  const chatScroll = new ScrollBoxRenderable(renderer, {
    id: "chat-scroll",
    width: "100%",
    height: "100%",
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
  });
  const chatText = new TextRenderable(renderer, {
    id: "chat-text",
    content: "KESMO: OpenTUI ready. Type /help to begin.",
    fg: theme.text,
    bg: theme.panelBg,
    wrapMode: "word",
  });
  chatScroll.add(chatText);
  chatPanel.add(chatScroll);

  const sidebar = new BoxRenderable(renderer, {
    id: "sidebar",
    width: "28%",
    height: "100%",
    border: true,
    title: " Sidebar ",
    padding: 1,
    backgroundColor: theme.panelSoftBg,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocus,
  });
  const sidebarText = new TextRenderable(renderer, {
    id: "sidebar-text",
    content: "Loading...",
    fg: theme.muted,
    bg: theme.panelSoftBg,
  });
  sidebar.add(sidebarText);

  const inputPanel = new BoxRenderable(renderer, {
    id: "input-panel",
    width: "100%",
    height: 3,
    border: true,
    title: " Input ",
    paddingX: 1,
    backgroundColor: theme.inputBg,
    borderColor: theme.accentWarm,
    focusedBorderColor: theme.borderFocus,
  });

  const dialogBox = new BoxRenderable(renderer, {
    id: "model-dialog",
    width: "64%",
    height: "56%",
    border: true,
    borderStyle: "single",
    title: " Model Switch ",
    position: "absolute",
    left: "18%",
    top: "20%",
    padding: 1,
    backgroundColor: theme.panelSoftBg,
    borderColor: theme.accent,
    focusedBorderColor: theme.borderFocus,
    zIndex: 100,
    visible: false,
  });
  const dialogText = new TextRenderable(renderer, {
    id: "model-dialog-text",
    content: "",
    fg: theme.text,
    bg: theme.panelSoftBg,
    wrapMode: "word",
  });
  dialogBox.add(dialogText);
  const input = new InputRenderable(renderer, {
    id: "input",
    width: "100%",
    value: "",
    placeholder: "Ask anything...",
    backgroundColor: theme.inputBg,
    textColor: theme.text,
    focusedBackgroundColor: theme.inputBg,
    focusedTextColor: theme.text,
    onKeyDown: (key) => {
      if (key.name !== "tab") {
        return;
      }

      key.preventDefault();
      const order: ChatMode[] = ["auto", "build", "plan"];
      const current = order.indexOf(mode);
      const delta = key.shift ? -1 : 1;
      const next = (current + delta + order.length) % order.length;
      mode = order[next];

      if (mode === "build") {
        includeContext = true;
        toolsetEnabled = true;
      }
      if (mode === "plan") {
        autoApply = false;
      }

      appendChat("KESMO", `Mode switched to ${mode.toUpperCase()} via TAB.`);
      updateSidebar();
      renderer.requestRender();
    },
  });
  inputPanel.add(input);

  body.add(chatPanel);
  body.add(sidebar);
  root.add(header);
  root.add(body);
  root.add(inputPanel);
  root.add(dialogBox);

  const plugins: Plugin[] = loadPlugins();
  const history: ChatTurn[] = [];
  let includeContext = options.includeContext;
  let toolsetEnabled = options.toolsetEnabled;
  let mode: ChatMode = "auto";
  let autoApply = false;
  let busy = false;
  let draftInput = "";
  let lastUserMessage = "";
  let pendingSuggestion: PendingFileSuggestion | null = null;
  let context = "";
  let config = loadConfig();
  let dialog:
    | null
    | {
        step: "provider" | "model";
        provider?: ProviderType;
        providers: ProviderType[];
        models: string[];
      } = null;

  const applyTheme = (themeName: ThemeName): void => {
    currentTheme = themeName;
    theme = THEMES[currentTheme];
    renderer.setBackgroundColor(theme.appBg);
    root.backgroundColor = theme.appBg;

    header.backgroundColor = theme.panelSoftBg;
    header.borderColor = theme.accent;
    header.focusedBorderColor = theme.borderFocus;
    headerText.fg = theme.text;
    headerText.bg = theme.panelSoftBg;

    chatPanel.backgroundColor = theme.panelBg;
    chatPanel.borderColor = theme.border;
    chatPanel.focusedBorderColor = theme.borderFocus;
    chatText.fg = theme.text;
    chatText.bg = theme.panelBg;

    sidebar.backgroundColor = theme.panelSoftBg;
    sidebar.borderColor = theme.border;
    sidebar.focusedBorderColor = theme.borderFocus;
    sidebarText.fg = theme.muted;
    sidebarText.bg = theme.panelSoftBg;

    inputPanel.backgroundColor = theme.inputBg;
    inputPanel.borderColor = theme.accentWarm;
    inputPanel.focusedBorderColor = theme.borderFocus;
    input.backgroundColor = theme.inputBg;
    input.textColor = theme.text;
    input.focusedBackgroundColor = theme.inputBg;
    input.focusedTextColor = theme.text;

    dialogBox.backgroundColor = theme.panelSoftBg;
    dialogBox.borderColor = theme.accent;
    dialogBox.focusedBorderColor = theme.borderFocus;
    dialogText.fg = theme.text;
    dialogText.bg = theme.panelSoftBg;
    renderer.requestRender();
  };

  const openDialog = (title: string, content: string): void => {
    dialogBox.title = ` ${title} `;
    dialogText.content = content;
    dialogBox.visible = true;
    renderer.requestRender();
  };

  const closeDialog = (): void => {
    dialogBox.visible = false;
    renderer.requestRender();
  };

  try {
    const files = await scanFiles();
    context = files
      .slice(0, Math.max(1, options.maxFiles))
      .map((file) => `## ${file.path}\n${file.content.slice(0, 1000)}`)
      .join("\n\n");
  } catch {
    context = "";
  }

  const setChat = (lines: string[]): void => {
    chatText.content = lines.join("\n\n");
    renderer.requestRender();
  };

  const appendChat = (role: "You" | "KESMO", text: string): void => {
    const prefix = role === "You" ? "[YOU]" : "[KESMO]";
    const current = String(chatText.content || "");
    chatText.content = `${current}\n\n${prefix} ${text}`.trim();
    chatScroll.scrollTo({ y: 999999, x: 0 });
    renderer.requestRender();
  };

  const updateSidebar = (): void => {
    const suggestions = draftInput.startsWith("/")
      ? SLASH_COMMANDS.filter((cmd) => cmd.startsWith(draftInput)).slice(0, 4)
      : [];

    sidebarText.content = [
      "== Modes ==",
      `Mode      ${mode.toUpperCase()}`,
      `Context   ${includeContext ? "ON" : "OFF"}`,
      `Toolset   ${toolsetEnabled ? "ON" : "OFF"}`,
      `AutoApply ${autoApply ? "ON" : "OFF"}`,
      "",
      "== Provider ==",
      `Provider: ${config.provider}`,
      `Model: ${config.model}`,
      "",
      "== Stats ==",
      `Messages: ${history.length}`,
      `Max tools: ${options.maxTools}`,
      `Max files: ${options.maxFiles}`,
      "",
      "== Pending File ==",
      pendingSuggestion?.filePath ?? "none",
      "",
      `Theme: ${currentTheme}`,
      `Dialog: ${dialog?.step ?? "none"}`,
      "",
      "== Command Hints ==",
      suggestions.length > 0 ? suggestions.join("  ") : "(type / for menu)",
    ].join("\n");
    renderer.requestRender();
  };

  const applySuggestion = async (): Promise<void> => {
    if (!pendingSuggestion) {
      appendChat("KESMO", "No pending file output.");
      return;
    }
    const fullPath = path.resolve(process.cwd(), pendingSuggestion.filePath);
    const workspace = path.resolve(process.cwd()) + path.sep;
    if (!fullPath.startsWith(workspace)) {
      appendChat("KESMO", "Refusing to write outside workspace.");
      return;
    }

    const before = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf-8") : "";
    const diff = buildDiff(pendingSuggestion.filePath, before, pendingSuggestion.content);

    if (!autoApply) {
      appendChat(
        "KESMO",
        `Diff preview for ${pendingSuggestion.filePath}:\n${diff}\n\nType y / n / a to approve this pending write.`,
      );
      return;
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, pendingSuggestion.content, "utf-8");
    appendChat("KESMO", `File written: ${pendingSuggestion.filePath}`);
    pendingSuggestion = null;
    updateSidebar();
  };

  const handleSlash = async (value: string): Promise<boolean> => {
    if (value.startsWith("/") && !value.includes(" ")) {
      const direct = SLASH_COMMANDS.includes(value);
      if (!direct) {
        const matches = SLASH_COMMANDS.filter((cmd) => cmd.startsWith(value));
        if (matches.length === 1) {
          appendChat("KESMO", `Auto-complete: ${value} -> ${matches[0]}`);
          return handleSlash(matches[0]);
        }
        if (matches.length > 1) {
          appendChat("KESMO", `Suggestions: ${matches.join(" ")}`);
          return true;
        }
      }
    }

    if (value === "/help") {
      appendChat(
        "KESMO",
        "Commands: /help /clear /context /toolset /autoapply /apply /theme <name> /mode <auto|build|plan> /model /exit",
      );
      return true;
    }
    if (value === "/") {
      appendChat("KESMO", `Menu: ${SLASH_COMMANDS.join(" ")}`);
      return true;
    }
    if (value === "/clear") {
      history.length = 0;
      setChat(["KESMO: Cleared."]);
      return true;
    }
    if (value === "/context") {
      includeContext = !includeContext;
      appendChat("KESMO", `Context ${includeContext ? "enabled" : "disabled"}.`);
      updateSidebar();
      return true;
    }
    if (value === "/toolset") {
      toolsetEnabled = !toolsetEnabled;
      appendChat("KESMO", `Toolset ${toolsetEnabled ? "enabled" : "disabled"}.`);
      updateSidebar();
      return true;
    }
    if (value === "/autoapply") {
      autoApply = !autoApply;
      appendChat("KESMO", `AutoApply ${autoApply ? "enabled" : "disabled"}.`);
      if (autoApply && pendingSuggestion) {
        await applySuggestion();
      }
      updateSidebar();
      return true;
    }
    if (value.startsWith("/theme")) {
      const next = value.split(/\s+/)[1] as ThemeName | undefined;
      if (!next) {
        appendChat("KESMO", "Themes: aurora, nord, solarized, graphite");
        return true;
      }
      if (!(next in THEMES)) {
        appendChat("KESMO", `Unknown theme '${next}'.`);
        return true;
      }
      applyTheme(next);
      appendChat("KESMO", `Theme switched to ${next}.`);
      updateSidebar();
      return true;
    }
    if (/^\/mode(?:\s|$)/.test(value)) {
      const requested = value.split(/\s+/)[1] as ChatMode | undefined;
      if (!requested) {
        appendChat("KESMO", "Modes: auto, build, plan");
        return true;
      }
      if (!["auto", "build", "plan"].includes(requested)) {
        appendChat("KESMO", `Unknown mode '${requested}'.`);
        return true;
      }
      mode = requested;
      if (mode === "build") {
        includeContext = true;
        toolsetEnabled = true;
      }
      if (mode === "plan") {
        autoApply = false;
      }
      appendChat("KESMO", `Mode switched to ${mode.toUpperCase()}.`);
      updateSidebar();
      return true;
    }
    if (value === "/model") {
      const providers: ProviderType[] = [
        "openai",
        "claude",
        "openrouter",
        "google",
      ];
      dialog = {
        step: "provider",
        providers,
        models: [],
      };
      openDialog(
        "Model Switch",
        [
          "Choose provider by number:",
          providers.map((provider, idx) => `${idx + 1}. ${provider}`).join("\n"),
          "",
          "Type cancel to stop.",
        ].join("\n"),
      );
      appendChat("KESMO", "Opened provider/model switch dialog.");
      return true;
    }
    if (value === "/apply") {
      await applySuggestion();
      return true;
    }
    if (value === "y" || value === "yes" || value === "a" || value === "all") {
      if (pendingSuggestion) {
        if (value === "a" || value === "all") {
          autoApply = true;
        }
        const fullPath = path.resolve(process.cwd(), pendingSuggestion.filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, pendingSuggestion.content, "utf-8");
        appendChat("KESMO", `File written: ${pendingSuggestion.filePath}`);
        pendingSuggestion = null;
        updateSidebar();
      }
      return true;
    }
    if (value === "n" || value === "no") {
      if (pendingSuggestion) {
        appendChat("KESMO", "Write cancelled.");
      }
      return true;
    }
    if (value === "/exit") {
      closeDialog();
      renderer.destroy();
      return true;
    }

    return false;
  };

  input.on(InputRenderableEvents.ENTER, async (rawValue: string) => {
    const value = rawValue.trim();
    input.value = "";
    draftInput = "";
    if (!value || busy) {
      return;
    }

    if (dialog) {
      const normalized = value.toLowerCase();
      if (normalized === "cancel") {
        dialog = null;
        closeDialog();
        appendChat("KESMO", "Model switch dialog cancelled.");
        updateSidebar();
        return;
      }

      if (dialog.step === "provider") {
        const index = Number(value);
        if (!Number.isFinite(index) || index < 1 || index > dialog.providers.length) {
          appendChat("KESMO", "Invalid provider selection. Enter a valid number.");
          return;
        }

        const provider = dialog.providers[index - 1];
        const models = getSuggestedModels(provider);
        dialog = {
          step: "model",
          provider,
          providers: dialog.providers,
          models,
        };
        openDialog(
          "Model Switch",
          [
            `Provider selected: ${provider}`,
            "Choose model by number (or type custom:<model-name>):",
            ...models.map((model, idx) => `${idx + 1}. ${model}`),
            "",
            "Type cancel to stop.",
          ].join("\n"),
        );
        appendChat("KESMO", `Provider selected: ${provider}`);
        return;
      }

      if (dialog.step === "model" && dialog.provider) {
        let selectedModel = "";
        const custom = value.match(/^custom\s*:\s*(.+)$/i);
        if (custom?.[1]) {
          selectedModel = custom[1].trim();
        } else {
          const index = Number(value);
          if (
            !Number.isFinite(index) ||
            index < 1 ||
            index > dialog.models.length
          ) {
            appendChat(
              "KESMO",
              "Invalid model selection. Enter a number or custom:<model-name>.",
            );
            return;
          }
          selectedModel = dialog.models[index - 1];
        }

        config = {
          ...config,
          provider: dialog.provider,
          model: selectedModel,
        };
        saveConfig(config);
        appendChat(
          "KESMO",
          `Config updated: provider=${config.provider}, model=${config.model}`,
        );
        dialog = null;
        closeDialog();
        updateSidebar();
        return;
      }
    }

    if (await handleSlash(value)) {
      return;
    }

    busy = true;
    lastUserMessage = value;
    history.push({ role: "user", content: value });
    appendChat("You", value);
    headerText.content = "Thinking...";
    renderer.requestRender();

    try {
      const selectedTools = toolsetEnabled && shouldUseToolset(value)
        ? selectToolsetPlugins(plugins, value, options.maxTools)
        : [];
      const toolsetPrompt = buildToolsetPrompt(
        selectedTools,
        mode === "plan" ? 450 : mode === "build" ? 900 : 650,
      );
      const prompt = buildPrompt(
        history,
        context,
        includeContext,
        toolsetPrompt,
        mode,
      );
      const response = await runLLM(prompt, {
        reasoning: mode === "plan",
        maxOutputTokens: mode === "plan" ? 1700 : mode === "build" ? 1400 : 1000,
        temperature: mode === "plan" ? 0.2 : mode === "build" ? 0.3 : 0.35,
      });

      history.push({ role: "assistant", content: response });
      appendChat("KESMO", response);

      pendingSuggestion = detectSuggestion(response, lastUserMessage);
      if (pendingSuggestion) {
        appendChat(
          "KESMO",
          `Detected file output: ${pendingSuggestion.filePath}. Use /apply (or /autoapply).`,
        );
        if (autoApply) {
          await applySuggestion();
        }
      }
      updateSidebar();
    } catch (error) {
      appendChat(
        "KESMO",
        error instanceof Error ? error.message : "Chat request failed",
      );
    } finally {
      headerText.content =
        "Chat | /help /apply /autoapply /context /toolset /mode /theme /model /clear /exit";
      busy = false;
      renderer.requestRender();
    }
  });

  input.on(InputRenderableEvents.CHANGE, (value: string) => {
    draftInput = value.trim();
    updateSidebar();
  });

  updateSidebar();
  renderer.start();
  input.focus();

  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve());
  });
}
