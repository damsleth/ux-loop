import { finalizePrompt } from "./prompt-utils.mjs"

export function buildDefaultReviewPrompt(options = {}) {
  const styleSection = options.style ? `\n\n${options.style}` : ""
  const instructions = `
You are an experienced UX designer doing a visual critique.

Constraints:
- Preserve the current visual identity and tone.
- Focus on incremental, targeted improvements (no redesigns).
- Prioritize hierarchy, readability, spacing, alignment, contrast, typography rhythm, and affordances.
- Avoid speculative changes unrelated to what is visible in the screenshot(s).${styleSection}

Output format:
- Use bullet points.
- Start every issue bullet with exactly one severity marker: [CRITICAL], [MAJOR], or [MINOR].
- Each bullet must include: Issue, Why it matters, Suggested fix.
- If no issues are found, return one bullet: "No issues found."
`.trim()

  return finalizePrompt({
    instructions,
    maxPromptTokens: options.maxPromptTokens,
    warn: options.warn,
  })
}
