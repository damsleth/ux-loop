function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4)
}

function truncateText(text, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return ""
  }
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars).trimEnd()}\n[...truncated]`
}

export function finalizePrompt({
  instructions,
  embeddedLabel,
  embeddedContent,
  maxPromptTokens,
  warn = console.warn,
}) {
  const base = String(instructions || "").trimEnd()
  if (!embeddedLabel) {
    const prompt = base
    if (Number.isFinite(maxPromptTokens) && estimateTokens(prompt) > maxPromptTokens) {
      warn(`Prompt exceeds configured maxPromptTokens (${maxPromptTokens}).`)
    }
    return prompt
  }

  const wrapped = (content) => `${base}\n\n${embeddedLabel}:\n\`\`\`md\n${content}\n\`\`\``
  const fullPrompt = wrapped(String(embeddedContent || ""))
  if (!Number.isFinite(maxPromptTokens) || estimateTokens(fullPrompt) <= maxPromptTokens) {
    return fullPrompt
  }

  warn(`Prompt exceeds configured maxPromptTokens (${maxPromptTokens}); truncating embedded content.`)
  const reservedChars = Math.max(base.length + embeddedLabel.length + 32, 0)
  const maxChars = Math.max(maxPromptTokens * 4 - reservedChars, 0)
  return wrapped(truncateText(String(embeddedContent || ""), maxChars))
}
