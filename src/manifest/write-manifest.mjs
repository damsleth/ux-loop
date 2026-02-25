import fs from "fs"
import path from "path"

function normalizeGroup(group) {
  if (!group || typeof group !== "object") {
    throw new Error("Capture adapter must return group objects.")
  }
  const label = String(group.label || "").trim()
  if (!label) {
    throw new Error("Each capture group must include a non-empty label.")
  }
  if (!Array.isArray(group.files) || group.files.length === 0) {
    throw new Error(`Capture group \"${label}\" must include a non-empty files array.`)
  }

  return {
    label,
    files: group.files.map((entry) => String(entry)),
  }
}

export function writeManifest(manifestPath, groups) {
  const normalizedGroups = groups.map(normalizeGroup)
  const payload = {
    generatedAt: new Date().toISOString(),
    groups: normalizedGroups,
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return payload
}
