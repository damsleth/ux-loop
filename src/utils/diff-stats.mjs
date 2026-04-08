export function parseNumstat(text) {
  const files = []
  let filesChanged = 0
  let linesAdded = 0
  let linesRemoved = 0

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue
    const [addedRaw, removedRaw, ...rest] = line.split("\t")
    const file = rest.join("\t").trim()
    const added = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10) || 0
    const removed = removedRaw === "-" ? 0 : Number.parseInt(removedRaw, 10) || 0
    files.push(file)
    filesChanged += 1
    linesAdded += added
    linesRemoved += removed
  }

  return {
    files,
    filesChanged,
    linesAdded,
    linesRemoved,
  }
}
