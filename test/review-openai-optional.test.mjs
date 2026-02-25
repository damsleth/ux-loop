import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { reviewWithOpenAi } from "../src/runners/review-openai.mjs"

test("reviewWithOpenAi reports clear install guidance when openai package is unavailable", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-openai-test-"))
  const pngPath = path.join(tempDir, "shot.png")

  try {
    fs.writeFileSync(
      pngPath,
      Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex")
    )

    await assert.rejects(
      () =>
        reviewWithOpenAi({
          apiKey: "test-key",
          model: "gpt-5",
          prompt: "Review",
          label: "Sample",
          filePaths: [pngPath],
          openAiLoader: async () => {
            throw new Error("Cannot find package 'openai'")
          },
        }),
      /OpenAI runner selected but the \"openai\" package is not installed/
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
