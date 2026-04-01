export interface KesmoConfig {
  provider: ProviderType;
  apiKey: string;
  model: string;
}

export type ProviderType = "openai" | "claude" | "openrouter" | "google";

export interface Plugin {
  id: string;
  name: string;
  category: string;
  prompt: string;
  description?: string;
}

export interface ScannedFile {
  path: string;
  content: string;
}

export interface ChunkedFile {
  path: string;
  chunks: string[];
}

export interface AnalysisResult {
  file: string;
  chunk: number;
  totalChunks: number;
  result: string;
  timestamp: Date;
}

export interface LLMProvider {
  run(prompt: string, config: KesmoConfig): Promise<string>;
}

export interface LogEntry {
  timestamp: Date;
  agent: string;
  file: string;
  result: string;
}

export interface AnalysisOptions {
  verbose?: boolean;
  maxFiles?: number;
  specificFile?: string;
}

export interface EditOperation {
  action: "replace";
  file: string;
  find: string;
  replace: string;
  reason?: string;
}

export interface EditPlan {
  summary: string;
  notes?: string[];
  edits: EditOperation[];
}

export interface EditApplyOptions {
  dryRun?: boolean;
  cwd?: string;
}

export interface EditApplyResult {
  summary: string;
  applied: Array<{
    file: string;
    action: "replace";
    reason?: string;
    preview: string;
  }>;
  skipped: Array<{
    file: string;
    reason: string;
  }>;
  failed: Array<{
    file: string;
    reason: string;
  }>;
}
