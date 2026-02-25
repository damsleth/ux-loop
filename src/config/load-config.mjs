import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { normalizeConfig } from "./schema.mjs"

export async function loadConfig(cwd = process.cwd()) {
  const configPath = path.resolve(cwd, "uxl.config.mjs")
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing uxl.config.mjs at ${configPath}. Run \`uxl init\`.`)
  }

  const loaded = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)
  const raw = loaded?.default
  if (!raw || typeof raw !== "object") {
    throw new Error(`uxl.config.mjs must export a default config object via defineUxlConfig().`)
  }

  return normalizeConfig(raw, configPath)
}
