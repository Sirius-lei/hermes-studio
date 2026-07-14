import type { FileEntry } from '@/api/DiTing/files'

export function getClipboardPathForEntry(entry: FileEntry): string {
  return entry.absolutePath || entry.path
}
