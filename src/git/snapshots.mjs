import fs from "fs"
import path from "path"
import { listArtifactPaths, writeJsonArtifact } from "../utils/artifacts.mjs"

const SNAPSHOT_MATCHER = /^uxl_snapshot_\d{4}-\d{2}-\d{2}_\d+\.json$/

export function writeSnapshot(snapshotsDir, payload, date = new Date()) {
  return writeJsonArtifact({
    dir: snapshotsDir,
    prefix: "uxl_snapshot",
    payload,
    maxEntries: 20,
    date,
  })
}

export function listSnapshots(snapshotsDir) {
  return listArtifactPaths(snapshotsDir, SNAPSHOT_MATCHER).map((filePath) => ({
    path: filePath,
    snapshot: JSON.parse(fs.readFileSync(filePath, "utf8")),
  }))
}

export function readSnapshot(snapshotsDir, targetTimestamp) {
  const snapshots = listSnapshots(snapshotsDir)
  if (snapshots.length === 0) {
    throw new Error(`No snapshots found in ${snapshotsDir}.`)
  }

  if (!targetTimestamp) {
    return snapshots[0]
  }

  const match = snapshots.find((entry) => path.basename(entry.path).includes(targetTimestamp))
  if (!match) {
    throw new Error(`Snapshot not found for "${targetTimestamp}".`)
  }
  return match
}
