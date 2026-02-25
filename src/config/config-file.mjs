import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"

function serializeConfig(config) {
  return `import { defineUxlConfig } from "@damsleth/ux-loop"\n\nexport default defineUxlConfig(${JSON.stringify(
    config,
    null,
    2
  )})\n`
}

export function getConfigPath(cwd = process.cwd()) {
  return path.resolve(cwd, "uxl.config.mjs")
}

export async function loadRawConfig(cwd = process.cwd()) {
  const configPath = getConfigPath(cwd)
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing uxl.config.mjs at ${configPath}. Run \`uxl init\`.`)
  }

  const loaded = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)
  const raw = loaded?.default
  if (!raw || typeof raw !== "object") {
    throw new Error("uxl.config.mjs must export a default config object via defineUxlConfig().")
  }

  return {
    configPath,
    raw,
  }
}

export function writeConfigFile(configPath, config) {
  fs.writeFileSync(configPath, serializeConfig(config), "utf8")
}
