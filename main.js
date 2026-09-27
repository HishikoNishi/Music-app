const { app, BrowserWindow, Tray, Menu, dialog, globalShortcut, ipcMain, nativeImage, session } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.flac', '.wav', '.ogg']);

/** Đọc API Key từ config.js (không commit file này lên git). */
let youtubeApiKey = '';
try {
  youtubeApiKey = require('./config.js').YOUTUBE_API_KEY || '';
} catch {
  console.warn('[Music App] Chưa có config.js — copy từ config.example.js và điền YouTube API Key.');
}

let mainWindow;
let tray;
let store;
let isQuitting = false;
let playback = { isPlaying: false };
let localServerPort = 0;

async function startLocalServer() {
  const appExpress = express();
  appExpress.use(express.static(__dirname));

  return new Promise((resolve, reject) => {
    const httpServer = appExpress.listen(0, '127.0.0.1', () => {
      localServerPort = httpServer.address().port;
      console.log(`[Music App] Local server running at http://127.0.0.1:${localServerPort}`);
      resolve();
    });
    httpServer.on('error', reject);
  });
}

function getAppIconPath() {
  return path.join(__dirname, 'assets', 'icon.png');
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('player:command', command);
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = mainWindow && mainWindow.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? 'Ẩn cửa sổ' : 'Mở cửa sổ', click: toggleWindow },
    { type: 'separator' },
    { label: playback.isPlaying ? 'Tạm dừng' : 'Phát', click: () => sendCommand('toggle-playback') },
    { label: 'Bài tiếp theo', click: () => sendCommand('next') },
    { label: 'Bài trước', click: () => sendCommand('previous') },
    { type: 'separator' },
    {
      label: 'Thoát',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
  updateTrayMenu();
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(getAppIconPath());
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Rove in Heaven',
    icon: appIcon,
    backgroundColor: '#10101b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${localServerPort}/player.html`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      updateTrayMenu();
    }
  });
  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(getAppIconPath()).resize({ width: 16, height: 16 }));
  tray.setToolTip('Music Tray Player');
  tray.on('click', toggleWindow);
  updateTrayMenu();
}

async function collectAudioFiles(inputPaths) {
  const found = [];
  const visit = async (candidate) => {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(candidate, { withFileTypes: true });
        await Promise.all(entries.map((entry) => visit(path.join(candidate, entry.name))));
      } else if (stat.isFile() && AUDIO_EXTENSIONS.has(path.extname(candidate).toLowerCase())) {
        found.push(candidate);
      }
    } catch {
      // Skip files and folders that become unavailable or cannot be read.
    }
  };
  await Promise.all(inputPaths.map(visit));
  return [...new Set(found)];
}

function registerIpc() {
  ipcMain.handle('library:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn nhạc hoặc thư mục nhạc',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Tệp nhạc', extensions: [...AUDIO_EXTENSIONS].map((extension) => extension.slice(1)) }]
    });
    return result.canceled ? [] : collectAudioFiles(result.filePaths);
  });

  ipcMain.handle('playlist:choose-cover', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn ảnh đại diện playlist',
      properties: ['openFile'],
      filters: [{ name: 'Ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buffer.toString('base64')}`;
  });

  ipcMain.handle('library:add-paths', (_, inputPaths) => collectAudioFiles(Array.isArray(inputPaths) ? inputPaths : []));
  ipcMain.handle('state:read', () => store.get('playerState'));
  ipcMain.handle('state:save', (_, nextState) => {
    if (nextState && Array.isArray(nextState.playlist)) store.set('playerState', nextState);
  });

  ipcMain.on('playback:update', (_, nextPlayback) => {
    playback = { ...playback, ...nextPlayback };
    updateTrayMenu();
  });

  /** Kiểm tra API Key đã cấu hình chưa (không trả key về renderer). */
  ipcMain.handle('youtube:has-key', () => Boolean(youtubeApiKey && youtubeApiKey !== 'YOUR_API_KEY_HERE'));

  /** Tìm kiếm nhạc qua YouTube Data API v3 — gọi từ main process để giữ key an toàn. */
  ipcMain.handle('youtube:search', async (_, query) => {
    if (!youtubeApiKey || youtubeApiKey === 'YOUR_API_KEY_HERE') {
      return { ok: false, error: 'missing_api_key', message: 'Chưa cấu hình YouTube API Key trong config.js.' };
    }

    const keyword = String(query || '').trim();
    if (!keyword) {
      return { ok: false, error: 'empty_query', message: 'Vui lòng nhập tên bài hát.' };
    }

    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', keyword);
      url.searchParams.set('type', 'video');
      url.searchParams.set('videoCategoryId', '10');
      url.searchParams.set('maxResults', '20');
      url.searchParams.set('key', youtubeApiKey);

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        const message = data?.error?.message || `HTTP ${response.status}`;
        if (response.status === 403) {
          return { ok: false, error: 'quota_exceeded', message: 'Hết quota API hoặc key không hợp lệ.' };
        }
        return { ok: false, error: 'api_error', message };
      }

      const items = (data.items || [])
        .map((item) => ({
          id: item.id?.videoId || item.id?.playlistId || item.id?.channelId,
          type: item.id?.videoId ? 'video' : (item.id?.playlistId ? 'playlist' : 'channel'),
          videoId: item.id?.videoId,
          playlistId: item.id?.playlistId,
          channelId: item.id?.channelId,
          title: item.snippet?.title || 'Không có tiêu đề',
          channel: item.snippet?.channelTitle || 'Không rõ kênh',
          thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
        }))
        .filter((item) => item.id);

      return { ok: true, items };
    } catch (error) {
      return { ok: false, error: 'network', message: error.message || 'Không thể kết nối YouTube API.' };
    }
  });

  /** Lấy playlist "Uploads" mặc định của một channel. */
  ipcMain.handle('youtube:get-artist-uploads', async (_, channelId) => {
    if (!youtubeApiKey || youtubeApiKey === 'YOUR_API_KEY_HERE') return { ok: false, error: 'missing_api_key' };
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.searchParams.set('part', 'contentDetails');
      url.searchParams.set('id', channelId);
      url.searchParams.set('key', youtubeApiKey);

      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) return { ok: false, error: 'api_error', message: data.error?.message };

      const uploadsPlaylistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      return uploadsPlaylistId ? { ok: true, playlistId: uploadsPlaylistId } : { ok: false, error: 'no_uploads' };
    } catch (error) {
      return { ok: false, error: 'network', message: error.message };
    }
  });

  /** Tìm kiếm playlist theo tên nghệ sĩ/album. */
  ipcMain.handle('youtube:search-playlists', async (_, query) => {
    if (!youtubeApiKey || youtubeApiKey === 'YOUR_API_KEY_HERE') return { ok: false, error: 'missing_api_key' };
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'playlist');
      url.searchParams.set('maxResults', '20');
      url.searchParams.set('key', youtubeApiKey);

      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) return { ok: false, error: 'api_error', message: data.error?.message };

      const items = (data.items || []).map(item => ({
        playlistId: item.id.playlistId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        channel: item.snippet.channelTitle
      }));
      return { ok: true, items };
    } catch (error) {
      return { ok: false, error: 'network', message: error.message };
    }
  });

  /** Lấy danh sách video trong 1 playlist (hỗ trợ phân trang). */
  ipcMain.handle('youtube:get-playlist-items', async (_, { playlistId, pageToken }) => {
    if (!youtubeApiKey || youtubeApiKey === 'YOUR_API_KEY_HERE') return { ok: false, error: 'missing_api_key' };
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('playlistId', playlistId);
      url.searchParams.set('maxResults', '50');
      url.searchParams.set('key', youtubeApiKey);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) return { ok: false, error: 'api_error', message: data.error?.message };

      const items = (data.items || []).map(item => ({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || ''
      }));
      return { ok: true, items, nextPageToken: data.nextPageToken };
    } catch (error) {
      return { ok: false, error: 'network', message: error.message };
    }
  });
}

function registerMediaShortcuts() {
  const shortcuts = [
    ['MediaPlayPause', 'toggle-playback'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous']
  ];
  for (const [accelerator, command] of shortcuts) {
    globalShortcut.register(accelerator, () => sendCommand(command));
  }
}

app.whenReady().then(async () => {
  const Store = (await import('electron-store')).default;
  store = new Store({
    name: 'music-player',
    defaults: {
      playerState: { playlist: [], currentTrackId: null, position: 0, volume: 0.8, isPlaying: false }
    }
  });
  await startLocalServer();
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  createTray();
  registerMediaShortcuts();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (event) => {
  if (!isQuitting) event.preventDefault();
});
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
