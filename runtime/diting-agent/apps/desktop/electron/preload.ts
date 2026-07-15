import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('ditingDesktop', {
  getConnection: profile => ipcRenderer.invoke('diting:connection', profile),
  revalidateConnection: () => ipcRenderer.invoke('diting:connection:revalidate'),
  touchBackend: profile => ipcRenderer.invoke('diting:backend:touch', profile),
  getGatewayWsUrl: profile => ipcRenderer.invoke('diting:gateway:ws-url', profile),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('diting:window:openSession', sessionId, opts),
  openNewSessionWindow: () => ipcRenderer.invoke('diting:window:openNewSession'),
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('diting:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('diting:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('diting:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('diting:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('diting:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('diting:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('diting:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('diting:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('diting:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('diting:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('diting:pet-overlay:control', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('diting:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('diting:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('diting:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('diting:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('diting:connection-config:test', payload),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('diting:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('diting:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('diting:connection-config:oauth-logout', remoteUrl),
  // DiTing Cloud: one portal login powers discovery + silent per-agent sign-in
  // (cloud-auto-discovery Phase 3).
  cloud: {
    status: () => ipcRenderer.invoke('diting:cloud:status'),
    login: () => ipcRenderer.invoke('diting:cloud:login'),
    logout: () => ipcRenderer.invoke('diting:cloud:logout'),
    discover: org => ipcRenderer.invoke('diting:cloud:discover', org),
    agentSignIn: dashboardUrl => ipcRenderer.invoke('diting:cloud:agent-sign-in', dashboardUrl)
  },
  profile: {
    get: () => ipcRenderer.invoke('diting:profile:get'),
    set: name => ipcRenderer.invoke('diting:profile:set', name)
  },
  api: request => ipcRenderer.invoke('diting:api', request),
  notify: payload => ipcRenderer.invoke('diting:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('diting:requestMicrophoneAccess'),
  readFileDataUrl: filePath => ipcRenderer.invoke('diting:readFileDataUrl', filePath),
  readFileText: filePath => ipcRenderer.invoke('diting:readFileText', filePath),
  selectPaths: options => ipcRenderer.invoke('diting:selectPaths', options),
  writeClipboard: text => ipcRenderer.invoke('diting:writeClipboard', text),
  saveImageFromUrl: url => ipcRenderer.invoke('diting:saveImageFromUrl', url),
  saveImageBuffer: (data, ext) => ipcRenderer.invoke('diting:saveImageBuffer', { data, ext }),
  saveClipboardImage: () => ipcRenderer.invoke('diting:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('diting:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('diting:watchPreviewFile', url),
  stopPreviewFileWatch: id => ipcRenderer.invoke('diting:stopPreviewFileWatch', id),
  setTitleBarTheme: payload => ipcRenderer.send('diting:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('diting:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('diting:translucency', payload),
  setPreviewShortcutActive: active => ipcRenderer.send('diting:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('diting:openExternal', url),
  openPreviewInBrowser: url => ipcRenderer.invoke('diting:openPreviewInBrowser', url),
  fetchLinkTitle: url => ipcRenderer.invoke('diting:fetchLinkTitle', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('diting:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('diting:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('diting:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('diting:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('diting:zoom:get'),
    setPercent: percent => ipcRenderer.send('diting:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('diting:zoom:changed', listener)

      return () => ipcRenderer.removeListener('diting:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('diting:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('diting:logs:recent'),
  readDir: dirPath => ipcRenderer.invoke('diting:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('diting:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('diting:fs:reveal', targetPath),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('diting:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('diting:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('diting:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('diting:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('diting:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('diting:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('diting:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('diting:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('diting:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('diting:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('diting:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('diting:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('diting:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('diting:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('diting:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('diting:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('diting:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('diting:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('diting:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('diting:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('diting:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('diting:git:review:shipInfo', repoPath),
      createPr: repoPath => ipcRenderer.invoke('diting:git:review:createPr', repoPath)
    }
  },
  terminal: {
    cwd: id => ipcRenderer.invoke('diting:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('diting:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('diting:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('diting:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('diting:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `diting:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `diting:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('diting:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('diting:close-preview-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('diting:open-updates', listener)

    return () => ipcRenderer.removeListener('diting:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('diting:deep-link', listener)

    return () => ipcRenderer.removeListener('diting:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('diting:deep-link-ready'),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('diting:window-state-changed', listener)

    return () => ipcRenderer.removeListener('diting:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('diting:focus-session', listener)

    return () => ipcRenderer.removeListener('diting:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('diting:notification-action', listener)

    return () => ipcRenderer.removeListener('diting:notification-action', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('diting:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('diting:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('diting:backend-exit', listener)

    return () => ipcRenderer.removeListener('diting:backend-exit', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('diting:connection:applied', listener)

    return () => ipcRenderer.removeListener('diting:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('diting:power-resume', listener)

    return () => ipcRenderer.removeListener('diting:power-resume', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('diting:boot-progress', listener)

    return () => ipcRenderer.removeListener('diting:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('diting:bootstrap:get'),
  resetBootstrap: () => ipcRenderer.invoke('diting:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('diting:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('diting:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('diting:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('diting:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('diting:version'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('diting:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('diting:uninstall:summary'),
    run: mode => ipcRenderer.invoke('diting:uninstall:run', { mode })
  },
  updates: {
    check: () => ipcRenderer.invoke('diting:updates:check'),
    apply: opts => ipcRenderer.invoke('diting:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('diting:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('diting:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('diting:updates:progress', listener)

      return () => ipcRenderer.removeListener('diting:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('diting:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('diting:vscode-theme:search', query)
  }
})
