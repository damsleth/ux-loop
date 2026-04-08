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

test("reviewWithOpenAi fails early when api key is missing", async () => {
  await assert.rejects(
    () =>
      reviewWithOpenAi({
        apiKey: "",
        model: "gpt-5",
        prompt: "Review",
        label: "Sample",
        filePaths: [],
      }),
    /OPENAI_API_KEY is not set/
  )
})

test("reviewWithOpenAi mentions the configured api key env name", async () => {
  await assert.rejects(
    () =>
      reviewWithOpenAi({
        apiKey: "",
        apiKeyEnv: "UXL_OPENAI_KEY",
        model: "gpt-5",
        prompt: "Review",
        label: "Sample",
        filePaths: [],
      }),
    /UXL_OPENAI_KEY is not set/
  )
})

test("reviewWithOpenAi forwards configurable image detail", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-openai-detail-"))
  const pngPath = path.join(tempDir, "shot.png")

  fs.writeFileSync(
    pngPath,
    Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex")
  )

  let capturedDetail = null

  class FakeOpenAi {
    constructor() {
      this.chat = {
        completions: {
          create: async (payload) => {
            const imageItem = payload.messages[1].content.find((item) => item.type === "image_url")
            capturedDetail = imageItem.image_url.detail
            return { choices: [{ message: { content: "- issue" } }] }
          },
        },
      }
    }
  }

  try {
    const text = await reviewWithOpenAi({
      apiKey: "test-key",
      imageDetail: "low",
      model: "gpt-5",
      prompt: "Review",
      label: "Sample",
      filePaths: [pngPath],
      openAiLoader: async () => FakeOpenAi,
      logger: { log() {}, warn() {}, error() {} },
    })

    assert.equal(text, "- issue")
    assert.equal(capturedDetail, "low")
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test("reviewWithOpenAi enforces timeout boundaries", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxl-openai-timeout-"))
  const pngPath = path.join(tempDir, "shot.png")

  fs.writeFileSync(
    pngPath,
    Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex")
  )

  class HangingOpenAi {
    constructor() {
      this.chat = {
        completions: {
          create: async () => new Promise(() => {}),
        },
      }
    }
  }

  try {
    await assert.rejects(
      () =>
        reviewWithOpenAi({
          apiKey: "test-key",
          model: "gpt-5",
          prompt: "Review",
          label: "Sample",
          filePaths: [pngPath],
          timeoutMs: 10,
          openAiLoader: async () => HangingOpenAi,
          logger: { log() {}, warn() {}, error() {} },
        }),
      /OpenAI review for "Sample" timed out after 10ms/
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
