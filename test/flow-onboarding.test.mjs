import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  assertFullFlowCoverage,
  discoverTopLevelRoutes,
  evaluateFlowCoverage,
  extractTestCasesFromSource,
} from "../src/capture/flow-onboarding.mjs"

test("evaluateFlowCoverage reports complete coverage at 100%", () => {
  const report = evaluateFlowCoverage({
    flowInventory: [{ id: "home", label: "Home", required: true }],
    flowMapping: { home: ["home"] },
    playwrightFlows: [{ name: "home" }],
  })

  assert.equal(report.complete, true)
  assert.equal(report.coveragePercent, 100)
})

test("evaluateFlowCoverage reports unmapped required entries", () => {
  const report = evaluateFlowCoverage({
    flowInventory: [{ id: "home", label: "Home", required: true }],
    flowMapping: {},
    playwrightFlows: [{ name: "home" }],
  })

  assert.equal(report.complete, false)
  assert.deepEqual(report.unmappedRequiredIds, ["home"])
})

test("assertFullFlowCoverage throws actionable error for incomplete coverage", () => {
  assert.throws(
    () =>
      assertFullFlowCoverage({
        capture: {
          runner: "playwright",
          flowInventory: [{ id: "home", label: "Home", required: true }],
          flowMapping: {},
          playwright: { flows: [{ name: "home", label: "Home", path: "/" }] },
        },
      }),
    /uxl flows check/
  )
})

test("assertFullFlowCoverage accepts complete mappings", () => {
  const report = assertFullFlowCoverage({
    capture: {
      runner: "playwright",
      flowInventory: [{ id: "home", label: "Home", required: true }],
      flowMapping: { home: ["home"] },
      playwright: { flows: [{ name: "home", label: "Home", path: "/" }] },
    },
  })

  assert.equal(report.complete, true)
})

test("extractTestCasesFromSource handles multiline test definitions", () => {
  const source = `
    test(
      "Checkout flow",
      async ({ page }) => {
        await page.goto("/checkout")
      }
    )
  `

  const extracted = extractTestCasesFromSource(source, "fallback")
  assert.equal(extracted.length, 1)
  assert.equal(extracted[0].title, "Checkout flow")
  assert.equal(extracted[0].path, "/checkout")
})

test("extractTestCasesFromSource supports template literal titles and test.only", () => {
  const source = [
    "const name = \"cart\"",
    "test.only(\`${name} flow\`, async ({ page }) => {",
    "  await page.goto('/cart')",
    "})",
  ].join("\n")

  const extracted = extractTestCasesFromSource(source, "fallback")
  assert.equal(extracted.length, 1)
  assert.equal(extracted[0].title, "* flow")
  assert.equal(extracted[0].path, "/cart")
})

// Plan 02: custom runner coverage gate tests

test("evaluateFlowCoverage passes for custom runner with mapped required entries", () => {
  const report = evaluateFlowCoverage({
    flowInventory: [{ id: "home", label: "Home", required: true }],
    flowMapping: { home: ["any-value"] },
    playwrightFlows: [],
    runner: "custom",
  })

  assert.equal(report.complete, true)
  assert.equal(report.coveragePercent, 100)
  assert.deepEqual(report.invalidMappedFlowNames, [])
})

test("evaluateFlowCoverage rejects missing mappings for custom runner", () => {
  const report = evaluateFlowCoverage({
    flowInventory: [{ id: "home", label: "Home", required: true }],
    flowMapping: {},
    playwrightFlows: [],
    runner: "custom",
  })

  assert.equal(report.complete, false)
  assert.deepEqual(report.unmappedRequiredIds, ["home"])
})

test("evaluateFlowCoverage still validates mapped names for playwright runner", () => {
  const report = evaluateFlowCoverage({
    flowInventory: [{ id: "home", label: "Home", required: true }],
    flowMapping: { home: ["nonexistent-flow"] },
    playwrightFlows: [{ name: "real-flow" }],
    runner: "playwright",
  })

  assert.equal(report.complete, false)
  assert.equal(report.invalidMappedFlowNames.length, 1)
  assert.equal(report.invalidMappedFlowNames[0].inventoryId, "home")
})

test("assertFullFlowCoverage passes for valid custom runner config", () => {
  const report = assertFullFlowCoverage({
    capture: {
      runner: "custom",
      flowInventory: [{ id: "dashboard", label: "Dashboard", required: true }],
      flowMapping: { dashboard: ["dashboard-shot"] },
    },
  })

  assert.equal(report.complete, true)
})

test("assertFullFlowCoverage rejects missing mappings for custom runner", () => {
  assert.throws(
    () =>
      assertFullFlowCoverage({
        capture: {
          runner: "custom",
          flowInventory: [{ id: "dashboard", label: "Dashboard", required: true }],
          flowMapping: {},
        },
      }),
    /uxl flows check/
  )
})

// Plan 04: expanded route discovery tests

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-routes-"))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function writeFile(dir, relPath, content = "") {
  const full = path.join(dir, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, "utf8")
}

test("discoverTopLevelRoutes finds routes from root-level pages/index.tsx", () => {
  withTempDir((dir) => {
    writeFile(dir, "pages/index.tsx", "export default function Home() {}")
    writeFile(dir, "pages/about.tsx", "export default function About() {}")

    const routes = discoverTopLevelRoutes(dir)
    assert.ok(routes.includes("/"), "should include /")
    assert.ok(routes.includes("/about"), "should include /about")
  })
})

test("discoverTopLevelRoutes finds routes from src/pages/", () => {
  withTempDir((dir) => {
    writeFile(dir, "src/pages/index.tsx", "export default function Home() {}")
    writeFile(dir, "src/pages/contact.tsx", "export default function Contact() {}")

    const routes = discoverTopLevelRoutes(dir)
    assert.ok(routes.includes("/"), "should include /")
    assert.ok(routes.includes("/contact"), "should include /contact")
  })
})

test("discoverTopLevelRoutes finds routes from app/ page.tsx files", () => {
  withTempDir((dir) => {
    writeFile(dir, "app/page.tsx", "export default function Home() {}")
    writeFile(dir, "app/settings/page.tsx", "export default function Settings() {}")

    const routes = discoverTopLevelRoutes(dir)
    assert.ok(routes.includes("/"), "should include /")
    assert.ok(routes.includes("/settings"), "should include /settings")
  })
})

test("discoverTopLevelRoutes finds routes from src/app/ page.tsx files", () => {
  withTempDir((dir) => {
    writeFile(dir, "src/app/page.tsx", "export default function Home() {}")
    writeFile(dir, "src/app/profile/page.tsx", "export default function Profile() {}")

    const routes = discoverTopLevelRoutes(dir)
    assert.ok(routes.includes("/"), "should include /")
    assert.ok(routes.includes("/profile"), "should include /profile")
  })
})

test("discoverTopLevelRoutes deduplicates routes across multiple layout sources", () => {
  withTempDir((dir) => {
    // Both pages/ and src/pages/ define the same route
    writeFile(dir, "pages/about.tsx", "export default function About() {}")
    writeFile(dir, "src/pages/about.tsx", "export default function About() {}")
    // Both app/ and src/app/ define the same route
    writeFile(dir, "app/dashboard/page.tsx", "export default function Dashboard() {}")
    writeFile(dir, "src/app/dashboard/page.tsx", "export default function Dashboard() {}")

    const routes = discoverTopLevelRoutes(dir)
    const aboutCount = routes.filter((r) => r === "/about").length
    const dashboardCount = routes.filter((r) => r === "/dashboard").length

    assert.equal(aboutCount, 1, "/about should appear exactly once")
    assert.equal(dashboardCount, 1, "/dashboard should appear exactly once")
  })
})

test("discoverTopLevelRoutes ignores dynamic segments and underscore-prefixed pages files", () => {
  withTempDir((dir) => {
    writeFile(dir, "pages/[id].tsx", "")
    writeFile(dir, "pages/_app.tsx", "")
    writeFile(dir, "src/app/[slug]/page.tsx", "")

    const routes = discoverTopLevelRoutes(dir)
    assert.ok(!routes.some((r) => r.includes("[")), "should not include dynamic routes")
    assert.ok(!routes.includes("/_app"), "should not include _app")
  })
})
