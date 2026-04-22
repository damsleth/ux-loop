import path from "path"

const DEFAULT_MIN = 40000
const DEFAULT_MAX = 49999

function fnv1a32(input) {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function derivePortFromCwd(cwd, { min = DEFAULT_MIN, max = DEFAULT_MAX } = {}) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) {
    throw new Error(`derivePortFromCwd: invalid range [${min}, ${max}].`)
  }
  const basename = path.basename(String(cwd || "")) || "uxl"
  const span = max - min + 1
  return min + (fnv1a32(basename) % span)
}
