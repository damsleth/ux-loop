export const OBJECTIVE_WEIGHTS = {
  axe: { critical: 15, serious: 8, moderate: 3, minor: 1 },
  heuristics: {
    missingViewportMeta: 10,
    perSmallTapTarget: 2,
    perLowContrastSample: 1,
    fontSizesBeyond4: 2,
  },
}

/**
 * Compute an objective score (0–100) from a single group's metrics object.
 * Returns 100 when metrics is absent or empty.
 */
export function computeObjectiveScore(metrics) {
  if (!metrics) return 100

  let penalty = 0

  const axe = metrics.axe
  if (axe) {
    penalty += (axe.critical || 0) * OBJECTIVE_WEIGHTS.axe.critical
    penalty += (axe.serious || 0) * OBJECTIVE_WEIGHTS.axe.serious
    penalty += (axe.moderate || 0) * OBJECTIVE_WEIGHTS.axe.moderate
    penalty += (axe.minor || 0) * OBJECTIVE_WEIGHTS.axe.minor
  }

  const h = metrics.heuristics
  if (h) {
    if (h.viewportMeta === false) penalty += OBJECTIVE_WEIGHTS.heuristics.missingViewportMeta
    penalty += (h.smallTapTargets || 0) * OBJECTIVE_WEIGHTS.heuristics.perSmallTapTarget
    penalty += (h.lowContrastSamples || 0) * OBJECTIVE_WEIGHTS.heuristics.perLowContrastSample
    const extraFontSizes = Math.max(0, (h.fontSizeCount || 0) - 4)
    penalty += extraFontSizes * OBJECTIVE_WEIGHTS.heuristics.fontSizesBeyond4
  }

  return Math.max(0, Math.min(100, 100 - penalty))
}

/**
 * Aggregate metrics across all manifest groups and return a single objective
 * score (0–100).  Returns null when no group in `groups` has a `metrics`
 * field so the caller can detect "no metrics available".
 */
export function buildObjectiveScoreSummary(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return null

  const groupsWithMetrics = groups.filter((g) => g && g.metrics)
  if (groupsWithMetrics.length === 0) return null

  const scores = groupsWithMetrics.map((g) => computeObjectiveScore(g.metrics))
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length
  return Math.round(avg)
}

/**
 * Blend an objective score and a prose (review) score into a single composite.
 *
 * @param {object} opts
 * @param {number|null} opts.objective  - from buildObjectiveScoreSummary (null = absent)
 * @param {number|null} opts.review     - prose score from buildReviewScoreSummary (null = absent)
 * @param {object}      [opts.weights]  - override defaults ({ objective: 0.6, review: 0.4 })
 * @returns {{ score: number, source: "blended"|"review-prose"|"objective" }}
 */
export function blendScores({ objective, review, weights } = {}) {
  const w = { objective: 0.6, review: 0.4, ...weights }

  const hasObjective = objective !== null && objective !== undefined
  const hasReview = review !== null && review !== undefined

  if (hasObjective && hasReview) {
    return {
      score: Math.round(w.objective * objective + w.review * review),
      source: "blended",
    }
  }

  if (hasObjective) {
    return { score: Math.round(objective), source: "objective" }
  }

  if (hasReview) {
    return { score: Math.round(review), source: "review-prose" }
  }

  // Nothing available — return 100 with a review-prose source so callers get
  // a non-null number.
  return { score: 100, source: "review-prose" }
}
