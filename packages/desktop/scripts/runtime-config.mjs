export const DEFAULT_DiTing_VERSION = '0.17.0'

export function DiTingVersion(env = process.env) {
  return env.DiTing_VERSION || DEFAULT_DiTing_VERSION
}

export function runtimeReleaseTag(env = process.env) {
  const version = DiTingVersion(env)
  return env.DiTing_DESKTOP_RUNTIME_RELEASE_TAG
    || env.RUNTIME_RELEASE_TAG
    || `DiTing-${version}-runtime`
}
