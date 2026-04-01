# KESMO v2 - AI Code Analysis Engine

## 📖 Product Overview
KESMO is a CLI-driven AI code analysis, refactoring, and orchestration engine. It leverages LLM providers to scan, analyze, and transform codebases using a modular plugin architecture. Designed for developers, it supports interactive workflows, automated scanning, and AI-assisted refactoring with strict diff-based safety guarantees.

### Key Features
- **Multi-Provider LLM Support**: OpenAI, Claude, OpenRouter, Google
- **Plugin-Driven Analysis**: Markdown-based prompts categorized by domain (security, quality, performance, etc.)
- **Safe Refactoring**: Parse & apply edit plans via structured diffs
- **Code Optimization**: Whitespace normalization, comment/console removal, language detection
- **Interactive CLI**: Commander.js + Inquirer for guided workflows
- **Chunked Processing**: Handles large files via intelligent chunking

---

## 🏗 Architecture Overview
