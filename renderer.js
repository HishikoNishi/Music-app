const audio = document.querySelector('#audio');
const view = document.querySelector('#view');
const chooseButton = document.querySelector('#choose-music');
const contentTitle = document.querySelector('#content-title');
const contentCaption = document.querySelector('#content-caption');
const playPauseButton = document.querySelector('#play-pause');
const previousButton = document.querySelector('#previous');
const nextButton = document.querySelector('#next');
const volumeInput = document.querySelector('#volume');
const seekInput = document.querySelector('#seek');
const titleElement = document.querySelector('#current-title');
const currentArtistElement = document.querySelector('#current-artist');
const playingAvatar = document.querySelector('#playing-avatar');
const elapsedElement = document.querySelector('#elapsed');
const durationElement = document.querySelector('#duration');
const statusElement = document.querySelector('#status');
const artistDialog = document.querySelector('#artist-dialog');
const artistForm = document.querySelector('#artist-form');
const artistNameInput = document.querySelector('#artist-name');
const artistCancelButton = document.querySelector('#artist-cancel');

let state = { playlist: [], artists: [], playlists: [], currentTrackId: null, position: 0, volume: 0.8, isPlaying: false };
let activeView = 'playlists';
let activeChip = 'Tất cả';
let searchTerm = '';
let pendingSeek = 0;
let draggedId = null;
let saveTimer;
let lastSavedPosition = -1;
/** 'local' = file nhạc cục bộ, 'youtube' = đang phát qua YouTube IFrame. */
let playbackMode = 'local';
/** Playlist hiện tại đang phát (nếu có). */
let activePlaylistId = null;

const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const currentIndex = () => state.playlist.findIndex((track) => track.id === state.currentTrackId);
const currentTrack = () => state.playlist[currentIndex()];
const initials = (text = '♪') => text.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '♪';
const formatTime = (seconds) => !Number.isFinite(seconds) || seconds < 0 ? '--:--' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const displayName = (filePath) => filePath.split(/[\\/]/).pop();
const toFileUrl = (filePath) => encodeURI(`file:///${filePath.replace(/\\/g, '/').replace(/#/g, '%23').replace(/\?/g, '%3F')}`);
const artistForTrack = (trackId) => state.artists.find((artist) => artist.trackIds.includes(trackId));

function snapshot() {
  return {
    playlist: state.playlist.map(({ id, path, title, duration, tags }) => ({ id, path, title, duration: Number.isFinite(duration) ? duration : null, tags })),
    artists: state.artists.map(({ id, name, trackIds, open }) => ({ id, name, trackIds, open })),
    playlists: window.PlaylistModule.snapshot(),
    currentTrackId: state.currentTrackId,
    position: Number.isFinite(audio.currentTime) && state.currentTrackId ? audio.currentTime : state.position || 0,
    volume: Number(volumeInput.value),
    isPlaying: !audio.paused
  };
}

function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => window.musicApi.saveState(snapshot()), 300); }
function setStatus(message) { statusElement.textContent = message; }
function trackMatches(track) { return !searchTerm || track.title.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase()); }
function filteredTracks() {
  return state.playlist.filter((track) => trackMatches(track) && (activeChip === 'Tất cả' || (track.tags || []).includes(activeChip)));
}

function updateNowPlaying() {
  if (playbackMode === 'youtube') return;
  const track = currentTrack();
  const artist = track && artistForTrack(track.id);
  const total = Number.isFinite(audio.duration) ? audio.duration : track?.duration;
  titleElement.textContent = track?.title || 'Chưa chọn bài hát';
  currentArtistElement.textContent = artist?.name || 'Nhạc cục bộ';
  playingAvatar.textContent = artist ? initials(artist.name) : '♪';
  playingAvatar.style.backgroundImage = '';
  elapsedElement.textContent = formatTime(audio.currentTime || state.position || 0).replace('--:--', '0:00');
  durationElement.textContent = formatTime(total).replace('--:--', '0:00');
  seekInput.value = total ? String(Math.min(100, ((audio.currentTime || 0) / total) * 100)) : '0';
  playPauseButton.textContent = audio.paused ? '▶' : 'Ⅱ';
  playPauseButton.setAttribute('aria-label', audio.paused ? 'Phát' : 'Tạm dừng');
}

/** Cập nhật footer khi phát YouTube. */
function updateYouTubeNowPlaying({ title, channel, thumbnail, isPlaying }) {
  titleElement.textContent = title;
  currentArtistElement.textContent = channel;
  if (thumbnail) {
    playingAvatar.textContent = '';
    playingAvatar.style.backgroundImage = `url("${thumbnail}")`;
    playingAvatar.style.backgroundSize = 'cover';
  } else {
    playingAvatar.style.backgroundImage = '';
    playingAvatar.textContent = '▶';
  }
  playPauseButton.textContent = isPlaying ? 'Ⅱ' : '▶';
  playPauseButton.setAttribute('aria-label', isPlaying ? 'Tạm dừng' : 'Phát');
}

function switchToLocalPlayback() {
  playbackMode = 'local';
  window.YouTubeModule?.pause();
  window.YouTubeModule?.setPlayerVisible(false);
}

function switchToYouTubePlayback() {
  playbackMode = 'youtube';
  audio.pause();
  window.YouTubeModule?.setPlayerVisible(true);
}

function makeTrackListHeader() {
  const header = document.createElement('div');
  header.className = 'track-list-header';
  header.innerHTML = '<span class="col-num">#</span><span class="col-avatar"></span><span class="col-title">Bài hát</span><span class="col-duration">Thời lượng</span><span class="col-action"></span>';
  return header;
}

function makeTrackRow(track, { contextArtist = null, removable = true, index = null, playlistId = null } = {}) {
  const row = document.createElement('li');
  row.className = `track${track.id === state.currentTrackId ? ' active' : ''}${contextArtist ? ' track-artist' : ''}`;
  row.draggable = !contextArtist;
  row.dataset.id = track.id;
  const num = document.createElement('span'); num.className = 'track-num'; num.textContent = index != null ? String(index + 1) : '';
  const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = initials(contextArtist?.name || '♪');
  const details = document.createElement('div');
  const name = document.createElement('div'); name.className = 'track-name'; name.textContent = track.title;
  const subtitle = document.createElement('div'); subtitle.className = 'track-subtitle'; subtitle.textContent = contextArtist?.name || artistForTrack(track.id)?.name || 'Nhạc cục bộ';
  details.append(name, subtitle);
  const duration = document.createElement('span'); duration.className = 'track-duration'; duration.textContent = formatTime(track.duration);

  const handleTrackClick = () => {
    if (playlistId) {
      const pl = state.playlists.find(p => p.id === playlistId);
      const idx = pl?.items.findIndex(i => i.type === 'local' && i.trackId === track.id) ?? -1;
      loadPlaylistTrack(playlistId, idx, { play: true, reset: true });
    } else {
      loadTrack(state.playlist.findIndex((item) => item.id === track.id), { play: true, reset: true });
    }
  };
  row.addEventListener('click', handleTrackClick);

  window.PlaylistModule.addButtonTo(row, { type: 'local', trackId: track.id, title: track.title, thumbnail: null });

  if (removable) {
    const remove = document.createElement('button'); remove.className = 'remove'; remove.textContent = '×'; remove.title = `Xóa ${track.title} khỏi thư viện`; remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', (event) => { event.stopPropagation(); removeTrack(track.id); });
    row.append(remove);
  }
  if (!contextArtist) setupTrackDragging(row, track);
  return row;
}

function setupTrackDragging(row, track) {
  row.addEventListener('dragstart', (event) => {
    draggedId = track.id; row.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-music-track', track.id);
  });
  row.addEventListener('dragover', (event) => { if (draggedId) { event.preventDefault(); event.stopPropagation(); row.classList.add('drop-target'); event.dataTransfer.dropEffect = 'move'; } });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', (event) => {
    if (!draggedId || draggedId === track.id) return;
    event.preventDefault(); event.stopPropagation();
    const rect = row.getBoundingClientRect();
    reorderTrack(draggedId, track.id, event.clientY > rect.top + rect.height / 2);
  });
  row.addEventListener('dragend', () => { draggedId = null; document.querySelectorAll('.track').forEach((item) => item.classList.remove('dragging', 'drop-target')); });
}

function makeEmpty(title, message) {
  const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = `<div><strong>${title}</strong>${message}</div>`; return empty;
}

function renderTrackList(tracks, options = {}) {
  if (!tracks.length) return makeEmpty(options.emptyTitle || 'Chưa có bài hát', options.emptyMessage || 'Dùng “Chọn nhạc” hoặc kéo thả tệp từ File Explorer vào đây.');
  const wrapper = document.createElement('div');
  wrapper.className = 'track-list-wrap';
  wrapper.append(makeTrackListHeader());
  const list = document.createElement('ul'); list.className = 'track-list';
  tracks.forEach((track, index) => list.append(makeTrackRow(track, { ...options, index })));
  list.addEventListener('dragover', (event) => { event.preventDefault(); if (!draggedId) event.dataTransfer.dropEffect = 'copy'; });
  list.addEventListener('drop', (event) => { if (!draggedId && event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); addDroppedFiles(event.dataTransfer.files); } });
  wrapper.append(list);
  return wrapper;
}

function renderLibrary() {
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
  const label = document.createElement('span'); label.className = 'toolbar-note'; label.textContent = `${state.playlist.length} bài hát · kéo thả để đổi thứ tự`;
  toolbar.append(label);
  view.append(toolbar, renderTrackList(filteredTracks()));
}

function renderCategory(kind) {
  const chipData = kind === 'moods'
    ? [['Tất cả', 'teal'], ['Thư giãn', 'teal'], ['Sôi động', 'orange'], ['Buồn', 'blue'], ['Vui', 'orange'], ['Rap', '']]
    : [['Tất cả', 'teal'], ['Chill', 'teal'], ['Rap', ''], ['R&B', ''], ['Pop', 'blue']];
  const chips = document.createElement('div'); chips.className = 'chips';
  chipData.forEach(([label, tone]) => {
    const chip = document.createElement('button'); chip.className = `chip${activeChip === label ? ' active' : ''}`; chip.textContent = label; chip.dataset.tone = tone;
    chip.addEventListener('click', () => { activeChip = label; renderContent(); }); chips.append(chip);
  });
  view.append(chips, renderTrackList(filteredTracks(), { emptyTitle: 'Chưa có bài phù hợp', emptyMessage: 'Thêm nhạc hoặc chọn một nhóm khác.' }));
}

function renderSearch() {
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
  const input = document.createElement('input'); input.className = 'filter-input'; input.type = 'search'; input.placeholder = 'Tìm theo tên bài hát…'; input.value = searchTerm; input.autofocus = true;
  input.addEventListener('input', () => { searchTerm = input.value; const list = view.querySelector('.track-list-wrap, .empty'); list?.replaceWith(renderTrackList(state.playlist.filter(trackMatches), { emptyTitle: 'Không tìm thấy bài hát', emptyMessage: 'Thử một từ khóa khác.' })); });
  toolbar.append(input); view.append(toolbar, renderTrackList(state.playlist.filter(trackMatches), { emptyTitle: 'Tìm một bài hát', emptyMessage: 'Nhập tên bài hát ở ô phía trên.' }));
}

function renderArtists() {
  const help = document.createElement('p'); help.className = 'artist-help'; help.textContent = 'Tạo ca sĩ rồi thả trực tiếp file nhạc từ File Explorer vào đúng hàng của họ.';
  const create = document.createElement('button'); create.className = 'primary'; create.textContent = '＋ Tạo ca sĩ'; create.addEventListener('click', openArtistDialog);
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar'; toolbar.append(help, create); view.append(toolbar);
  if (!state.artists.length) { view.append(makeEmpty('Chưa có danh sách ca sĩ', 'Bấm “Tạo ca sĩ”, sau đó kéo thả nhạc vào danh sách vừa tạo.')); return; }
  const list = document.createElement('ul'); list.className = 'artist-list';
  state.artists.forEach((artist) => {
    const item = document.createElement('li'); item.className = 'artist'; item.dataset.artistId = artist.id;
    const tracks = artist.trackIds.map((id) => state.playlist.find((track) => track.id === id)).filter(Boolean);
    const head = document.createElement('button'); head.className = 'artist-head';
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = initials(artist.name);
    const name = document.createElement('span'); name.className = 'artist-name'; name.textContent = artist.name;
    const count = document.createElement('span'); count.className = 'artist-count'; count.textContent = `${tracks.length} bài`;
    const arrow = document.createElement('span'); arrow.className = 'chevron'; arrow.textContent = artist.open ? '⌃' : '⌄';
    head.append(avatar, name, count, arrow); head.addEventListener('click', () => { artist.open = !artist.open; renderContent(); saveSoon(); }); item.append(head);
    if (artist.open) {
      const inside = document.createElement('ul'); inside.className = 'artist-tracks';
      if (tracks.length) tracks.forEach((track) => inside.append(makeTrackRow(track, { contextArtist: artist, removable: false })));
      else { const note = document.createElement('li'); note.className = 'drop-note'; note.textContent = 'Thả file nhạc từ File Explorer vào hàng này để thêm cho ca sĩ.'; inside.append(note); }
      item.append(inside);
    }
    item.addEventListener('dragover', (event) => { if (!draggedId) { event.preventDefault(); item.classList.add('drop-ready'); event.dataTransfer.dropEffect = 'copy'; } });
    item.addEventListener('dragleave', (event) => { if (!item.contains(event.relatedTarget)) item.classList.remove('drop-ready'); });
    item.addEventListener('drop', (event) => { if (!draggedId && event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); item.classList.remove('drop-ready'); addDroppedFiles(event.dataTransfer.files, artist.id); } });
    list.append(item);
  });
  view.append(list);
}

function renderContent() {
  view.replaceChildren();
  const metadata = {
    library: ['Thư viện', 'Danh sách nhạc của bạn'],
    moods: ['Theo tâm trạng', 'Chọn nhạc theo cảm xúc'],
    genres: ['Theo thể loại', 'Khám phá theo phong cách'],
    artists: ['Theo ca sĩ', 'Nhóm nhạc theo ca sĩ của bạn'],
    playlists: ['Playlist', 'Danh sách phát tự tạo'],
    search: ['Tìm kiếm', 'Lọc bài hát theo tên'],
    youtube: ['YouTube Music', 'Tìm và nghe nhạc trực tuyến']
  }[activeView];
  contentTitle.textContent = metadata[0]; contentCaption.textContent = metadata[1];
  chooseButton.classList.toggle('hidden', activeView !== 'library');
  document.querySelectorAll('.nav').forEach((nav) => nav.classList.toggle('active', nav.dataset.view === activeView));

  if (activeView === 'youtube') {
    switchToYouTubePlayback();
    window.YouTubeModule.render(view);
    return;
  }

  window.YouTubeModule?.setPlayerVisible(false);
  if (playbackMode === 'youtube') {
    switchToLocalPlayback();
    updateNowPlaying();
  }

  if (activeView === 'library') renderLibrary();
  if (activeView === 'moods' || activeView === 'genres') renderCategory(activeView);
  if (activeView === 'artists') renderArtists();
  if (activeView === 'playlists') window.PlaylistModule.render(view);
  if (activeView === 'search') renderSearch();
}

function reorderTrack(sourceId, targetId, placeAfter) {
  const from = state.playlist.findIndex((track) => track.id === sourceId); if (from < 0) return;
  const [moving] = state.playlist.splice(from, 1); const to = state.playlist.findIndex((track) => track.id === targetId);
  state.playlist.splice(to + (placeAfter ? 1 : 0), 0, moving); renderContent(); saveSoon();
}

function addTracks(paths) {
  const existing = new Set(state.playlist.map((track) => track.path.toLocaleLowerCase()));
  const additions = paths.filter((filePath) => !existing.has(filePath.toLocaleLowerCase())).map((filePath) => ({ id: makeId(), path: filePath, title: displayName(filePath), duration: null, tags: ['Thư giãn', 'Chill'] }));
  state.playlist.push(...additions); renderContent(); saveSoon();
  setStatus(additions.length ? `Đã thêm ${additions.length} bài hát.` : 'Không có bài hát mới để thêm.'); return additions;
}

async function chooseMusic() { addTracks(await window.musicApi.chooseMusic()); }
async function addDroppedFiles(files, artistId = null) {
  const paths = [...files].map((file) => window.musicApi.getFilePath(file)).filter(Boolean); if (!paths.length) return;
  const additions = addTracks(await window.musicApi.addPaths(paths));
  if (artistId && additions.length) {
    const artist = state.artists.find((item) => item.id === artistId);
    if (artist) { artist.trackIds.push(...additions.map((track) => track.id)); artist.open = true; renderContent(); saveSoon(); setStatus(`Đã thêm ${additions.length} bài cho ${artist.name}.`); }
  }
}

function loadTrack(index, { play = false, reset = false } = {}) {
  const track = state.playlist[index]; if (!track) return;
  switchToLocalPlayback();
  activePlaylistId = null;
  const changed = track.id !== state.currentTrackId; state.currentTrackId = track.id; pendingSeek = reset || changed ? 0 : state.position;
  if (changed || audio.src !== toFileUrl(track.path)) { audio.src = toFileUrl(track.path); audio.load(); }
  updateNowPlaying(); renderContent(); saveSoon(); if (play) audio.play().catch(() => setStatus('Không thể phát tệp này. Hãy kiểm tra định dạng hoặc đường dẫn.'));
}

function loadPlaylistTrack(playlistId, index, options = {}) {
  const playlist = state.playlists.find((pl) => pl.id === playlistId);
  if (!playlist) return;
  const item = playlist.items[index];
  if (!item) return;

  if (item.type === 'local') {
    const trackIndex = state.playlist.findIndex((t) => t.id === item.trackId);
    if (trackIndex < 0) { setStatus('Bài hát local này không còn trong thư viện.'); return; }
    loadTrack(trackIndex, { play: options.play !== false, reset: true });
  } else if (item.type === 'youtube') {
    switchToYouTubePlayback();
    window.YouTubeModule.playVideoDirect(item.videoId, {
      title: item.title,
      channel: item.channel,
      thumbnail: item.thumbnail
    }, { autoplay: options.play !== false });
  }
}

function togglePlayback() {
  if (playbackMode === 'youtube' || activeView === 'youtube') {
    switchToYouTubePlayback();
    window.YouTubeModule.togglePlayback();
    return;
  }
  if (!currentTrack() && state.playlist.length) loadTrack(0, { play: true });
  else if (audio.paused) audio.play().catch(() => setStatus('Không thể bắt đầu phát nhạc.'));
  else audio.pause();
}

function nextTrack() {
  if (playbackMode === 'youtube' || (activeView === 'youtube' && window.YouTubeModule.isActive())) {
    switchToYouTubePlayback();
    window.YouTubeModule.playNext();
    return;
  }
  if (activePlaylistId) {
    const pl = state.playlists.find(p => p.id === activePlaylistId);
    if (!pl) return;
    const curIdx = pl.items.findIndex(i => (i.type === 'local' && i.trackId === state.currentTrackId) || (i.type === 'youtube' && playbackMode === 'youtube'));
    const nextIdx = (curIdx + 1) % pl.items.length;
    loadPlaylistTrack(activePlaylistId, nextIdx, { play: true, reset: true });
    return;
  }
  if (!state.playlist.length) return;
  loadTrack((currentIndex() + 1 + state.playlist.length) % state.playlist.length, { play: true, reset: true });
}

function previousTrack() {
  if (playbackMode === 'youtube' || (activeView === 'youtube' && window.YouTubeModule.isActive())) {
    switchToYouTubePlayback();
    window.YouTubeModule.playPrevious();
    return;
  }
  if (activePlaylistId) {
    const pl = state.playlists.find(p => p.id === activePlaylistId);
    if (!pl) return;
    const curIdx = pl.items.findIndex(i => (i.type === 'local' && i.trackId === state.currentTrackId) || (i.type === 'youtube' && playbackMode === 'youtube'));
    const prevIdx = (curIdx <= 0) ? pl.items.length - 1 : curIdx - 1;
    loadPlaylistTrack(activePlaylistId, prevIdx, { play: true, reset: true });
    return;
  }
  if (!state.playlist.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const index = currentIndex();
  loadTrack(index < 0 ? state.playlist.length - 1 : (index - 1 + state.playlist.length) % state.playlist.length, { play: true, reset: true });
}
function removeTrack(id) {
  const index = state.playlist.findIndex((track) => track.id === id); if (index < 0) return;
  const removingCurrent = id === state.currentTrackId; state.playlist.splice(index, 1); state.artists.forEach((artist) => { artist.trackIds = artist.trackIds.filter((trackId) => trackId !== id); });
  if (removingCurrent) { audio.pause(); audio.removeAttribute('src'); audio.load(); state.currentTrackId = state.playlist[Math.min(index, state.playlist.length - 1)]?.id || null; state.position = 0; }
  renderContent(); updateNowPlaying(); saveSoon(); setStatus('Đã xóa khỏi thư viện và các danh sách ca sĩ; tệp gốc vẫn giữ nguyên.');
}

function openArtistDialog() { artistNameInput.value = ''; artistDialog.showModal(); artistNameInput.focus(); }
artistForm.addEventListener('submit', (event) => {
  event.preventDefault(); const name = artistNameInput.value.trim(); if (!name) return;
  if (state.artists.some((artist) => artist.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) { setStatus('Ca sĩ này đã có trong danh sách.'); return; }
  state.artists.push({ id: makeId(), name, trackIds: [], open: true }); artistDialog.close(); activeView = 'artists'; renderContent(); saveSoon(); setStatus(`Đã tạo danh sách cho ${name}.`);
});
artistCancelButton.addEventListener('click', () => artistDialog.close());

document.querySelectorAll('.nav').forEach((nav) => nav.addEventListener('click', () => { activeView = nav.dataset.view; activeChip = 'Tất cả'; renderContent(); }));
// Tạm ẩn tính năng tự thêm nhạc, sẽ bật lại sau
/*
chooseButton.addEventListener('click', chooseMusic);
*/
playPauseButton.addEventListener('click', togglePlayback); previousButton.addEventListener('click', previousTrack); nextButton.addEventListener('click', nextTrack);
volumeInput.addEventListener('input', () => {
  const value = Number(volumeInput.value);
  audio.volume = value;
  window.YouTubeModule?.setVolume(value);
  saveSoon();
});
seekInput.addEventListener('input', () => {
  if (playbackMode === 'youtube') {
    window.YouTubeModule.seekToPercent(Number(seekInput.value));
    return;
  }
  if (Number.isFinite(audio.duration)) { audio.currentTime = Number(seekInput.value) / 100 * audio.duration; updateNowPlaying(); saveSoon(); }
});

/** Khởi tạo module YouTube — liên kết footer player với IFrame Player. */
window.YouTubeModule.init({
  setStatus,
  onPlaybackChange: (isPlaying) => {
    playbackMode = 'youtube';
    window.musicApi.updatePlayback({ isPlaying });
    updateYouTubeNowPlaying({
      title: titleElement.textContent,
      channel: currentArtistElement.textContent,
      thumbnail: playingAvatar.style.backgroundImage.replace(/^url\(["']?|["']?\)$/g, ''),
      isPlaying
    });
  },
  onNowPlaying: (info) => {
    playbackMode = 'youtube';
    updateYouTubeNowPlaying(info);
  },
  onProgress: ({ currentLabel, totalLabel, percent }) => {
    elapsedElement.textContent = currentLabel;
    durationElement.textContent = totalLabel;
    seekInput.value = String(percent);
  }
});
window.PlaylistModule.init(state, {
  renderContent,
  saveSoon,
  loadPlaylistTrack
});
// Tạm ẩn tính năng tự thêm nhạc, sẽ bật lại sau
/*
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => { if (event.dataTransfer.files.length) { event.preventDefault(); addDroppedFiles(event.dataTransfer.files); } });
*/

audio.addEventListener('loadedmetadata', () => { const track = currentTrack(); if (track && Number.isFinite(audio.duration)) track.duration = audio.duration; if (Number.isFinite(pendingSeek) && pendingSeek > 0) audio.currentTime = Math.min(pendingSeek, Math.max(0, audio.duration - .1)); pendingSeek = 0; updateNowPlaying(); renderContent(); saveSoon(); });
audio.addEventListener('timeupdate', () => { state.position = audio.currentTime || 0; updateNowPlaying(); if (Math.abs(state.position - lastSavedPosition) >= 1) { lastSavedPosition = state.position; saveSoon(); } });
audio.addEventListener('play', () => { updateNowPlaying(); window.musicApi.updatePlayback({ isPlaying: true }); saveSoon(); });
audio.addEventListener('pause', () => { updateNowPlaying(); window.musicApi.updatePlayback({ isPlaying: false }); saveSoon(); });
audio.addEventListener('ended', nextTrack); audio.addEventListener('error', () => { if (audio.error) setStatus('Tệp nhạc không thể phát hoặc đã bị di chuyển.'); });
window.musicApi.onCommand((command) => { if (command === 'toggle-playback') togglePlayback(); if (command === 'next') nextTrack(); if (command === 'previous') previousTrack(); });
window.addEventListener('beforeunload', () => window.musicApi.saveState(snapshot()));

(async function restore() {
  const saved = await window.musicApi.readState();
  if (saved && Array.isArray(saved.playlist)) {
    const playlist = saved.playlist.filter((track) => track?.id && track?.path).map((track) => ({ ...track, title: track.title || displayName(track.path), duration: Number.isFinite(track.duration) ? track.duration : null, tags: Array.isArray(track.tags) ? track.tags : ['Thư giãn', 'Chill'] }));
    const validIds = new Set(playlist.map((track) => track.id));
    const artists = Array.isArray(saved.artists) ? saved.artists.filter((artist) => artist?.id && artist?.name).map((artist) => ({ id: artist.id, name: artist.name, trackIds: [...new Set((artist.trackIds || []).filter((id) => validIds.has(id)))], open: artist.open !== false })) : [];
    const playlists = window.PlaylistModule.restore(saved.playlists, validIds);
    Object.assign(state, saved, { playlist, artists, playlists });
  }
  volumeInput.value = String(Math.max(0, Math.min(1, Number(state.volume) || .8))); audio.volume = Number(volumeInput.value);
  window.YouTubeModule.setVolume(Number(volumeInput.value));
  if (currentTrack()) loadTrack(currentIndex(), { play: false, reset: false });
  renderContent(); updateNowPlaying(); setStatus(state.playlist.length ? 'Đã khôi phục thư viện và vị trí nghe gần nhất.' : 'Chọn nhạc hoặc kéo thả tệp vào cửa sổ để bắt đầu.');
})();
