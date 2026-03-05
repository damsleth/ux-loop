export const REASONING_EFFORT_VALUES = ["low", "medium", "high", "extraHigh"]

export function validateReasoningEffort(value, sourceLabel) {
  if (value === undefined) return
  if (!REASONING_EFFORT_VALUES.includes(value)) {
    throw new Error(`Invalid ${sourceLabel}: "${value}". Allowed: ${REASONING_EFFORT_VALUES.join(", ")}.`)
  }
}
