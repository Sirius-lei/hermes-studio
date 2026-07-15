import { isUtf8 } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(process.argv[2] || '.')
const legacyLower = ['her', 'mes'].join('')
const forbidden = [
  legacyLower,
  `${legacyLower[0].toUpperCase()}${legacyLower.slice(1)}`,
  legacyLower.toUpperCase(),
]
const findings = []

function inspectPath(path) {
  const rel = relative(root, path) || '.'
  for (const marker of forbidden) {
    if (rel.includes(marker)) findings.push(`${rel}: forbidden path marker ${JSON.stringify(marker)}`)
  }

  const stat = lstatSync(path)
  if (!stat.isFile()) return
  const content = readFileSync(path)
  for (const marker of forbidden) {
    const needle = Buffer.from(marker)
    if (content.indexOf(needle) === -1) continue
    if (!isUtf8(content)) {
      findings.push(`${rel}: forbidden binary marker ${JSON.stringify(marker)}`)
      continue
    }
    const lines = content.toString('utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (line.includes(marker)) findings.push(`${rel}:${index + 1}: forbidden marker ${JSON.stringify(marker)}`)
    })
  }
}

function walkBuildOutput(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    inspectPath(path)
    if (entry.isDirectory() && !entry.isSymbolicLink()) walkBuildOutput(path)
  }
}

const repositoryFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
).split('\0').filter(Boolean)

repositoryFiles.forEach(file => inspectPath(resolve(root, file)))

const dist = resolve(root, 'dist')
if (existsSync(dist)) walkBuildOutput(dist)

if (findings.length > 0) {
  console.error(`Brand audit failed with ${findings.length} finding(s):`)
  findings.slice(0, 200).forEach(finding => console.error(`- ${finding}`))
  if (findings.length > 200) console.error(`- ... ${findings.length - 200} more`)
  process.exit(1)
}

console.log('Brand audit passed: no legacy product markers found')
