export interface DesktopDiTingCliInvocation {
  command: string
  argsPrefix: string[]
}

export function resolveDesktopDiTingCliInvocation(
  platform: NodeJS.Platform,
  DiTingBin: string,
  python: string,
): DesktopDiTingCliInvocation {
  if (platform === 'win32') {
    return { command: python, argsPrefix: ['-m', 'diting_cli.main'] }
  }
  return { command: DiTingBin, argsPrefix: [] }
}
