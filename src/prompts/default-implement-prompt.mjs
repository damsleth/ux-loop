import { finalizePrompt } from "./prompt-utils.mjs"

const SCOPE_CONSTRAINTS = {
  "css-only": [
    "- Only modify CSS, SCSS, Sass, Less, or style blocks in Vue/Svelte components.",
    "- Do not change HTML structure, templates, component markup, or JavaScript/TypeScript logic.",
    "- Explicitly avoid business logic changes.",
  ],
  "text-only": [
    "- Only change user-facing copy such as labels, headings, alt text, helper text, and inline messages.",
    "- Do not change styling, layout structure, or JavaScript/TypeScript logic unless required to update text literals.",
    "- Explicitly avoid business logic changes.",
  ],
  "layout-safe": [
    "- Limit changes to styles, classes, and user-facing copy.",
    "- Do not add, remove, or reorder structural HTML/component layout blocks.",
    "- Do not change JavaScript/TypeScript business logic.",
  ],
  unrestricted: [
    "- Keep changes tightly scoped to the reviewed UX issues.",
  ],
}

export function buildDefaultImplementPrompt(reportMarkdown, options = {}) {
  const commitInstruction = options.autoCommit
    ? "- Do not create commits yourself; the CLI will commit after a successful run."
    : "- Do not auto-commit."
  const scope = options.scope || "layout-safe"
  const scopeConstraints = SCOPE_CONSTRAINTS[scope] || SCOPE_CONSTRAINTS["layout-safe"]
  const styleSection = options.style ? `\n\n${options.style}` : ""

  const instructions = [
    "You are implementing UX improvements based on a visual review report.",
    "",
    "Constraints:",
    "- Preserve visual identity and tone.",
    "- Apply incremental, high-impact changes only (no redesign).",
    "- Prioritize readability, spacing, alignment, contrast, and affordances.",
    "- Avoid speculative or unrelated changes.",
    ...scopeConstraints,
    commitInstruction,
    styleSection ? styleSection.trim() : "",
    "",
    "Task:",
    "1. Read the report and identify the top 5 highest-severity issues.",
    "2. For each issue, identify the exact file and line to change before editing.",
    "3. Apply the minimal change that resolves the issue.",
    "4. Do not touch files unrelated to the listed issues.",
    "5. Run relevant validation for touched code.",
    "6. End with a concise summary of applied and skipped items.",
  ].filter(Boolean).join("\n")

  return finalizePrompt({
    instructions,
    embeddedLabel: "UX Review Report",
    embeddedContent: reportMarkdown,
    maxPromptTokens: options.maxPromptTokens,
    warn: options.warn,
  })
}
