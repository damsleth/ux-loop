import { runCommand } from "../utils/process.mjs"

export function runClaudeImplement({ claudeBin, model, timeoutMs, workDir, prompt }) {
  // -p print mode; prompt via stdin. acceptEdits applies file edits without prompting.
  // Bash is deliberately excluded from allowedTools: scope constraints (plan 06)
  // forbid business-logic/dependency changes, so denying shell access enforces
  // "edit files only" at the tool layer — stronger than the prompt alone.
  // --strict-mcp-config (no --mcp-config) disables the user's MCP servers.
  const args = [
    "-p",
    "--output-format",
    "text",
    "--strict-mcp-config",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "Read,Edit,Write,Glob,Grep",
  ]

  if (model) {
    args.push("--model", model)
  }

  return runCommand(claudeBin, args, {
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    maxBuffer: 10 * 1024 * 1024,
    cwd: workDir,
    timeoutMs,
  })
}
