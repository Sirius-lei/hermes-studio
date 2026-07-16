import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertContentBlocksAccessibleToUser,
  convertContentBlocks,
  convertContentBlocksForAgent,
} from '../../packages/server/src/services/DiTing/run-chat/content-blocks'
import { getUserStorageRoot } from '../../packages/server/src/services/DiTing/user-storage'

let tempDir = ''

describe('run chat content blocks', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'DiTing-content-blocks-'))
  })

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  it('keeps API image conversion as base64 input_image only', async () => {
    const imagePath = join(tempDir, 'image.png')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))

    const parts = await convertContentBlocks([
      { type: 'text', text: 'animate this' },
      { type: 'image', name: 'image.png', path: imagePath, media_type: 'image/png' },
    ])

    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'input_text', text: 'animate this' })
    expect(parts[1].type).toBe('input_image')
    expect(parts[1].image_url).toMatch(/^data:image\/png;base64,/)
    expect(JSON.stringify(parts)).not.toContain('Local image path for tools')
  })

  it('adds local file path text for bridge agents while preserving the image data', async () => {
    const imagePath = join(tempDir, 'image.png')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))

    const parts = await convertContentBlocksForAgent([
      { type: 'text', text: 'animate this' },
      { type: 'image', name: 'image.png', path: imagePath, media_type: 'image/png' },
    ])

    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ type: 'text', text: 'animate this' })
    expect(parts[1]).toEqual({
      type: 'text',
      text: `[Attached image: image.png]\nLocal image path for tools: ${imagePath}`,
    })
    expect(parts[2].type).toBe('image_url')
    expect(parts[2].image_url?.url).toMatch(/^data:image\/png;base64,/)
  })

  it('allows ordinary users to attach files only from their own storage root', () => {
    const ownFile = join(getUserStorageRoot(7), 'files', 'default', 'upload.txt')
    const otherUserFile = join(getUserStorageRoot(8), 'files', 'default', 'upload.txt')

    expect(() => assertContentBlocksAccessibleToUser([
      { type: 'file', name: 'upload.txt', path: ownFile },
    ], { id: 7, role: 'admin' })).not.toThrow()

    expect(() => assertContentBlocksAccessibleToUser([
      { type: 'file', name: 'upload.txt', path: otherUserFile },
    ], { id: 7, role: 'admin' })).toThrow('Attached file is not available for this user')
  })

  it('allows super administrators to inspect files outside user storage', () => {
    expect(() => assertContentBlocksAccessibleToUser([
      { type: 'file', name: 'system.log', path: '/tmp/system.log' },
    ], { id: 1, role: 'super_admin' })).not.toThrow()
  })
})
