import fs from "fs"
import path from "path"

const BUILTIN_PRESETS = {
  clean: () => import("./presets/clean.mjs"),
  enterprise: () => import("./presets/enterprise.mjs"),
  "mobile-first": () => import("./presets/mobile-first.mjs"),
}

export async function loadStylePreset(style, rootDir) {
  if (!style) return ""

  if (BUILTIN_PRESETS[style]) {
    const module = await BUILTIN_PRESETS[style]()
    return String(module.stylePreset || "").trim()
  }

  const candidatePath = path.resolve(rootDir || process.cwd(), style)
  if (!fs.existsSync(candidatePath)) {
    throw new Error(
      `Invalid style preset: "${style}". Use clean, enterprise, mobile-first, or a readable file path.`
    )
  }

  return fs.readFileSync(candidatePath, "utf8").trim()
}
