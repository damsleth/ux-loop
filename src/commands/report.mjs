import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { readLatestJsonArtifact } from "../utils/artifacts.mjs"

const VALID_FORMATS = new Set(["console", "github", "markdown"])
const COMMENT_BODY_CAP = 60000 // GitHub's hard limit is 65536; leave headroom.
const REPORT_MARKER = "<!-- uxl-report -->"

function parseReportArgs(args) {
  const values = {
    left: null,
    right: null,
    format: "console",
    failUnder: null,
  }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token === "--left" || token === "--right" || token === "--format" || token === "--fail-under") {
      const next = args[i + 1]
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${token}`)
      }
      if (token === "--format") {
        if (!VALID_FORMATS.has(next)) {
          throw new Error(`Invalid --format: "${next}". Allowed: console, github, markdown.`)
        }
        values.format = next
      } else if (token === "--fail-under") {
        values.failUnder = normalizeFailUnder(next)
      } else {
        values[token.slice(2)] = next
      }
      i += 1
      continue
    }
    throw new Error(`Unknown flag: ${token}`)
  }

  return values
}

function normalizeFailUnder(value) {
  const resolved = Number.parseInt(value, 10)
  if (!Number.isInteger(resolved) || String(resolved) !== String(value).trim() || resolved < 1 || resolved > 100) {
    throw new Error("Invalid --fail-under: expected an integer between 1 and 100.")
  }
  return resolved
}

// Pull the headline score from either a `run` report (top-level final_score) or
// a `review` report (steps[].score). Falls back to the last scored step.
export function extractReportScore(report) {
  if (typeof report.final_score === "number") return report.final_score
  if (typeof report.score === "number") return report.score
  const steps = report.steps || []
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (typeof steps[i].score === "number") return steps[i].score
  }
  return null
}

function aggregateSeverity(report) {
  const totals = { critical: 0, major: 0, minor: 0 }
  let found = false
  for (const step of report.steps || []) {
    if (step && step.issues && typeof step.issues === "object") {
      found = true
      totals.critical += step.issues.critical || 0
      totals.major += step.issues.major || 0
      totals.minor += step.issues.minor || 0
    }
  }
  return found ? totals : null
}

// Plan 36 sub-scores are optional — only present on review reports.
function extractSubScores(report) {
  for (const step of report.steps || []) {
    if (!step) continue
    const objective = step.objective_score ?? step.objectiveScore ?? null
    const prose = step.prose_score ?? step.proseScore ?? null
    if (objective != null || prose != null) return { objective, prose }
  }
  return null
}

function extractFindings(markdown, limit = 10) {
  if (!markdown) return []
  const findings = []
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^\[(CRITICAL|MAJOR|MINOR)\]\s+/i.test(line)) {
      findings.push(line)
      if (findings.length >= limit) break
    }
  }
  return findings
}

// Build a sticky-comment-ready markdown body. Tolerates pre-plan-36 reports
// (no sub-scores) and reports whose steps carry no issues (score-only output).
export function formatGithubReport(report, markdown = "", { includeMarker = true } = {}) {
  const score = extractReportScore(report)
  const severity = aggregateSeverity(report)
  const subScores = extractSubScores(report)
  const findings = extractFindings(markdown)

  const lines = []
  if (includeMarker) lines.push(REPORT_MARKER)
  lines.push(`## 🔍 ux-loop UX review — score ${score ?? "n/a"}/100`)
  lines.push("")

  if (severity) {
    lines.push("| severity | count |")
    lines.push("| --- | --- |")
    lines.push(`| 🔴 critical | ${severity.critical} |`)
    lines.push(`| 🟠 major | ${severity.major} |`)
    lines.push(`| 🟡 minor | ${severity.minor} |`)
    lines.push("")
  }

  if (subScores && (subScores.objective != null || subScores.prose != null)) {
    lines.push(`**Sub-scores:** objective ${subScores.objective ?? "n/a"} · prose ${subScores.prose ?? "n/a"}`)
    lines.push("")
  }

  if (findings.length > 0) {
    lines.push("**Top findings:**")
    for (const finding of findings) lines.push(`- ${finding}`)
    lines.push("")
  }

  const truncationHint = "_… see workflow artifacts for the full report_"
  let body = lines.join("\n").trimEnd() + "\n"
  if (body.length > COMMENT_BODY_CAP) {
    // Suffix appended below is "\n\n" + hint + "\n" = hint.length + 3 chars.
    const budget = COMMENT_BODY_CAP - truncationHint.length - 3
    body = body.slice(0, Math.max(0, budget)).trimEnd() + "\n\n" + truncationHint + "\n"
  }
  return body
}

function renderReport(report, reportPath) {
  console.log(`Report: ${reportPath}`)
  console.log(`Command: ${report.command}`)
  console.log(`Status: ${report.status}`)
  console.log(`Duration: ${report.duration_ms}ms`)
  if (report.initial_score !== undefined || report.final_score !== undefined) {
    console.log(`Scores: ${report.initial_score ?? "n/a"} -> ${report.final_score ?? "n/a"}`)
  }
  for (const step of report.steps || []) {
    console.log(
      `${step.iteration ? `iteration ${step.iteration} ` : ""}${step.step}: ${step.status} (${step.duration_ms}ms)`
    )
  }
}

export async function runReport(args = [], cwd = process.cwd(), runtime = {}) {
  const options = parseReportArgs(args)
  const load = runtime.loadConfig || loadConfig
  const config = await load(cwd)
  const matcher = /^uxl_report_\d{4}-\d{2}-\d{2}_\d+\.json$/

  if (!options.left && !options.right) {
    const latest = readLatestJsonArtifact(config.paths.reportsDir, matcher)
    if (!latest) {
      throw new Error(`No structured reports found in ${config.paths.reportsDir}.`)
    }

    const score = extractReportScore(latest.data)
    const belowThreshold = options.failUnder != null && score != null && score < options.failUnder

    if (options.format === "github" || options.format === "markdown") {
      const markdownReadPath = config.paths.reportPath
      let markdown = ""
      if (markdownReadPath) {
        const readFile = runtime.readFileSync || fs.readFileSync
        try {
          markdown = readFile(markdownReadPath, "utf8")
        } catch {
          markdown = "" // report.md may not exist (e.g. a run-only report); fall back to score-only
        }
      }
      const body = formatGithubReport(latest.data, markdown, { includeMarker: options.format === "github" })
      process.stdout.write(body)
    } else {
      renderReport(latest.data, latest.path)
    }

    if (belowThreshold) {
      console.error(`uxl report: score ${score} is below --fail-under ${options.failUnder}.`)
    }

    return {
      status: "success",
      reportPath: latest.path,
      report: latest.data,
      score,
      format: options.format,
      failUnder: options.failUnder,
      belowThreshold,
    }
  }

  if (!options.left || !options.right) {
    throw new Error("Provide both --left and --right to compare reports.")
  }

  const leftPath = path.resolve(cwd, options.left)
  const rightPath = path.resolve(cwd, options.right)
  const left = JSON.parse(runtime.readFile ? await runtime.readFile(leftPath, "utf8") : fs.readFileSync(leftPath, "utf8"))
  const right = JSON.parse(runtime.readFile ? await runtime.readFile(rightPath, "utf8") : fs.readFileSync(rightPath, "utf8"))

  console.log(`Compare: ${leftPath} -> ${rightPath}`)
  console.log(`Status: ${left.status} -> ${right.status}`)
  console.log(`Duration: ${left.duration_ms}ms -> ${right.duration_ms}ms`)
  console.log(`Final score: ${left.final_score ?? left.steps?.find((step) => step.score !== null)?.score ?? "n/a"} -> ${right.final_score ?? right.steps?.find((step) => step.score !== null)?.score ?? "n/a"}`)

  return {
    status: "success",
    leftPath,
    rightPath,
  }
}
