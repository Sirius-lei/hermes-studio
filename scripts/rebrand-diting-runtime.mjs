import { isUtf8 } from 'node:buffer'
import {
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

const runtimeRoot = resolve(process.argv[2] || 'runtime/diting-agent')
const legacyLower = ['her', 'mes'].join('')
const legacyTitle = `${legacyLower[0].toUpperCase()}${legacyLower.slice(1)}`
const legacyUpper = legacyLower.toUpperCase()
const replacements = [
  [legacyUpper, 'DiTing'],
  [legacyTitle, 'DiTing'],
  [legacyLower, 'diting'],
  ['DITING', 'DiTing'],
]

function renamed(value) {
  return replacements.reduce(
    (result, [from, to]) => result.replaceAll(from, to),
    value,
  )
}

function walk(directory, paths = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    paths.push(path)
    if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path, paths)
  }
  return paths
}

const initialPaths = walk(runtimeRoot)
let changedFiles = 0
let renamedPaths = 0

for (const path of initialPaths) {
  const stat = lstatSync(path)
  if (!stat.isFile()) continue
  const input = readFileSync(path)
  if (!isUtf8(input)) continue
  const source = input.toString('utf8')
  const output = renamed(source)
  if (output !== source) {
    writeFileSync(path, output)
    changedFiles += 1
  }
}

for (const path of initialPaths.sort((left, right) => right.length - left.length)) {
  const nextPath = resolve(dirname(path), renamed(basename(path)))
  if (nextPath !== path) {
    renameSync(path, nextPath)
    renamedPaths += 1
  }
}

console.log(`Rebranded DiTing runtime: ${changedFiles} files changed, ${renamedPaths} paths renamed`)
