import fs from "fs"
import path from "path"

function isUnderNodeModules(value) {
  if (!value) return false
  const normalized = path.resolve(value)
  return normalized.split(path.sep).includes("node_modules")
}

function normalizeExistingPath(value) {
  if (!value || typeof value !== "string") return null
  const normalized = path.resolve(value)
  return fs.existsSync(normalized) ? normalized : null
}

export function resolveWorkspaceCwd(options = {}) {
  const env = options.env || process.env
  const processCwd = path.resolve(options.cwd || process.cwd())

  const explicit = normalizeExistingPath(env.UXL_CWD)
  if (explicit) return explicit

  const initCwd = normalizeExistingPath(env.INIT_CWD)
  if (initCwd) return initCwd

  const pwd = normalizeExistingPath(env.PWD)
  if (pwd && isUnderNodeModules(processCwd) && !isUnderNodeModules(pwd)) {
    return pwd
  }

  return processCwd
}
