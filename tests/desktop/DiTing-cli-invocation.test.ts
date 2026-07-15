import { describe, expect, it } from 'vitest'
import { resolveDesktopDiTingCliInvocation } from '../../packages/desktop/src/main/DiTing-cli-invocation'

describe('desktop DiTing CLI invocation', () => {
  it('bypasses the uv DiTing.exe trampoline on Windows', () => {
    expect(resolveDesktopDiTingCliInvocation(
      'win32',
      'C:\\Users\\Administrator\\.diting-web-ui\\desktop-runtime\\DiTing\\0.15.2\\win-x64\\python\\Scripts\\DiTing.exe',
      'C:\\Users\\Administrator\\.diting-web-ui\\desktop-runtime\\DiTing\\0.15.2\\win-x64\\python\\python.exe',
    )).toEqual({
      command: 'C:\\Users\\Administrator\\.diting-web-ui\\desktop-runtime\\DiTing\\0.15.2\\win-x64\\python\\python.exe',
      argsPrefix: ['-m', 'diting_cli.main'],
    })
  })

  it('keeps normal launcher execution on non-Windows platforms', () => {
    expect(resolveDesktopDiTingCliInvocation(
      'darwin',
      '/Users/example/.diting-web-ui/desktop-runtime/DiTing/0.15.2/mac-arm64/python/bin/DiTing',
      '/Users/example/.diting-web-ui/desktop-runtime/DiTing/0.15.2/mac-arm64/python/bin/python3',
    )).toEqual({
      command: '/Users/example/.diting-web-ui/desktop-runtime/DiTing/0.15.2/mac-arm64/python/bin/DiTing',
      argsPrefix: [],
    })
  })
})
