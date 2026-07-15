import { spawn } from 'node:child_process'

export interface LaunchResult {
  code: null | number
  error?: string
}

const resolveDiTingBin = () => process.env.DiTing_BIN?.trim() || 'diting'

export const launchDiTingCommand = (args: string[]): Promise<LaunchResult> =>
  new Promise(resolve => {
    const child = spawn(resolveDiTingBin(), args, { stdio: 'inherit' })

    child.on('error', err => resolve({ code: null, error: err.message }))
    child.on('exit', code => resolve({ code }))
  })
