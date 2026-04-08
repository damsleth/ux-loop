import fs from "fs"
import path from "path"
import { createRequire } from "module"

const ROUTE_FILE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
])

const PLAYWRIGHT_CONFIG_FILENAMES = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs",
  "playwright.config.mts",
  "playwright.config.cts",
]

const IGNORED_DIRS = new Set([
  ".git",
  ".uxl",
  "coverage",
  "dist",
  "build",
  ".next",
  "node_modules",
])

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function walkFiles(rootDir, visitor) {
  if (!fs.existsSync(rootDir)) return

  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        stack.push(fullPath)
        continue
      }

      visitor(fullPath)
    }
  }
}

function looksLikePlaywrightTestFile(filePath) {
  const basename = path.basename(filePath)
  if (!basename.includes(".spec.") && !basename.includes(".test.")) return false
  return ROUTE_FILE_EXTENSIONS.has(path.extname(filePath))
}

function normalizePathCandidate(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return "/"
  const value = rawValue.trim()
  if (!value) return "/"

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const parsed = new URL(value)
      const pathname = parsed.pathname || "/"
      return pathname.startsWith("/") ? pathname : `/${pathname}`
    } catch {
      return "/"
    }
  }

  if (value.startsWith("/")) return value

  const compact = value.replace(/^\.\/+/, "").replace(/^\/+/, "")
  return compact ? `/${compact}` : "/"
}

function makeUniqueKey(baseKey, usedKeys) {
  const root = slugify(baseKey) || "flow"
  let key = root
  let counter = 2

  while (usedKeys.has(key)) {
    key = `${root}-${counter}`
    counter += 1
  }

  usedKeys.add(key)
  return key
}

function decodeQuotedLiteral(literal) {
  if (!literal || typeof literal !== "string") return ""
  const quote = literal[0]
  const endQuote = literal[literal.length - 1]
  if ((quote !== "\"" && quote !== "'" && quote !== "`") || endQuote !== quote) {
    return literal
  }

  const body = literal.slice(1, -1)
  if (quote === "`") {
    // Preserve template strings but normalize interpolations to a stable placeholder.
    return body.replace(/\$\{[^}]*\}/g, "*")
  }

  return body
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([\\"'])/g, "$1")
}

export function extractTestCasesFromSource(sourceText, fallbackPrefix = "flow") {
  const cases = []
  const usedIds = new Set()

  const stringLiteral = "(?:\"(?:\\\\.|[^\\\"])*\"|'(?:\\\\.|[^\\'])*'|`(?:\\\\.|[^`])*`)"
  const callRegex = new RegExp(`test(?:\\.(?:only|skip|fixme))?\\s*\\(\\s*(${stringLiteral})`, "gs")
  const gotoRegex = new RegExp(`page\\.goto\\(\\s*(${stringLiteral})`, "s")

  let callMatch
  while ((callMatch = callRegex.exec(sourceText)) !== null) {
    const titleLiteral = callMatch[1]
    const title = decodeQuotedLiteral(titleLiteral).trim()
    const snippet = sourceText.slice(callMatch.index, callMatch.index + 1200)
    const gotoMatch = snippet.match(gotoRegex)
    const routePath = normalizePathCandidate(decodeQuotedLiteral(gotoMatch?.[1] || ""))
    const id = makeUniqueKey(title || fallbackPrefix, usedIds)

    cases.push({
      id,
      title: title || "Untitled flow",
      path: routePath,
    })
  }

  if (cases.length > 0) {
    return cases
  }

  const titleRegex = new RegExp(`test(?:\\.(?:only|skip|fixme))?\\s*\\(\\s*(${stringLiteral})`, "gs")
  let titleMatch
  while ((titleMatch = titleRegex.exec(sourceText)) !== null) {
    const title = decodeQuotedLiteral(titleMatch[1]).trim()
    const id = makeUniqueKey(title || fallbackPrefix, usedIds)
    cases.push({
      id,
      title: title || "Untitled flow",
      path: "/",
    })
  }

  return cases
}

export function detectPlaywrightInstalled(cwd = process.cwd()) {
  try {
    const requireFromCwd = createRequire(path.join(cwd, "package.json"))
    requireFromCwd.resolve("playwright")
    return true
  } catch {
    return false
  }
}

export function findPlaywrightConfigPath(cwd = process.cwd()) {
  for (const filename of PLAYWRIGHT_CONFIG_FILENAMES) {
    const candidate = path.join(cwd, filename)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

function extractQuotedValue(text, regex) {
  const match = text.match(regex)
  if (!match) return null
  return match[2] || null
}

export function readPlaywrightConfigSnapshot(cwd = process.cwd()) {
  const configPath = findPlaywrightConfigPath(cwd)
  if (!configPath) {
    return null
  }

  let sourceText
  try {
    sourceText = fs.readFileSync(configPath, "utf8")
  } catch {
    return { configPath }
  }

  const baseUrl = extractQuotedValue(sourceText, /\bbaseURL\b\s*:\s*(["'`])([^"'`]+)\1/)
  const webServerCommand = extractQuotedValue(sourceText, /\bwebServer\b[\s\S]*?\bcommand\b\s*:\s*(["'`])([^"'`]+)\1/)

  return {
    configPath,
    baseUrl: baseUrl || undefined,
    webServerCommand: webServerCommand || undefined,
  }
}

export function discoverPlaywrightTests(cwd = process.cwd()) {
  const found = []

  walkFiles(cwd, (filePath) => {
    if (!looksLikePlaywrightTestFile(filePath)) return

    try {
      const text = fs.readFileSync(filePath, "utf8")
      if (text.includes("@playwright/test") || text.includes("playwright/test")) {
        found.push(filePath)
      }
    } catch {
      // Ignore unreadable files.
    }
  })

  return found.sort()
}

function routeFromPagesFile(relativePath) {
  let withoutExt = relativePath.replace(path.extname(relativePath), "")

  if (withoutExt === "index") return "/"
  if (withoutExt.startsWith("_")) return null

  withoutExt = withoutExt.replace(/\\/g, "/")
  if (withoutExt.endsWith("/index")) {
    withoutExt = withoutExt.slice(0, -"/index".length)
  }
  if (!withoutExt) return "/"
  if (withoutExt.includes("[") || withoutExt.includes("]")) return null

  return `/${withoutExt}`
}

function routeFromAppPage(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/")
  const segments = normalized.split("/")
  segments.pop()

  const kept = []
  for (const segment of segments) {
    if (!segment) continue
    if (segment.startsWith("(") && segment.endsWith(")")) continue
    if (segment.includes("[") || segment.includes("]")) return null
    kept.push(segment)
  }

  if (kept.length === 0) return "/"
  return `/${kept.join("/")}`
}

export function discoverTopLevelRoutes(cwd = process.cwd()) {
  const routes = new Set(["/"])

  const pagesDirs = [
    path.join(cwd, "pages"),
    path.join(cwd, "src", "pages"),
  ]
  for (const pagesDir of pagesDirs) {
    if (fs.existsSync(pagesDir) && fs.statSync(pagesDir).isDirectory()) {
      walkFiles(pagesDir, (filePath) => {
        if (!ROUTE_FILE_EXTENSIONS.has(path.extname(filePath))) return
        const relative = path.relative(pagesDir, filePath)
        const route = routeFromPagesFile(relative)
        if (route) routes.add(route)
      })
    }
  }

  const appDirs = [
    path.join(cwd, "app"),
    path.join(cwd, "src", "app"),
  ]
  for (const appDir of appDirs) {
    if (fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()) {
      walkFiles(appDir, (filePath) => {
        const basename = path.basename(filePath)
        if (!basename.startsWith("page.")) return
        if (!ROUTE_FILE_EXTENSIONS.has(path.extname(filePath))) return

        const relative = path.relative(appDir, filePath)
        const route = routeFromAppPage(relative)
        if (route) routes.add(route)
      })
    }
  }

  return [...routes].sort()
}

export function importPlaywrightFlowSuggestions(cwd = process.cwd()) {
  const files = discoverPlaywrightTests(cwd)
  const usedInventoryIds = new Set()
  const usedFlowNames = new Set()
  const inventory = []
  const flows = []
  const flowMapping = {}

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8")
    const fallbackPrefix = slugify(path.basename(filePath, path.extname(filePath))) || "flow"
    const extracted = extractTestCasesFromSource(source, fallbackPrefix)

    for (const entry of extracted) {
      const inventoryId = makeUniqueKey(entry.id || fallbackPrefix, usedInventoryIds)
      const flowName = makeUniqueKey(entry.id || fallbackPrefix, usedFlowNames)
      const label = entry.title || inventoryId
      const flowPath = normalizePathCandidate(entry.path)

      inventory.push({
        id: inventoryId,
        label,
        path: flowPath,
        required: true,
      })

      flows.push({
        label,
        name: flowName,
        path: flowPath,
        waitFor: "body",
        settleMs: 200,
        screenshot: { fullPage: true },
      })

      flowMapping[inventoryId] = [flowName]
    }
  }

  return {
    files,
    inventory,
    flows,
    flowMapping,
  }
}

export function buildFlowScaffold(cwd = process.cwd()) {
  const imported = importPlaywrightFlowSuggestions(cwd)
  if (imported.inventory.length > 0) {
    return {
      source: "playwright-import",
      ...imported,
    }
  }

  const routes = discoverTopLevelRoutes(cwd)
  const used = new Set()

  const inventory = []
  const flows = []
  const flowMapping = {}

  for (const routePath of routes.length > 0 ? routes : ["/"]) {
    const baseKey = routePath === "/" ? "home" : routePath
    const key = makeUniqueKey(baseKey, used)
    const label = routePath === "/" ? "Home" : `Route ${routePath}`

    inventory.push({
      id: key,
      label,
      path: routePath,
      required: true,
    })

    flows.push({
      label,
      name: key,
      path: routePath,
      waitFor: "body",
      settleMs: 200,
      screenshot: { fullPage: true },
    })

    flowMapping[key] = [key]
  }

  return {
    source: "route-scan",
    files: [],
    inventory,
    flows,
    flowMapping,
  }
}

export function evaluateFlowCoverage({ flowInventory, flowMapping, playwrightFlows, runner }) {
  const inventory = Array.isArray(flowInventory)
    ? flowInventory.map((entry) => ({ ...entry, required: entry?.required !== false }))
    : []

  const mapping = isObject(flowMapping) ? flowMapping : {}

  const isCustomRunner = runner === "custom"

  const flowNames = new Set(
    Array.isArray(playwrightFlows)
      ? playwrightFlows
          .map((flow) => (typeof flow?.name === "string" ? flow.name.trim() : ""))
          .filter(Boolean)
      : []
  )

  const requiredInventory = inventory.filter((entry) => entry.required)
  const requiredIds = requiredInventory.map((entry) => entry.id)

  const unmappedRequiredIds = []
  const mappedRequiredIds = []
  const invalidMappedFlowNames = []

  for (const entry of requiredInventory) {
    const mapped = Array.isArray(mapping[entry.id])
      ? mapping[entry.id].filter((flowName) => typeof flowName === "string" && flowName.trim())
      : []

    if (mapped.length === 0) {
      unmappedRequiredIds.push(entry.id)
      continue
    }

    if (!isCustomRunner) {
      const invalid = mapped.filter((flowName) => !flowNames.has(flowName))
      if (invalid.length > 0) {
        invalidMappedFlowNames.push({
          inventoryId: entry.id,
          flowNames: invalid,
        })
        continue
      }
    }

    mappedRequiredIds.push(entry.id)
  }

  const unknownInventoryMappingIds = Object.keys(mapping).filter(
    (inventoryId) => !inventory.some((entry) => entry.id === inventoryId)
  )

  const totalRequired = requiredIds.length
  const mappedRequired = mappedRequiredIds.length
  const coverage = totalRequired > 0 ? mappedRequired / totalRequired : 0
  const complete =
    totalRequired > 0 &&
    unmappedRequiredIds.length === 0 &&
    invalidMappedFlowNames.length === 0 &&
    unknownInventoryMappingIds.length === 0

  return {
    totalInventory: inventory.length,
    totalRequired,
    mappedRequired,
    coverage,
    coveragePercent: Number((coverage * 100).toFixed(2)),
    requiredIds,
    mappedRequiredIds,
    unmappedRequiredIds,
    invalidMappedFlowNames,
    unknownInventoryMappingIds,
    complete,
  }
}

export function buildCoverageErrorMessage(report) {
  const lines = []
  lines.push(
    `Flow mapping is incomplete: ${report.coveragePercent}% (${report.mappedRequired}/${report.totalRequired} required flows mapped).`
  )

  if (report.unmappedRequiredIds.length > 0) {
    lines.push(`Unmapped required inventory IDs: ${report.unmappedRequiredIds.join(", ")}`)
  }

  if (report.invalidMappedFlowNames.length > 0) {
    const invalidPairs = report.invalidMappedFlowNames
      .map((entry) => `${entry.inventoryId} -> [${entry.flowNames.join(", ")}]`)
      .join("; ")
    lines.push(`Mappings reference unknown capture flow names: ${invalidPairs}`)
  }

  if (report.unknownInventoryMappingIds.length > 0) {
    lines.push(
      `flowMapping contains IDs not present in flowInventory: ${report.unknownInventoryMappingIds.join(", ")}`
    )
  }

  lines.push("Run `uxl flows check` to inspect and fix coverage blockers.")
  return lines.join("\n")
}

export function assertFullFlowCoverage(config) {
  const capture = config?.capture
  if (!capture || !Array.isArray(capture.flowInventory) || capture.flowInventory.length === 0) {
    throw new Error("Missing capture.flowInventory. Define full user-flow inventory first, then run `uxl flows check`.")
  }

  if (!isObject(capture.flowMapping)) {
    throw new Error("Missing capture.flowMapping. Map every required inventory flow to capture.playwright.flows names.")
  }

  if (capture.runner === "playwright") {
    if (!Array.isArray(capture.playwright?.flows) || capture.playwright.flows.length === 0) {
      throw new Error("Missing capture.playwright.flows. Define capture flows before running `uxl shots`.")
    }
  }

  const report = evaluateFlowCoverage({
    flowInventory: capture.flowInventory,
    flowMapping: capture.flowMapping,
    playwrightFlows: capture.playwright?.flows,
    runner: capture.runner,
  })

  if (!report.complete) {
    throw new Error(buildCoverageErrorMessage(report))
  }

  return report
}

export function mergeImportedSuggestions({
  flowInventory,
  flowMapping,
  playwrightFlows,
  imported,
}) {
  const nextInventory = Array.isArray(flowInventory) ? [...flowInventory] : []
  const nextMapping = isObject(flowMapping) ? { ...flowMapping } : {}
  const nextFlows = Array.isArray(playwrightFlows) ? [...playwrightFlows] : []

  const usedInventoryIds = new Set(nextInventory.map((entry) => entry.id))
  const usedFlowNames = new Set(
    nextFlows
      .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
      .filter(Boolean)
  )

  let added = 0

  for (const importedInventoryEntry of imported.inventory || []) {
    const sourceId = importedInventoryEntry.id || importedInventoryEntry.label || "flow"
    const sourceFlowName = imported.flowMapping?.[importedInventoryEntry.id]?.[0] || sourceId
    const flowTemplate = (imported.flows || []).find((flow) => flow.name === sourceFlowName)

    const inventoryId = makeUniqueKey(sourceId, usedInventoryIds)
    const flowName = makeUniqueKey(sourceFlowName, usedFlowNames)

    nextInventory.push({
      id: inventoryId,
      label: importedInventoryEntry.label,
      path: importedInventoryEntry.path,
      required: importedInventoryEntry.required !== false,
    })

    nextFlows.push({
      ...(flowTemplate || {
        label: importedInventoryEntry.label,
        path: importedInventoryEntry.path,
        waitFor: "body",
        settleMs: 200,
        screenshot: { fullPage: true },
      }),
      name: flowName,
    })

    nextMapping[inventoryId] = [flowName]
    added += 1
  }

  return {
    flowInventory: nextInventory,
    flowMapping: nextMapping,
    playwrightFlows: nextFlows,
    added,
  }
}
