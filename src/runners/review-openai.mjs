import fs from "fs"

async function loadOpenAiClientClass() {
  const module = await import("openai")
  return module.default
}

async function resolveOpenAiClientClass(openAiLoader) {
  try {
    return await (openAiLoader || loadOpenAiClientClass)()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `OpenAI runner selected but the "openai" package is not installed. Install it with \`npm i openai\`. (${message})`
    )
  }
}

function getImageDataUrl(filePath) {
  const buffer = fs.readFileSync(filePath)
  return `data:image/png;base64,${buffer.toString("base64")}`
}

function extractText(response) {
  return response?.choices?.[0]?.message?.content?.trim() || ""
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise

  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function reviewWithOpenAi({
  apiKey,
  apiKeyEnv = "OPENAI_API_KEY",
  imageDetail = "high",
  model,
  prompt,
  label,
  filePaths,
  timeoutMs,
  openAiLoader,
  logger = console,
}) {
  const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : ""
  if (!normalizedApiKey) {
    throw new Error(`${apiKeyEnv} is not set. Add it to your environment.`)
  }

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing screenshot: ${filePath}`)
    }
  }

  logger?.log?.(`OpenAI review input for "${label}": ${filePaths.length} image(s)`)

  const OpenAI = await resolveOpenAiClientClass(openAiLoader)
  const client = new OpenAI({ apiKey: normalizedApiKey })
  const content = [{ type: "text", text: `Review this screenshot group: ${label}.` }]
  for (const filePath of filePaths) {
    content.push({
      type: "image_url",
      image_url: { url: getImageDataUrl(filePath), detail: imageDetail },
    })
  }

  const startedAt = Date.now()
  const response = await withTimeout(
    client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content },
      ],
    }),
    timeoutMs,
    `OpenAI review for "${label}"`
  )
  logger?.log?.(`OpenAI completed for "${label}" in ${Date.now() - startedAt}ms`)

  const text = extractText(response)
  if (!text) {
    throw new Error(`OpenAI response for \"${label}\" did not contain text output.`)
  }
  logger?.log?.(`OpenAI output for "${label}":\n${text}`)
  return text
}
