import { loadRawConfig } from "./config-file.mjs"
import { normalizeConfig } from "./schema.mjs"

export async function loadConfig(cwd = process.cwd()) {
  const { configPath, raw } = await loadRawConfig(cwd)
  const withRoot = {
    ...raw,
    paths: {
      ...(raw.paths || {}),
      root: raw?.paths?.root || cwd,
    },
  }
  return normalizeConfig(withRoot, configPath)
}
