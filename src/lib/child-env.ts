/** Kindprozesse sollen nicht den Production-Modus des Next-Servers erben. */
export function childEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...source }
  delete env.NODE_ENV
  delete env.NEXT_RUNTIME
  return env as NodeJS.ProcessEnv
}
