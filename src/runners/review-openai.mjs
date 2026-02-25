import fs from "fs"

async function loadOpenAiClientClass() {
  try {
    const module = await import("openai")
    return module.default
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `OpenAI runner selected but the \"openai\" package is not installed. Install it with \`npm i -D openai\`. (${message})`
    )
  }
}

async function resolveOpenAiClientClass(openAiLoader) {
  try {
    return await (openAiLoader || loadOpenAiClientClass)()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("OpenAI runner selected but the \"openai\" package is not installed")) {
      throw error
    }
    throw new Error(
      `OpenAI runner selected but the \"openai\" package is not installed. Install it with \`npm i -D openai\`. (${message})`
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

export async function reviewWithOpenAi({ apiKey, model, prompt, label, filePaths, openAiLoader }) {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing screenshot: ${filePath}`)
    }
  }

  const OpenAI = await resolveOpenAiClientClass(openAiLoader)
  const client = new OpenAI({ apiKey })
  const content = [{ type: "text", text: `Review this screenshot group: ${label}.` }]
  for (const filePath of filePaths) {
    content.push({
      type: "image_url",
      image_url: { url: getImageDataUrl(filePath), detail: "high" },
    })
  }

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content },
    ],
  })

  const text = extractText(response)
  if (!text) {
    throw new Error(`OpenAI response for \"${label}\" did not contain text output.`)
  }
  return text
}
