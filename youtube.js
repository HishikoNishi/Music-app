/**
 * Module YouTube: tìm kiếm (Data API v3) + phát nhạc (IFrame Player API).
 * API Key được gọi qua IPC từ main process — không lộ key ở renderer.
 */
(() => {
  /** @type {YT.Player|null} */
  let player = null;
  let playerReady = false;
  let pendingVideoId = null;
  let pendingVolume = null;

  /** Danh sách kết quả hiện tại (có thể là video, playlist hoặc bài hát trong playlist). */
  let results = [];
  /** Video đang phát trong danh sách kết quả. */
  let currentIndex = -1;
  /** Thông tin bài hát hiện tại (dùng chung cho tìm kiếm và phát trực tiếp). */
  let currentPlayingMeta = null;
  /** Query tìm kiếm gần nhất. */
  let lastQuery = '';
  /** Lịch sử điều hướng (để bấm Back). */
  let navigationStack = [];

  /** Callback từ renderer.js để cập nhật footer & trạng thái. */
  let hooks = {
    setStatus: () => {},
    onPlaybackChange: () => {},
    onNowPlaying: () => {},
    onProgress: () => {}
  };

  let progressTimer = null;

  const ERROR_MESSAGES = {
    missing_api_key: 'Chưa cấu hình API Key. Copy config.example.js → config.js và điền key.',
    empty_query: 'Vui lòng nhập tên bài hát cần tìm.',
    quota_exceeded: 'Hết quota YouTube API hoặc key không hợp lệ.',
    network: 'Lỗi mạng. Kiểm tra kết nối internet.',
    api_error: 'YouTube API trả về lỗi.',
    no_results: 'Không tìm thấy kết quả phù hợp. Thử từ khóa khác.'
  };

  /** Khởi tạo — renderer truyền các hàm cập nhật UI. */
  function init(callbacks) {
    hooks = { ...hooks, ...callbacks };
  }

  /** Đang ở chế độ phát YouTube hay không. */
  function isActive() {
    return currentIndex >= 0 && Boolean(results[currentIndex]);
  }

  function currentItem() {
    return currentIndex >= 0 ? results[currentIndex] : null;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  function syncNowPlaying() {
    const meta = currentPlayingMeta;
    hooks.onNowPlaying({
      title: meta?.title || 'Chưa chọn bài hát',
      channel: meta?.channel || 'YouTube Music',
      thumbnail: meta?.thumbnail || '',
      isPlaying: playerReady && player?.getPlayerState?.() === YT.PlayerState.PLAYING
    });
  }

  function startProgressTimer() {
    stopProgressTimer();
    progressTimer = setInterval(() => {
      if (!playerReady || !player) return;
      const current = player.getCurrentTime?.() || 0;
      const total = player.getDuration?.() || 0;
      hooks.onProgress({
        current,
        total,
        currentLabel: formatTime(current),
        totalLabel: formatTime(total),
        percent: total > 0 ? (current / total) * 100 : 0
      });
    }, 500);
  }

  function stopProgressTimer() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function notifyPlayback(isPlaying) {
    hooks.onPlaybackChange(isPlaying);
    syncNowPlaying();
  }

  /** Tạo IFrame Player khi YouTube API sẵn sàng. */
  function createPlayer() {
    if (player || !window.YT?.Player) return;

    player = new YT.Player('youtube-player', {
      height: '180',
      width: '100%',
      playerVars: {
        autoplay: 0,
        controls: 1,
        disablekb: 0,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        origin: window.location.origin
      },
      events: {
        onReady: () => {
          playerReady = true;
          if (pendingVideoId) {
            player.loadVideoById(pendingVideoId);
            pendingVideoId = null;
          }
          if (pendingVolume !== null) {
            player.setVolume(pendingVolume);
            pendingVolume = null;
          }
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.PLAYING) {
            startProgressTimer();
            notifyPlayback(true);
          } else if (event.data === YT.PlayerState.PAUSED) {
            notifyPlayback(false);
          } else if (event.data === YT.PlayerState.ENDED) {
            notifyPlayback(false);
            playNext();
          } else if (event.data === YT.PlayerState.BUFFERING) {
            hooks.setStatus('Đang tải video…');
          }
          syncNowPlaying();
        },
        onError: (event) => {
          const codes = {
            2: 'Tham số video không hợp lệ.',
            5: 'Lỗi HTML5 player.',
            100: 'Video không tồn tại hoặc đã bị xóa.',
            101: 'Video không cho phép phát nhúng.',
            150: 'Video không cho phép phát nhúng.'
          };
          hooks.setStatus(codes[event.data] || `Lỗi phát video (mã ${event.data}).`);
          notifyPlayback(false);
        }
      }
    });
  }

  window.onYouTubeIframeAPIReady = () => createPlayer();

  function playAt(index, { autoplay = true } = {}) {
    if (index < 0 || index >= results.length) return;
    currentIndex = index;
    const item = results[index];
    currentPlayingMeta = { title: item.title, channel: item.channel, thumbnail: item.thumbnail };
    hooks.onNowPlaying({
      title: item.title,
      channel: item.channel,
      thumbnail: item.thumbnail,
      isPlaying: autoplay
    });
    hooks.setStatus(`Đang phát: ${item.title}`);

    if (playerReady && player?.loadVideoById) {
      if (autoplay) player.loadVideoById(item.videoId);
      else player.cueVideoById(item.videoId);
    } else {
      pendingVideoId = item.videoId;
    }

    syncNowPlaying();
    highlightActiveResult();
  }

  /** Phát video trực tiếp theo ID (dùng cho Playlist tự tạo). */
  function playVideoDirect(videoId, meta, { autoplay = true } = {}) {
    currentPlayingMeta = { title: meta.title, channel: meta.channel, thumbnail: meta.thumbnail };
    try {
      currentIndex = -1; // Thoát khỏi chế độ phát theo danh sách kết quả search
      results = [];

      hooks.onNowPlaying({
        title: meta.title,
        channel: meta.channel,
        thumbnail: meta.thumbnail,
        isPlaying: autoplay
      });
      hooks.setStatus(`Đang phát: ${meta.title}`);

      if (playerReady && player?.loadVideoById) {
        if (autoplay) player.loadVideoById(videoId);
        else player.cueVideoById(videoId);
      } else {
        pendingVideoId = videoId;
      }

      syncNowPlaying();
    } catch (error) {
      console.error('[YouTubeModule] Error in playVideoDirect:', error);
      hooks.setStatus('Lỗi khi phát video từ playlist.');
    }
  }

  function highlightActiveResult() {
    document.querySelectorAll('.yt-result').forEach((row, index) => {
      row.classList.toggle('active', index === currentIndex);
    });
  }

  function togglePlayback() {
    if (!playerReady || !player) {
      if (results.length) playAt(currentIndex >= 0 ? currentIndex : 0);
      return;
    }
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
  }

  function playNext() {
    if (!results.length) return;
    playAt((currentIndex + 1) % results.length);
  }

  function playPrevious() {
    if (!results.length || !playerReady || !player) return;
    if (player.getCurrentTime() > 3) {
      player.seekTo(0, true);
      return;
    }
    playAt(currentIndex <= 0 ? results.length - 1 : currentIndex - 1);
  }

  function setVolume(value) {
    const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
    if (playerReady && player?.setVolume) {
      player.setVolume(percent);
    } else {
      pendingVolume = percent; // Lưu lại để áp dụng khi player sẵn sàng
    }
  }

  function seekToPercent(percent) {
    if (!playerReady || !player) return;
    const total = player.getDuration?.() || 0;
    if (total > 0) player.seekTo((percent / 100) * total, true);
  }

  function pause() {
    if (playerReady && player?.pauseVideo) player.pauseVideo();
    stopProgressTimer();
  }

  function renderError(container, message) {
    const box = document.createElement('div');
    box.className = 'yt-error';
    box.textContent = message;
    container.append(box);
  }

  function makeResultRow(item, index, type = 'video') {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `yt-result${index === currentIndex ? ' active' : ''}`;

    let icon = '▶';
    if (type === 'playlist') icon = '📁';
    if (type === 'channel') icon = '👤';

    row.innerHTML = `
      <img class="yt-thumb" src="${item.thumbnail}" alt="" loading="lazy" />
      <span class="yt-result-info">
        <span class="yt-result-title">${escapeHtml(item.title)}</span>
        <span class="yt-result-channel">${escapeHtml(item.channel)}</span>
      </span>
      <span class="yt-play-icon" aria-hidden="true">${icon}</span>
    `;

    row.addEventListener('click', async () => {
      if (type === 'video') {
        playAt(index);
      } else if (type === 'channel') {
        await loadArtistUploads(item.id, index);
      } else if (type === 'playlist') {
        await loadPlaylistItems(item.playlistId, index);
      }
    });

    window.PlaylistModule.addButtonTo(row, { type: 'youtube', videoId: item.videoId, title: item.title, channel: item.channel, thumbnail: item.thumbnail });
    return row;
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Điều hướng quay lại view trước đó. */
  function goBack() {
    if (navigationStack.length === 0) return;
    const previous = navigationStack.pop();
    renderPreviousView(previous);
  }

  function renderPreviousView(prev) {
    if (prev.view === 'search') {
      const { query, container, statusEl } = prev;
      // Gọi search mà không push vào stack nữa
      const originalRunSearch = runSearch;
      runSearch = async (q, c, s) => {
        const oldStack = [...navigationStack];
        navigationStack.length = 0;
        const res = await originalRunSearch(q, c, s);
        navigationStack.push(...oldStack);
        return res;
      };
      runSearch(query, container, statusEl);
      runSearch = originalRunSearch;
    }
  }

  async function runSearch(query, resultsContainer, statusEl) {
    const keyword = query.trim();
    if (!keyword) {
      hooks.setStatus('Vui lòng nhập tên bài hát.');
      return;
    }

    navigationStack.push({ view: 'search', query: keyword, container: resultsContainer, statusEl: statusEl });

    statusEl.textContent = 'Đang tìm kiếm…';
    statusEl.classList.add('loading');
    resultsContainer.replaceChildren();

    const response = await window.musicApi.searchYouTube(keyword);
    statusEl.classList.remove('loading');

    if (!response.ok) {
      const msg = response.message || ERROR_MESSAGES[response.error] || ERROR_MESSAGES.api_error;
      statusEl.textContent = msg;
      renderError(resultsContainer, msg);
      hooks.setStatus(msg);
      return;
    }

    results = response.items;
    lastQuery = keyword;

    if (!results.length) {
      statusEl.textContent = ERROR_MESSAGES.no_results;
      renderError(resultsContainer, ERROR_MESSAGES.no_results);
      hooks.setStatus(ERROR_MESSAGES.no_results);
      return;
    }

    statusEl.textContent = `${results.length} kết quả cho "${keyword}"`;
    const list = document.createElement('div');
    list.className = 'yt-results';
    list.setAttribute('role', 'list');
    results.forEach((item, index) => list.append(makeResultRow(item, index, item.type)));
    resultsContainer.append(list);
    hooks.setStatus(`Tìm thấy ${results.length} bài hát.`);
  }

  async function loadArtistUploads(channelId, index) {
    const container = document.querySelector('.yt-results-wrap');
    const statusEl = document.querySelector('.yt-status');
    if (!container || !statusEl) return;

    navigationStack.push({ view: 'artist', channelId, container, statusEl });

    statusEl.textContent = 'Đang lấy danh sách nhạc của nghệ sĩ…';
    statusEl.classList.add('loading');
    container.replaceChildren();

    const res = await window.musicApi.getArtistUploads(channelId);
    if (!res.ok) {
      statusEl.classList.remove('loading');
      renderError(container, res.message || 'Không tìm thấy danh sách upload.');
      return;
    }

    const playlistId = res.playlistId;
    await loadPlaylistItems(playlistId, -1, container, statusEl, true);
  }

  async function loadPlaylistItems(playlistId, index, container = null, statusEl = null, isArtist = false) {
    container = container || document.querySelector('.yt-results-wrap');
    statusEl = statusEl || document.querySelector('.yt-status');
    if (!container || !statusEl) return;

    if (!isArtist) {
      navigationStack.push({ view: 'playlist', playlistId, container, statusEl });
    }

    statusEl.textContent = 'Đang tải danh sách bài hát…';
    statusEl.classList.add('loading');
    container.replaceChildren();

    const response = await window.musicApi.getPlaylistItems({ playlistId });
    statusEl.classList.remove('loading');

    if (!response.ok) {
      renderError(container, response.message || 'Lỗi khi tải playlist.');
      return;
    }

    results = response.items;
    lastQuery = `Playlist: ${results[0]?.title || 'YouTube'}`;

    const list = document.createElement('div');
    list.className = 'yt-results';
    results.forEach((item, index) => list.append(makeResultRow(item, index, 'video')));
    container.append(list);

    if (index >= 0) playAt(index);
  }

  async function render(container) {
    container.replaceChildren();

    const hasKey = await window.musicApi.hasYouTubeKey();
    if (!hasKey) {
      const setup = document.createElement('div');
      setup.className = 'yt-setup';
      setup.innerHTML = `
        <strong>Chưa cấu hình YouTube API Key</strong>
        <p>Copy <code>config.example.js</code> thành <code>config.js</code>, điền API Key rồi khởi động lại app.</p>
        <ol>
          <li>Vào <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud Console</a></li>
          <li>Bật <strong>YouTube Data API v3</strong></li>
          <li>Tạo API Key và dán vào <code>config.js</code></li>
        </ol>
      `;
      container.append(setup);
      return;
    }

    const searchBar = document.createElement('form');
    searchBar.className = 'yt-search-bar';
    searchBar.innerHTML = `
      <input class="yt-search-input" type="search" placeholder="Tìm bài hát trên YouTube…" autocomplete="off" />
      <button type="submit" class="primary yt-search-btn">Tìm kiếm</button>
    `;

    const statusEl = document.createElement('p');
    statusEl.className = 'yt-status';

    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'yt-results-wrap';

    container.append(searchBar, statusEl, resultsContainer);

    const input = searchBar.querySelector('.yt-search-input');
    input.value = lastQuery;

    searchBar.addEventListener('submit', (event) => {
      event.preventDefault();
      runSearch(input.value, resultsContainer, statusEl);
    });

    input.focus();

    if (window.YT?.Player && !player && document.getElementById('youtube-player')) createPlayer();
  }

  function setPlayerVisible(visible) {
    document.getElementById('youtube-player-section')?.classList.toggle('yt-audio-only', !visible);
  }

  window.YouTubeModule = {
    init,
    render,
    setPlayerVisible,
    isActive,
    togglePlayback,
    playNext,
    playPrevious,
    setVolume,
    seekToPercent,
    pause,
    syncNowPlaying,
    playVideoDirect,
    getPlayerState: () => (playerReady && player ? player.getPlayerState() : -1),
    goBack
  };
})();
