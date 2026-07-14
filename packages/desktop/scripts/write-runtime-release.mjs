#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DiTingVersion, runtimeReleaseTag } from './runtime-config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const outFile = resolve(ROOT, 'build', 'runtime-release.json')
const tag = runtimeReleaseTag()
const DiTingAgentVersion = DiTingVersion()

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify({ tag, DiTingAgentVersion }, null, 2) + '\n')
console.log(`Runtime release metadata: ${tag}`)
