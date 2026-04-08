import fs from "fs"
import path from "path"
import { loadConfig } from "../config/load-config.mjs"
import { readLatestJsonArtifact } from "../utils/artifacts.mjs"

function parseReportArgs(args) {
  const values = {
    left: null,
    right: null,
  }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token === "--left" || token === "--right") {
      const next = args[i + 1]
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${token}`)
      }
      values[token.slice(2)] = next
      i += 1
      continue
    }
    throw new Error(`Unknown flag: ${token}`)
  }

  return values
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
    renderReport(latest.data, latest.path)
    return {
      status: "success",
      reportPath: latest.path,
      report: latest.data,
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
