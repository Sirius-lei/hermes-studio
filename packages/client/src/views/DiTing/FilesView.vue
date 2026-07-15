<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useFilesStore } from '@/stores/DiTing/files'
import { useProfilesStore } from '@/stores/DiTing/profiles'
import FileTree from '@/components/DiTing/files/FileTree.vue'
import FileBreadcrumb from '@/components/DiTing/files/FileBreadcrumb.vue'
import FileToolbar from '@/components/DiTing/files/FileToolbar.vue'
import FileList from '@/components/DiTing/files/FileList.vue'
import FileContextMenu from '@/components/DiTing/files/FileContextMenu.vue'
import FileEditor from '@/components/DiTing/files/FileEditor.vue'
import FilePreview from '@/components/DiTing/files/FilePreview.vue'
import FileUploadModal from '@/components/DiTing/files/FileUploadModal.vue'
import FileRenameModal from '@/components/DiTing/files/FileRenameModal.vue'
import type { FileEntry } from '@/api/DiTing/files'

const filesStore = useFilesStore()
const profilesStore = useProfilesStore()

const contextMenuRef = ref<InstanceType<typeof FileContextMenu> | null>(null)
const showUpload = ref(false)
const showRenameModal = ref(false)
const renameMode = ref<'newFile' | 'newFolder' | 'rename'>('newFile')
const renameEntry = ref<FileEntry | null>(null)
const renameTargetPath = ref<string | null>(null)

function handleContextMenu(e: MouseEvent, entry: FileEntry) {
  contextMenuRef.value?.show(e, entry)
}

function handleShowNewFile() {
  renameMode.value = 'newFile'
  renameEntry.value = null
  renameTargetPath.value = null
  showRenameModal.value = true
}

function handleShowNewFolder() {
  renameMode.value = 'newFolder'
  renameEntry.value = null
  renameTargetPath.value = null
  showRenameModal.value = true
}

function handleContextNewFolder(entry: FileEntry) {
  renameMode.value = 'newFolder'
  renameEntry.value = null
  renameTargetPath.value = entry.isDir ? entry.path : filesStore.currentPath
  showRenameModal.value = true
}

function handleRename(entry: FileEntry) {
  renameMode.value = 'rename'
  renameEntry.value = entry
  renameTargetPath.value = null
  showRenameModal.value = true
}

async function loadRoot() {
  if (!profilesStore.activeProfileName || profilesStore.profiles.length === 0) {
    await profilesStore.fetchProfiles()
  }
  await filesStore.fetchEntries('')
}

onMounted(() => {
  void loadRoot()
})
</script>

<template>
  <div class="files-view">
    <div class="files-tree-panel">
      <FileTree />
    </div>
    <div class="files-main-panel">
      <FileToolbar
        @show-new-file="handleShowNewFile"
        @show-new-folder="handleShowNewFolder"
        @show-upload="showUpload = true"
      />
      <FileBreadcrumb />
      <div class="files-content">
        <FileEditor v-if="filesStore.editingFile" />
        <FilePreview v-else-if="filesStore.previewFile" />
        <FileList v-else @contextmenu-entry="handleContextMenu" />
      </div>
    </div>
    <FileContextMenu
      ref="contextMenuRef"
      @rename="handleRename"
      @new-folder="handleContextNewFolder"
    />
    <FileUploadModal v-model:show="showUpload" />
    <FileRenameModal
      v-model:show="showRenameModal"
      :mode="renameMode"
      :entry="renameEntry"
      :target-path="renameTargetPath"
    />
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.files-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.files-tree-panel {
  width: 240px;
  min-width: 180px;
  max-width: 400px;
  border-right: 1px solid $border-color;
  overflow-y: auto;
  flex-shrink: 0;
}

.files-main-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.files-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

@media (max-width: $breakpoint-mobile) {
  .files-view {
    flex-direction: column;
  }

  .files-tree-panel {
    width: 100%;
    max-width: none;
    height: 200px;
    border-right: none;
    border-bottom: 1px solid $border-color;
  }
}
</style>
