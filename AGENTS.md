**Agent Guide**
- Purpose: orientation and operational rules for automated coding agents working in this repository.
- Location: repository root — this file is read by agentic tools before making edits.
- Scope: build / test / lint commands, how to run a single test, and code style + conventions to follow.

---

Build / Lint / Test (commands)
- Build TypeScript: `npm run build` (runs `tsc`). Output goes to `./dist` per `tsconfig.json`.
- Dev / watch build: `npm run dev` (runs `tsc --watch`). Use when iterating on TS source.
- Start CLI entrypoint (production): `npm start` -> `node dist/bin/kesmo.js`.
- Clean build artifacts: `npm run clean` (removes `dist`).
- Run tests: there is no test runner configured in `package.json` by default. The README mentions `npm test` but `scripts.test` is not defined.
  - Recommended (one-time): add `vitest` or `jest` as the test runner. Example dev dependency and scripts to add to `package.json`:

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "@types/jest": "^29.0.0" // if using jest
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- Run a single test file with vitest:

```bash
# run a single test file
npx vitest run path/to/test/file.test.ts

# run a single test by name
npx vitest -t "should do X"
```

- Run a single test file with jest (if you prefer jest):

```bash
npx jest path/to/test/file.test.ts -t "test name substring"
```

- Quick check (lint/format suggestions): this repo currently has no ESLint/Prettier config. Recommended commands to add when you add tooling:

```bash
# lint (eslint)

# format (prettier)
```

Notes about running tests in this codebase
- There are no existing test files under `src/` or `test/`. Before running tests, add a test runner and create a `test/` or `__tests__/` directory.
- Use `tsconfig.json` when running TypeScript tests so the runner can resolve `moduleResolution: nodenext` and `esModuleInterop`.
- The compiled sources live in `dist/`. For CLI integration tests you can run `node dist/bin/kesmo.js` after `npm run build`.

---

Cursor / Copilot rules
- I checked for Cursor rules under `.cursor/rules/` or `.cursorrules` — none found.
- I checked for GitHub Copilot repository instructions in `.github/copilot-instructions.md` — none found.

If you maintain any of these files, add a short section here to call them out so agents honor them.

---

Code Style Guidelines (apply to all agent edits)
- Language & tooling
  - Primary language: TypeScript (see `tsconfig.json`). Keep `strict: true` semantics.
  - Runtime module type: `"type": "module"` in `package.json` and `module: "nodenext"` in `tsconfig.json`.
  - Keep imports in source `.ts` files with `.js` runtime extensions where appropriate (this repository uses explicit `.js` extensions in `src/*.ts` imports — preserve that pattern). Example: `import { loadConfig } from "./utils/config.js";`.

- Imports and module boundaries
  - Use named exports where practical (this codebase favors named exports in `src/index.ts`).
  - Prefer `import type { Foo } from "./types.js";` for purely type imports to avoid runtime side effects.
  - Group imports in the following order: 1) Node / external packages (sorted alphabetically), 2) internal modules (relative paths), 3) types-only imports. Leave a blank line between groups.

- Formatting
  - Use Prettier or equivalent; recommended settings:

```json
{
  "tabWidth": 2,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

  - Keep lines reasonably short (<=100 chars) and prefer small helper functions over very long functions.

- Types and type-safety
  - Keep `strict: true`. Prefer explicit return types on exported functions and public APIs.
  - Avoid `any`. If `any` is necessary, wrap with a short comment explaining why and a TODO to reduce it later.
  - Use discriminated unions for variant types; keep interfaces (`interface`) for public shapes and `type` aliases for composition / unions.
  - Use `readonly` for arrays and object properties when mutation is not required.

- Naming conventions
  - Files: `kebab-case` or `camelCase` is acceptable; this repo uses `camelCase` for many files (e.g., `promptOptimizer.ts`). Keep existing pattern for new files in the same folder.
  - Exports: `PascalCase` for types and interfaces (`KesmoConfig`, `AnalysisResult`).
  - Functions and variables: `camelCase` (`runAgent`, `scanFiles`).
  - Constants: `UPPER_SNAKE_CASE` only for build-time constants or environment keys; otherwise use `camelCase` with `const` (this repo uses `const KESMO_BANNER`).

- Error handling
  - Use `async/await` and `try/catch` around I/O, network calls, and provider requests (the project already uses that style).
  - When catching errors, preserve the original error where possible and rethrow with additional context using `new Error(
    `context message: ${String(err)}`
  )` or a custom Error subclass. Avoid swallowing errors silently.
  - For CLI commands, prefer user-friendly messages using `chalk` for emphasis and include an exit code where appropriate (use `process.exit(1)` only at top-level CLI handlers).

- Logging
  - Use `createLogger` from `src/utils/logger.ts` for structured logs. For ad-hoc CLI messages use `chalk` to provide readable output.
  - Persist long-form analysis results to `logs/` (repository already follows this pattern).

- Async / concurrency
  - Avoid unbounded parallelism when calling external providers. Respect token limits and rate limits; use the token management utilities in `src/core/tokenLimiter.ts` when batching requests.

- Tests and testability
  - Make exported utility functions pure where reasonable (smaller, deterministic inputs/outputs) to make unit tests simple.
  - Keep side effects (disk, network) behind small adapters that can be mocked in tests.

- Files to prefer reading/writing
  - Source: `src/**/*.ts`
  - Compiled: `dist/**/*.js`
  - Prompts / agents: `prompts/**/*.json` (agent definitions live here)

---

Contributing / commit guidance for agents
- Keep changes focused and minimal per commit / PR. One logical change per PR.
- If a change requires adding new devDependencies (test/lint tooling), update `package.json` and add a short note in the commit message.

Safety / Git rules for agents
- Never change `dist/` as a source-of-truth — edits should be made in `src/` then `npm run build` to regenerate `dist/`.
- Do not commit secrets: `.kesmorc.json` may contain API keys. Respect `.gitignore` and never add keys to commits.

When in doubt
- Default to conservative changes: make small, well-typed edits with tests (or an accompanying manual test plan in the PR description).
- If a task might modify production behaviour (publishing, version bump, or changing `package.json` scripts), leave a short human-facing note in the PR body explaining intent.

---

If you want, I can:
1) Add a recommended `devDependencies` set (ESLint + Prettier + Vitest) and wire up `package.json` scripts.
2) Create a basic `.eslintrc` / `.prettierrc` and a sample test under `test/` that demonstrates running a single test.

End of AGENTS.md
