const SEVERITY_ORDER = ["CRITICAL", "MAJOR", "MINOR"]
const SEVERITY_WEIGHTS = {
  CRITICAL: 20,
  MAJOR: 10,
  MINOR: 3,
}

export function extractSeverityCounts(text) {
  const normalized = String(text || "")
  const counts = {
    critical: 0,
    major: 0,
    minor: 0,
  }

  for (const severity of SEVERITY_ORDER) {
    const matches = normalized.match(new RegExp(`^\\[(?:${severity})\\]\\s+`, "gim"))
    counts[severity.toLowerCase()] = matches ? matches.length : 0
  }

  if (counts.critical === 0 && counts.major === 0 && counts.minor === 0) {
    const fallbackMatches = normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
      .filter((line) => !/no issues found\.?/i.test(line))
    counts.minor = fallbackMatches.length
  }

  return counts
}

export function computeReviewScore(counts) {
  const totalPenalty =
    (counts.critical || 0) * SEVERITY_WEIGHTS.CRITICAL +
    (counts.major || 0) * SEVERITY_WEIGHTS.MAJOR +
    (counts.minor || 0) * SEVERITY_WEIGHTS.MINOR

  return Math.max(0, Math.min(100, 100 - totalPenalty))
}

export function buildReviewScoreSummary(text) {
  const issues = extractSeverityCounts(text)
  const totalIssues = issues.critical + issues.major + issues.minor
  const score = totalIssues === 0 ? 100 : computeReviewScore(issues)

  return {
    score,
    issues,
    totalIssues,
  }
}
