import fs from "node:fs";
import path from "node:path";
import type {
  EditOperation,
  EditPlan,
  EditApplyOptions,
  EditApplyResult,
} from "../../types.js";

function resolveWorkspacePath(filePath: string, cwd: string): string {
  const fullPath = path.resolve(cwd, filePath);
  const normalizedCwd = path.resolve(cwd) + path.sep;

  if (!fullPath.startsWith(normalizedCwd) && fullPath !== path.resolve(cwd)) {
    throw new Error(`Refusing to edit outside workspace: ${filePath}`);
  }

  return fullPath;
}

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in model response");
  }

  return text.slice(firstBrace, lastBrace + 1);
}

export function parseEditPlan(raw: string): EditPlan {
  const jsonText = extractJsonBlock(raw);
  const parsed = JSON.parse(jsonText) as Partial<EditPlan>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid plan object");
  }

  if (!Array.isArray(parsed.edits)) {
    throw new Error("Plan is missing edits array");
  }

  const edits: EditOperation[] = parsed.edits.map((edit, index) => {
    if (!edit || typeof edit !== "object") {
      throw new Error(`Invalid edit at index ${index}`);
    }

    const action = edit.action;
    const file = edit.file;
    const find = edit.find;
    const replace = edit.replace;

    if (action !== "replace") {
      throw new Error(`Unsupported action at edit ${index}: ${String(action)}`);
    }
    if (typeof file !== "string" || file.trim() === "") {
      throw new Error(`Invalid file in edit ${index}`);
    }
    if (typeof find !== "string" || find.length === 0) {
      throw new Error(`Invalid find in edit ${index}`);
    }
    if (typeof replace !== "string") {
      throw new Error(`Invalid replace in edit ${index}`);
    }

    return {
      action,
      file,
      find,
      replace,
      reason: typeof edit.reason === "string" ? edit.reason : undefined,
    };
  });

  return {
    summary:
      typeof parsed.summary === "string" ? parsed.summary : "Refactor plan",
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.filter((n): n is string => typeof n === "string")
      : undefined,
    edits,
  };
}

function previewSnippet(before: string, after: string): string {
  const oldPreview = before.slice(0, 180).replace(/\n/g, "\\n");
  const newPreview = after.slice(0, 180).replace(/\n/g, "\\n");
  return `- ${oldPreview}\n+ ${newPreview}`;
}

export function applyEditPlan(
  plan: EditPlan,
  options: EditApplyOptions = {},
): EditApplyResult {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? true;

  const result: EditApplyResult = {
    summary: plan.summary,
    applied: [],
    skipped: [],
    failed: [],
  };

  for (const edit of plan.edits) {
    try {
      const fullPath = resolveWorkspacePath(edit.file, cwd);
      if (!fs.existsSync(fullPath)) {
        result.failed.push({
          file: edit.file,
          reason: "Target file does not exist",
        });
        continue;
      }

      const original = fs.readFileSync(fullPath, "utf-8");
      const occurrences = original.split(edit.find).length - 1;

      if (occurrences === 0) {
        result.skipped.push({
          file: edit.file,
          reason: "Find text not found",
        });
        continue;
      }

      if (occurrences > 1) {
        result.skipped.push({
          file: edit.file,
          reason: "Find text is ambiguous (matches multiple locations)",
        });
        continue;
      }

      const updated = original.replace(edit.find, edit.replace);
      if (!dryRun) {
        fs.writeFileSync(fullPath, updated, "utf-8");
      }

      result.applied.push({
        file: edit.file,
        action: edit.action,
        reason: edit.reason,
        preview: previewSnippet(edit.find, edit.replace),
      });
    } catch (error) {
      result.failed.push({
        file: edit.file,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}
