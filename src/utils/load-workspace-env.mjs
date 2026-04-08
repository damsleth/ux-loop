import fs from "fs"
import path from "path"

const DEFAULT_ENV_FILES = [".env", ".env.local"]

function stripWrappingQuotes(value) {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

function parseEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) return null

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : trimmed
  const separatorIndex = normalized.indexOf("=")
  if (separatorIndex <= 0) return null

  const key = normalized.slice(0, separatorIndex).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null

  const rawValue = normalized.slice(separatorIndex + 1).trim()
  return {
    key,
    value: stripWrappingQuotes(rawValue),
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const entries = {}
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const parsed = parseEnvLine(line)
    if (!parsed) continue
    entries[parsed.key] = parsed.value
  }
  return entries
}

export function loadWorkspaceEnv(cwd = process.cwd(), targetEnv = process.env, files = DEFAULT_ENV_FILES) {
  const rootDir = path.resolve(cwd)
  const existingKeys = new Set(Object.keys(targetEnv))
  const merged = {}

  for (const filename of files) {
    Object.assign(merged, parseEnvFile(path.join(rootDir, filename)))
  }

  for (const [key, value] of Object.entries(merged)) {
    if (!existingKeys.has(key)) {
      targetEnv[key] = value
    }
  }
}
