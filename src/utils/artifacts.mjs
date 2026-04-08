import fs from "fs"
import path from "path"

function pad2(value) {
  return String(value).padStart(2, "0")
}

function pad3(value) {
  return String(value).padStart(3, "0")
}

export function buildTimestampedArtifactName(prefix, extension = "json", date = new Date()) {
  const yyyy = date.getFullYear()
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const min = pad2(date.getMinutes())
  const sec = pad2(date.getSeconds())
  const ms = pad3(date.getMilliseconds())
  return `${prefix}_${yyyy}-${mm}-${dd}_${hh}${min}${sec}${ms}.${extension}`
}

export function rotateArtifacts(dir, matcher, maxEntries) {
  if (!Number.isFinite(maxEntries) || maxEntries <= 0 || !fs.existsSync(dir)) return

  const entries = fs
    .readdirSync(dir)
    .filter((entry) => matcher.test(entry))
    .map((entry) => ({
      entry,
      path: path.join(dir, entry),
      mtimeMs: fs.statSync(path.join(dir, entry)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  for (const stale of entries.slice(maxEntries)) {
    fs.rmSync(stale.path, { recursive: true, force: true })
  }
}

export function writeJsonArtifact({ dir, prefix, payload, maxEntries = 50, date = new Date() }) {
  fs.mkdirSync(dir, { recursive: true })
  const fileName = buildTimestampedArtifactName(prefix, "json", date)
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  rotateArtifacts(dir, new RegExp(`^${prefix}_\\d{4}-\\d{2}-\\d{2}_\\d+\\.json$`), maxEntries)
  return filePath
}

export function listArtifactPaths(dir, matcher) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((entry) => matcher.test(entry))
    .map((entry) => {
      const filePath = path.join(dir, entry)
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map(({ filePath }) => filePath)
}

export function readLatestJsonArtifact(dir, matcher) {
  const matches = listArtifactPaths(dir, matcher)
  if (matches.length === 0) return null
  return {
    path: matches[0],
    data: JSON.parse(fs.readFileSync(matches[0], "utf8")),
  }
}
