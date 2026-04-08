export function buildDefaultImplementPrompt(reportMarkdown, options = {}) {
  const commitInstruction = options.autoCommit
    ? "- Do not create commits yourself; the CLI will commit after a successful run."
    : "- Do not auto-commit."

  return [
    "You are implementing UX improvements based on a visual review report.",
    "",
    "Constraints:",
    "- Preserve visual identity and tone.",
    "- Apply incremental, high-impact changes only (no redesign).",
    "- Prioritize readability, spacing, alignment, contrast, and affordances.",
    "- Avoid speculative or unrelated changes.",
    commitInstruction,
    "",
    "Task:",
    "1. Read the report.",
    "2. Implement the most concrete, highest-impact items in this repository.",
    "3. Keep changes coherent and focused.",
    "4. Run relevant validation for touched code.",
    "5. End with a concise summary of applied and skipped items.",
    "",
    "UX Review Report:",
    "```md",
    reportMarkdown,
    "```",
  ].join("\n")
}
