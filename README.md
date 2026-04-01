# KESMO - AI Code Analysis Engine

[![npm version](https://img.shields.io/npm/v/kesmo.svg)](https://www.npmjs.com/package/kesmo)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

KESMO is a production-ready CLI tool that connects to LLM providers (OpenAI, Claude, Google Gemini, OpenRouter) to perform intelligent code analysis using customizable AI agents. Perfect for security audits, code quality checks, performance analysis, and more.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Creating Custom Agents](#creating-custom-agents)
- [Configuration](#configuration)
- [Supported Languages](#supported-languages)
- [Project Structure](#project-structure)
- [API](#api)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🔌 **Multi-Provider Support**: OpenAI, Claude, OpenRouter, Google Gemini
- 🤖 **Plugin System**: Load AI agents from JSON/Markdown files
- 📂 **Full Codebase Scanning**: Supports TS, JS, Python, Java, Go, Rust, and more
- ⚡ **Smart Chunking**: Intelligently splits large files preserving code structure
- 🔧 **Prompt Optimization**: Removes comments, console logs, and redundant whitespace
- 📝 **Logging**: Saves analysis results to `/logs` directory
- 🛡️ **Error Handling**: Graceful handling of API errors and edge cases

## Installation

Install globally via npm:

```bash
npm install -g kesmo-cli
```

Or as a project dependency:

```bash
npm install kesmo-cli
npx kesmo-cli
```

**Requirements:** Node.js 18.0.0 or higher

### First Time Setup

```bash
kesmo
```

This interactive setup will guide you through:

- 🔐 Selecting your LLM provider (OpenAI, Claude, OpenRouter, Google Gemini)
- 🔑 Enter your API key
- 🤖 Choose a model

Your configuration will be saved to `.kesmorc.json` for future use.

## Quick Start

### Run a Single Agent

Select and run one of the built-in or custom agents:

```bash
kesmo plugin
```

This will:

1. Display all available agents
2. Let you select one interactively
3. Analyze your codebase
4. Save results to `/logs`

### Run All Agents

Run the complete analysis suite on your codebase:

```bash
kesmo scan
```

Skip confirmation prompt:

```bash
kesmo scan -y
```

### Common Workflows

**Security Audit Only:**

```bash
kesmo plugin -c security
```

**With Verbose Output:**

```bash
kesmo plugin -v
```

**Limit File Analysis:**

```bash
kesmo plugin --max-files 50
```

## Commands

| Command                      | Description                         | Example                    |
| ---------------------------- | ----------------------------------- | -------------------------- |
| `kesmo`                      | Interactive setup wizard            | `kesmo`                    |
| `kesmo plugin`               | Select and run a single agent       | `kesmo plugin`             |
| `kesmo plugin --list`        | List all available agents           | `kesmo plugin --list`      |
| `kesmo plugin -c <category>` | Filter agents by category           | `kesmo plugin -c security` |
| `kesmo scan`                 | Run all agents sequentially         | `kesmo scan`               |
| `kesmo scan -y`              | Run all agents without confirmation | `kesmo scan -y`            |
| `kesmo reset`                | Reset configuration and start over  | `kesmo reset`              |

## Options

All commands support these global options:

```
  -v, --verbose              Show detailed output including token counts and timing
  --max-files <n>           Limit number of files to analyze (default: unlimited)
  -y, --yes                 Skip all confirmation prompts
```

## Creating Custom Agents

Extend KESMO with your own analysis agents by adding JSON files to the `/prompts` directory.

### Basic Agent Template

```json
{
  "name": "Security Audit",
  "category": "security",
  "description": "Analyze code for vulnerabilities and security issues",
  "prompt": "You are a security expert. Analyze the following code for vulnerabilities, focusing on: SQL injection, XSS, authentication flaws, and data exposure risks."
}
```

### Agent Properties Reference

| Property      | Required | Type   | Description                                                        |
| ------------- | -------- | ------ | ------------------------------------------------------------------ |
| `name`        | ✅       | string | Display name shown in agent selection                              |
| `category`    | ✅       | string | Category for grouping (e.g., security, quality, performance)       |
| `prompt`      | ✅       | string | System prompt sent to the LLM (detailed instructions for analysis) |
| `description` | ❌       | string | Brief description of agent purpose (shown in --list)               |

### Example: Custom Code Quality Agent

```json
{
  "name": "Code Complexity Analyzer",
  "category": "quality",
  "description": "Analyze code for complexity and maintainability issues",
  "prompt": "Analyze this code and identify:\n1. High cyclomatic complexity\n2. Long functions that need refactoring\n3. Nested conditionals\n4. Opportunities for simplification"
}
```

### Example: Performance Agent

```json
{
  "name": "Performance Optimizer",
  "category": "performance",
  "description": "Identify performance bottlenecks and optimization opportunities",
  "prompt": "Review this code for performance issues:\n1. Inefficient algorithms\n2. N+1 queries\n3. Memory leaks\n4. Optimization opportunities"
}
```

## Supported Languages

KESMO analyzes code from a wide range of programming languages:

### Web & Frontend

- **TypeScript** (`.ts`, `.tsx`)
- **JavaScript** (`.js`, `.jsx`)
- **HTML** (`.html`)
- **CSS** (`.css`, `.scss`, `.less`)

### Backend & Systems

- **Python** (`.py`)
- **Java** (`.java`)
- **Go** (`.go`)
- **Rust** (`.rs`)

### Other Languages

- **Ruby** (`.rb`)
- **PHP** (`.php`)
- **C#** (`.cs`)
- **C/C++** (`.c`, `.cpp`, `.h`)
- **Swift** (`.swift`)
- **Kotlin** (`.kt`)

## Ignored Paths

The following paths are automatically excluded from analysis:

```
node_modules/          # NPM dependencies
dist/, build/          # Build outputs
.git/                  # Git directory
vendor/                # Vendor directories
__pycache__/           # Python cache
target/                # Java/Rust build
.next/                 # Next.js build
coverage/              # Test coverage
*.min.js, *.min.css    # Minified files
dist/**/               # Distribution builds
```

## Configuration

Configuration is stored in `.kesmorc.json` in your project root or home directory.

### Example Configuration

```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "gpt-4o"
}
```

### Environment Variables

Alternatively, use environment variables:

```bash
# .env or your shell
export KESMO_PROVIDER=openai
export KESMO_API_KEY=sk-...
export KESMO_MODEL=gpt-4o

kesmo plugin
```

### Supported Providers

- **OpenAI**: Models like `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **Anthropic Claude**: Models like `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`
- **Google Gemini**: Models like `gemini-pro`, `gemini-1.5-pro`
- **OpenRouter**: Access to 100+ models

### Reset Configuration

```bash
kesmo reset
```

This removes `.kesmorc.json` and lets you configure again from scratch.

## Project Structure

```
kesmo/
├── bin/
│   └── kesmo.ts                    # CLI entry point
├── src/
│   ├── commands/
│   │   ├── plugin.ts               # Interactive agent selection
│   │   └── scan.ts                 # Full codebase analysis
│   ├── core/
│   │   ├── agents/
│   │   │   └── loader.ts           # Plugin/agent loader
│   │   ├── scanner/
│   │   │   └── scanner.ts          # File discovery & scanning
│   │   ├── provider/
│   │   │   ├── index.ts            # Provider router
│   │   │   ├── openai.ts           # OpenAI integration
│   │   │   ├── claude.ts           # Claude/Anthropic integration
│   │   │   ├── openrouter.ts       # OpenRouter integration
│   │   │   └── gemini.ts           # Google Gemini integration
│   │   ├── orchestrator/
│   │   │   └── run.ts              # Analysis orchestration
│   │   ├── diff/
│   │   │   └── diff.ts             # Diff utilities
│   │   ├── codeOptimizer.ts        # Code optimization (whitespace, etc)
│   │   ├── promptOptimizer.ts      # Prompt refinement
│   │   └── tokenLimiter.ts         # Token usage management
│   ├── utils/
│   │   ├── config.ts               # Configuration management
│   │   ├── setup.ts                # Interactive setup wizard
│   │   ├── chunk.ts                # Smart code chunking
│   │   └── logger.ts               # Logging system
│   ├── types.ts                    # TypeScript type definitions
│   └── index.ts                    # Module exports
├── prompts/                        # Pre-built agent definitions (JSON files)
├── logs/                           # Analysis results directory
├── package.json
├── tsconfig.json
└── README.md
```

## API

Use KESMO programmatically in your Node.js projects:

```typescript
import { runAgent, scanFiles, loadPlugins, runLLM } from "kesmo";

// Get all files to analyze
const files = await scanFiles();

// Load all available agents
const agents = await loadPlugins();

// Run a specific agent
const results = await runAgent(agents[0], {
  verbose: true,
  maxFiles: 100,
});

// Custom LLM analysis
const analysis = await runLLM({
  provider: "openai",
  model: "gpt-4o",
  systemPrompt: "You are a code reviewer...",
  code: fileContent,
});
```

### TypeScript Interfaces

```typescript
interface Agent {
  name: string;
  category: string;
  description?: string;
  prompt: string;
}

interface AnalysisOptions {
  verbose?: boolean;
  maxFiles?: number;
  skipConfirm?: boolean;
}

interface AnalysisResult {
  agent: string;
  timestamp: string;
  filesAnalyzed: number;
  totalTokens: number;
  results: string;
}
```

## Examples

### Example 1: Security Audit of Your Codebase

```bash
# Run built-in security check
kesmo plugin -c security

# Or create a custom security agent in prompts/my-security.json
# Then run it
kesmo plugin
```

Output will be saved to `/logs/security-*.md`

### Example 2: Automated Code Review

```bash
# Run all agents for comprehensive review
kesmo scan -y

# Check the logs
cat logs/code-quality-*.md
cat logs/performance-*.md
```

### Example 3: Documentation Improvements

Create `prompts/doc-improvement.json`:

```json
{
  "name": "Documentation Analyzer",
  "category": "documentation",
  "description": "Identify missing or unclear documentation",
  "prompt": "Review this code and suggest:\n1. Missing JSDoc comments\n2. Unclear variable names\n3. Complex logic needing explanation\n4. Missing README sections"
}
```

Then run:

```bash
kesmo plugin
# Select: Documentation Analyzer
```

### Example 4: Programmatic Usage

```typescript
import { runAgent, loadPlugins } from "kesmo";

async function auditMyCode() {
  const agents = await loadPlugins();

  // Find security agent
  const securityAgent = agents.find((a) => a.category === "security");

  if (securityAgent) {
    const results = await runAgent(securityAgent, {
      verbose: true,
      maxFiles: 50,
    });

    console.log("Security audit complete:");
    console.log(results);
  }
}

auditMyCode();
```

## Troubleshooting

### Issue: "API Key not found"

**Solution:** Make sure your API key is set:

```bash
kesmo reset
# Then enter your API key
```

Or use environment variables:

```bash
export KESMO_API_KEY=your-api-key-here
kesmo plugin
```

### Issue: "No files found"

**Solution:** Check that you're running KESMO in a directory with source code:

```bash
kesmo plugin --max-files 10  # Test with fewer files
kesmo plugin -v              # Verbose mode to see which files are scanned
```

### Issue: "Token limit exceeded"

**Solution:** Reduce the scope or increase file limit management:

```bash
kesmo plugin --max-files 25
kesmo plugin -c security    # Run specific category
```

### Issue: Slow analysis

**Solution:** Analyze in batches:

```bash
kesmo plugin --max-files 50
# Run multiple times with different categories
kesmo plugin -c security
kesmo plugin -c quality
kesmo plugin -c performance
```

## Contributing

Contributions are welcome! To contribute:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development

```bash
# Clone & setup
git clone https://github.com/yourusername/kesmo.git
cd kesmo
npm install

# Build
npm run build

# Test
npm test

# Link locally
npm link

# Test CLI
kesmo plugin
```

### Guidelines

- Follow existing code style
- Add tests for new features
- Update README for new features
- Keep commits atomic and descriptive

## Change Log

### v1.0.0

- Initial release
- Multi-provider support (OpenAI, Claude, Gemini, OpenRouter)
- Plugin system with JSON agents
- Full codebase scanning
- Token management and optimization

See [CHANGELOG.md](./CHANGELOG.md) for full history.

## License

ISC

---

## Support

- 📖 [Documentation](./README.md)
- 🐛 [Report Issues](https://github.com/AMOHAMMEDIMRAN/kesmo/issues)
- 💬 [Discussions](https://github.com/AMOHAMMEDIMRAN/kesmo/discussions)
- ⭐ [Star on GitHub](https://github.com/AMOHAMMEDIMRAN/kesmo)

## Author

**Mohammed Imran**

- GitHub: [@AMOHAMMEDIMRAN](https://github.com/AMOHAMMEDIMRAN)

---

Made with ❤️ for developers
