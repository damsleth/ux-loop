export function parseCliOptions(args, spec = {}) {
  const values = {}
  const valueOptions = new Set(spec.valueOptions || [])
  const booleanOptions = new Set(spec.booleanOptions || [])

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }

    if (token.includes("=")) {
      const [rawKey, ...rest] = token.slice(2).split("=")
      if (valueOptions.has(rawKey)) {
        const value = rest.join("=")
        if (!value) {
          throw new Error(`Missing value for --${rawKey}`)
        }
        values[rawKey] = value
        continue
      }

      if (booleanOptions.has(rawKey)) {
        const value = rest.join("=")
        if (!["true", "false"].includes(value)) {
          throw new Error(`Invalid value for --${rawKey}: expected true or false.`)
        }
        values[rawKey] = value === "true"
        continue
      }

      throw new Error(`Unknown flag: --${rawKey}`)
    }

    const key = token.slice(2)
    if (booleanOptions.has(key)) {
      values[key] = true
      continue
    }

    if (!valueOptions.has(key)) {
      throw new Error(`Unknown flag: --${key}`)
    }

    const next = args[i + 1]
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }

    values[key] = next
    i += 1
  }

  return values
}
