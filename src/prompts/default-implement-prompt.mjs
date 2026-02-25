export function buildDefaultImplementPrompt(reportMarkdown) {
  return [
    "You are implementing UX improvements based on a visual review report.",
    "",
    "Constraints:",
    "- Preserve visual identity and tone.",
    "- Apply incremental, high-impact changes only (no redesign).",
    "- Prioritize readability, spacing, alignment, contrast, and affordances.",
    "- Avoid speculative or unrelated changes.",
    "- Do not auto-commit.",
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
