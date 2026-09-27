/**
 * Module Playlist: Quản lý playlist tự tạo (hỗn hợp nhạc local và YouTube).
 */
(() => {
  let state = null;
  let hooks = {};

  /** Khởi tạo - nhận state từ renderer để thao tác trực tiếp. */
  function init(callbacks) {
    hooks = { ...hooks, ...callbacks };
    state = null; // Reset state to be initialized by renderer
  }

  let activePlaylistId = null;

  function confirmAndDeletePlaylist(playlistId, playlistName) {
    window.showConfirmDialog(`Bạn có chắc muốn xóa playlist "${playlistName}"? Thao tác này không thể hoàn tác.`, () => {
      const index = state.playlists.findIndex(p => p.id === playlistId);
      if (index === -1) return;

      const view = document.querySelector('#view');
      const card = Array.from(view.querySelectorAll('.playlist-card')).find(c => c.querySelector('.playlist-card-name')?.textContent === playlistName);

      if (card) {
        card.classList.add('removing');
        setTimeout(() => {
          state.playlists.splice(index, 1);
          if (activePlaylistId === playlistId) {
            activePlaylistId = null;
          }
          hooks.saveSoon();
          hooks.renderContent();
        }, 200);
      } else {
        state.playlists.splice(index, 1);
        if (activePlaylistId === playlistId) {
          activePlaylistId = null;
        }
        hooks.saveSoon();
        hooks.renderContent();
      }
    });
  }

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  }

  function openPlaylistDialog() {
    const dialog = document.querySelector('#playlist-dialog');
    const form = document.querySelector('#playlist-form');
    const input = document.querySelector('#playlist-name');
    const cancelBtn = document.querySelector('#playlist-cancel');
    if (!dialog || !form || !input) return;

    input.value = '';
    dialog.showModal();
    input.focus();

    const handleSubmit = (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      state.playlists.push({ id: makeId(), name, items: [], open: true });
      dialog.close();
      hooks.renderContent();
      hooks.saveSoon();
    };

    const handleCancel = () => dialog.close();

    form.onsubmit = handleSubmit;
    cancelBtn?.addEventListener('click', handleCancel);
  }

  function renderPlaylists(view) {
    if (activePlaylistId) {
      renderPlaylistDetail(view);
      return;
    }

    view.classList.add('view-transition');

    setTimeout(() => {
      view.replaceChildren();
      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      const create = document.createElement('button');
      create.className = 'primary';
      create.textContent = '＋ Tạo playlist';
      create.addEventListener('click', openPlaylistDialog);
      toolbar.append(create);
      view.append(toolbar);

      if (!state.playlists || !state.playlists.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = '<div><strong>Chưa có playlist</strong>Tạo playlist mới và thêm bài hát vào.</div>';
        view.append(empty);
        view.classList.remove('view-transition');
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'playlist-grid';
      state.playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';

        const cover = document.createElement('div');
        cover.className = 'playlist-card-cover';
        if (pl.cover) {
          cover.style.backgroundImage = `url("${pl.cover}")`;
          cover.style.backgroundSize = 'cover';
          cover.style.backgroundPosition = 'center';
        } else {
          cover.textContent = '📂';
          cover.style.backgroundColor = `hsl(${pl.id.charCodeAt(0) * 137.5 % 360}, 60%, 40%)`;
        }

        const info = document.createElement('div');
        info.className = 'playlist-card-info';
        const name = document.createElement('div');
        name.className = 'playlist-card-name';
        name.textContent = pl.name;
        const count = document.createElement('div');
        count.className = 'playlist-card-count';
        count.textContent = `${pl.items.length} bài`;
        info.append(name, count);

        const delBtn = document.createElement('button');
        delBtn.className = 'playlist-card-delete icon-delete-btn';
        delBtn.innerHTML = window.trashIcon || '×';
        delBtn.title = 'Xóa playlist';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmAndDeletePlaylist(pl.id, pl.name);
        });

        card.append(cover, info, delBtn);
        card.addEventListener('click', () => {
          activePlaylistId = pl.id;
          hooks.renderContent();
        });
        grid.append(card);
      });
      view.append(grid);
      view.classList.remove('view-transition');
    }, 50);
  }

  function renderPlaylistDetail(view) {
    const pl = state.playlists.find(p => p.id === activePlaylistId);
    if (!pl) {
      activePlaylistId = null;
      hooks.renderContent();
      return;
    }

    view.classList.add('view-transition');

    setTimeout(() => {
      view.replaceChildren();

      const backBtn = document.createElement('button');
      backBtn.className = 'btn-back';
      backBtn.textContent = '← Quay lại';
      backBtn.addEventListener('click', () => {
        activePlaylistId = null;
        hooks.renderContent();
      });
      view.append(backBtn);

      const head = document.createElement('div');
      head.className = 'playlist-detail-head';

      const coverWrap = document.createElement('div');
      coverWrap.className = 'playlist-cover-wrap';

      const cover = document.createElement('div');
      cover.className = 'playlist-detail-cover';
      if (pl.cover) {
        cover.style.backgroundImage = `url("${pl.cover}")`;
        cover.style.backgroundSize = 'cover';
        cover.style.backgroundPosition = 'center';
      } else {
        cover.textContent = '📂';
        cover.style.backgroundColor = `hsl(${pl.id.charCodeAt(0) * 137.5 % 360}, 60%, 40%)`;
        cover.style.display = 'grid';
        cover.style.placeItems = 'center';
        cover.style.fontSize = '48px';
      }

      const overlay = document.createElement('div');
      overlay.className = 'playlist-cover-overlay';
      overlay.innerHTML = '<span>📷 Đổi ảnh</span>';

      coverWrap.append(cover, overlay);
      coverWrap.addEventListener('click', async () => {
        const newCover = await window.musicApi.chooseCover();
        if (newCover) {
          pl.cover = newCover;
          hooks.saveSoon();
          hooks.renderContent();
        }
      });

      const info = document.createElement('div');
      info.className = 'playlist-detail-info';
      const name = document.createElement('h2');
      name.className = 'playlist-detail-name';
      name.textContent = pl.name;
      const count = document.createElement('div');
      count.className = 'playlist-detail-count';
      count.textContent = `${pl.items.length} bài hát`;

      const detailActions = document.createElement('div');
      detailActions.className = 'playlist-detail-actions-top';
      const delPlaylistBtn = document.createElement('button');
      delPlaylistBtn.className = 'btn-delete-playlist btn-delete-danger';
      delPlaylistBtn.innerHTML = (window.trashIcon || '🗑') + ' Xóa playlist';
      delPlaylistBtn.addEventListener('click', () => {
        confirmAndDeletePlaylist(pl.id, pl.name);
      });
      detailActions.append(delPlaylistBtn);

      const actions = document.createElement('div');
      actions.className = 'playlist-detail-actions';

      const playAllBtn = document.createElement('button');
      playAllBtn.className = 'playlist-play-all';
      playAllBtn.textContent = '▶ Phát tất cả';
      if (pl.items.length > 0) {
        playAllBtn.addEventListener('click', () => {
          hooks.loadPlaylistTrack(pl.id, 0, { play: true });
        });
      } else {
        playAllBtn.disabled = true;
        playAllBtn.style.opacity = '0.5';
        playAllBtn.style.cursor = 'not-allowed';
      }

      const shuffleBtn = document.createElement('button');
      shuffleBtn.className = 'playlist-play-shuffle';
      shuffleBtn.textContent = '⤮ Phát ngẫu nhiên';
      if (pl.items.length > 0) {
        shuffleBtn.addEventListener('click', () => {
          const randomIndex = Math.floor(Math.random() * pl.items.length);
          hooks.loadPlaylistTrack(pl.id, randomIndex, { play: true });
        });
      } else {
        shuffleBtn.disabled = true;
        shuffleBtn.style.opacity = '0.5';
        shuffleBtn.style.cursor = 'not-allowed';
      }
      actions.append(playAllBtn, shuffleBtn);

      info.append(name, count, detailActions, actions);
      head.append(coverWrap, info);
      view.append(head);

      const list = document.createElement('ul');
      list.className = 'track-list';
      pl.items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'track';
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '28px 32px minmax(0, 1fr) 56px 32px';
        row.style.gap = '10px';
        row.style.alignItems = 'center';
        row.style.padding = '4px';
        row.style.borderBottom = '1px solid #1e212a';
        row.style.cursor = 'pointer';

        const num = document.createElement('span');
        num.className = 'track-num';
        num.textContent = index + 1;

        const av = document.createElement('span');
        av.className = 'avatar';
        if (item.type === 'youtube' && item.thumbnail) {
          const img = document.createElement('img');
          img.src = item.thumbnail;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.borderRadius = '50%';
          img.style.objectFit = 'cover';
          av.append(img);
        } else {
          av.textContent = item.type === 'local' ? '♪' : 'YT';
        }

        const det = document.createElement('div');
        const t = document.createElement('div');
        t.className = 'track-name';
        t.textContent = item.title;
        const s = document.createElement('div');
        s.className = 'track-subtitle';
        s.textContent = item.channel || 'Local';
        det.append(t, s);

        const dur = document.createElement('span');
        dur.className = 'track-duration';
        dur.textContent = item.duration || '--:--';

        const rem = document.createElement('button');
        rem.className = 'remove icon-delete-btn';
        rem.innerHTML = window.trashIcon || '×';
        rem.addEventListener('click', (e) => {
          e.stopPropagation();
          pl.items.splice(index, 1);
          hooks.renderContent();
          hooks.saveSoon();
        });

        row.addEventListener('click', () => {
          try {
            hooks.loadPlaylistTrack(pl.id, index, { play: true, reset: true });
          } catch (error) {
            console.error('[Playlist] Error calling loadPlaylistTrack:', error);
          }
        });

        row.append(num, av, det, dur, rem);
        list.append(row);
      });
      view.append(list);
      view.classList.remove('view-transition');
    }, 50);
  }

  function showPlaylistPopover(e, item) {
    const existing = document.querySelector('.playlist-popover');
    if (existing) existing.remove();

    const popover = document.createElement('div');
    popover.className = 'playlist-popover';
    popover.style.left = `${e.clientX}px`;
    popover.style.top = `${e.clientY}px`;

    state.playlists.forEach(pl => {
      const itemRow = document.createElement('div');
      itemRow.className = 'playlist-popover-item';
      const isAdded = pl.items.some(i => (i.type === 'local' && i.trackId === item.trackId) || (i.type === 'youtube' && i.videoId === item.videoId));
      itemRow.innerHTML = `<input type="checkbox" class="playlist-checkbox" ${isAdded ? 'checked' : ''} /><span>${pl.name}</span>`;
      itemRow.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const checkbox = itemRow.querySelector('input');
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) pl.items.push(item);
        else pl.items = pl.items.filter(i => !((i.type === 'local' && i.trackId === item.trackId) || (i.type === 'youtube' && i.videoId === item.videoId)));
        hooks.saveSoon();
      });
      popover.append(itemRow);
    });

    const footer = document.createElement('div');
    footer.className = 'playlist-popover-footer';
    const createBtn = document.createElement('button');
    createBtn.textContent = '＋ Tạo playlist mới';
    createBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      popover.remove();
      openPlaylistDialog();
    });
    footer.append(createBtn);
    popover.append(footer);
    document.body.append(popover);

    const closePopover = (ev) => {
      if (!popover.contains(ev.target)) {
        popover.remove();
        document.removeEventListener('click', closePopover);
      }
    };
    setTimeout(() => document.addEventListener('click', closePopover), 0);
  }

  function addButtonTo(row, item) {
    const addBtn = document.createElement('button');
    addBtn.className = 'add-playlist';
    addBtn.textContent = '＋';
    addBtn.title = 'Thêm vào playlist';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showPlaylistPopover(e, item);
    });
    row.append(addBtn);
  }

  function snapshot() {
    return state.playlists.map(pl => ({
      ...pl,
      cover: pl.cover || null
    }));
  }

  function restore(savedPlaylists, validIds) {
    return (savedPlaylists || []).filter(pl => pl?.id && pl?.name).map(pl => ({
      ...pl,
      cover: pl.cover || null,
      open: pl.open !== false,
      items: (pl.items || []).filter(item => item.type !== 'local' || validIds.has(item.trackId))
    }));
  }
  window.PlaylistModule = {
    init: (s, callbacks) => { state = s; hooks = callbacks; },
    render: renderPlaylists,
    addButtonTo,
    openPlaylistDialog,
    snapshot: snapshot,
    restore: restore,
  };
})();
