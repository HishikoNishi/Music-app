const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('musicApi', {
  chooseMusic: () => ipcRenderer.invoke('library:choose'),
  addPaths: (paths) => ipcRenderer.invoke('library:add-paths', paths),
  readState: () => ipcRenderer.invoke('state:read'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  updatePlayback: (playback) => ipcRenderer.send('playback:update', playback),
  getFilePath: (file) => webUtils.getPathForFile(file),
  chooseCover: () => ipcRenderer.invoke('playlist:choose-cover'),
  onCommand: (listener) => {
    const handler = (_, command) => listener(command);
    ipcRenderer.on('player:command', handler);
    return () => ipcRenderer.removeListener('player:command', handler);
  },
  /** YouTube: kiểm tra API Key và tìm kiếm (key chỉ dùng ở main process). */
  hasYouTubeKey: () => ipcRenderer.invoke('youtube:has-key'),
  searchYouTube: (query) => ipcRenderer.invoke('youtube:search', query),
  getArtistUploads: (channelId) => ipcRenderer.invoke('youtube:get-artist-uploads', channelId),
  searchPlaylists: (query) => ipcRenderer.invoke('youtube:search-playlists', query),
  getPlaylistItems: (params) => ipcRenderer.invoke('youtube:get-playlist-items', params)
});
