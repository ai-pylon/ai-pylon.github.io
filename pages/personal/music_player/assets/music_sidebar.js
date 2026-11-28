/* Embeddable Music Player Play Queue sidebar (Sidebar Gallery & right sidebar).
 * Works on ANY AppUI page via manifest.json "sidebar" ("music-player-queue").
 */
(function () {
  "use strict";
  const TYPE = "music-player-queue";
  const BASE = "/v1/apps/personal/music_player/";
  const STORAGE = "music-player:playback:v1";
  const POSITION = "music-player:position:v1";
  const MAX_QUEUE = 5000;

  const trackKey = (t) => (t ? t.cue_id || t.url || "" : "");
  const fmtTime = (s) => {
    const n = Math.floor(s || 0);
    return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  };
  const validPath = (v) =>
    typeof v === "string" &&
    v.length <= 2048 &&
    /^vfs:\/\/(?:gdrive|alias):\/\/[^\\?#%\x00-\x1f\x7f]+$/.test(v);

  function cleanTrack(t) {
    if (!t || !validPath(t.url) || typeof t.name !== "string" || !t.name) return null;
    const out = {
      url: t.url,
      name: t.name,
      size: Number.isFinite(t.size) && t.size >= 0 ? t.size : null,
    };
    if (typeof t.cue_id === "string" && t.cue_id) out.cue_id = t.cue_id;
    if (Number.isFinite(t.start_sec) && t.start_sec >= 0) out.start_sec = t.start_sec;
    if (Number.isFinite(t.end_sec) && t.end_sec >= 0) out.end_sec = t.end_sec;
    if (typeof t.album === "string" && t.album) out.album = t.album;
    if (typeof t.performer === "string" && t.performer) out.performer = t.performer;
    return out;
  }

  async function api(op, args = {}) {
    if (window.AppUIApi && window.AppUIApi.requestResponse) {
      const r = await window.AppUIApi.requestResponse(BASE + op, args, {
        method: "POST",
        timeout: 120000,
        decode: (res) => res.json(),
      });
      if (!r.data?.ok) throw new Error(r.data?.error || "Music Player unavailable");
      return r.data;
    }
    const res = await fetch(BASE + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "Music Player unavailable");
    return data;
  }

  function mountMusicSidebar(host) {
    host.replaceChildren();
    let queue = [];
    let index = -1;
    let current = null;
    let token = null;
    let busy = false;
    let epoch = 0;
    let restoringSeek = false;
    let resumeAt = 0;
    let playlists = [];
    let destroyed = false;

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;flex-direction:column;height:100%;min-height:0;padding:10px;gap:8px;font-size:12px;color:var(--text-primary);box-sizing:border-box;overflow:hidden";

    // Header
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px";
    const hTitle = document.createElement("strong");
    hTitle.textContent = "♫ Music Queue";
    hTitle.style.cssText = "font-size:13px";
    const fullLink = document.createElement("a");
    fullLink.href = "/apps/personal/music_player/";
    fullLink.textContent = "Library ↗";
    fullLink.style.cssText = "font-size:11px;color:var(--accent);text-decoration:none";
    hdr.append(hTitle, fullLink);

    // Now playing
    const nowTitle = document.createElement("div");
    nowTitle.textContent = "No track playing";
    nowTitle.style.cssText =
      "font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    const nowSub = document.createElement("div");
    nowSub.textContent = "Select a track or saved playlist";
    nowSub.style.cssText =
      "font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.style.cssText = "width:100%;height:34px";

    // Transport controls
    const ctrl = document.createElement("div");
    ctrl.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;align-items:center";
    const mkBtn = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText =
        "padding:3px 7px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elevated);color:var(--text-primary);cursor:pointer";
      b.onclick = fn;
      return b;
    };
    const repeat = document.createElement("select");
    repeat.style.cssText =
      "padding:2px 5px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elevated);color:var(--text-primary)";
    for (const [v, t] of [
      ["off", "Repeat off"],
      ["all", "Repeat all"],
      ["one", "Repeat 1"],
    ]) {
      repeat.add(new Option(t, v));
    }
    const shuffle = document.createElement("input");
    shuffle.type = "checkbox";
    const shLbl = document.createElement("label");
    shLbl.style.cssText = "display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--text-muted)";
    shLbl.append(shuffle, document.createTextNode("Shuffle"));

    // Playlists quick loader
    const plRow = document.createElement("div");
    plRow.style.cssText = "display:flex;gap:4px;align-items:center";
    const plSel = document.createElement("select");
    plSel.style.cssText =
      "flex:1;min-width:0;padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elevated);color:var(--text-primary)";
    plSel.add(new Option("Saved playlists…", ""));
    const plPlay = mkBtn("Play", async () => {
      const id = plSel.value;
      if (!id || busy) return;
      nowSub.textContent = "Loading playlist…";
      try {
        const r = await api("playlist_get", { id });
        const items = (r.playlist?.tracks || []).map(cleanTrack).filter(Boolean);
        if (!items.length) {
          nowSub.textContent = "Playlist is empty";
          return;
        }
        queue = items.slice(0, MAX_QUEUE);
        index = -1;
        saveState();
        renderQueue();
        await playIndex(0);
      } catch (e) {
        nowSub.textContent = e.message;
      }
    });
    plRow.append(plSel, plPlay);

    // Queue header + list
    const qHdr = document.createElement("div");
    qHdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--text-muted)";
    const qCount = document.createElement("span");
    qCount.textContent = "0 tracks";
    const qClear = mkBtn("Clear", async () => {
      if (busy) return;
      await dropToken();
      queue = [];
      index = -1;
      current = null;
      nowTitle.textContent = "No track playing";
      nowSub.textContent = "Queue cleared";
      saveState();
      renderQueue();
    });
    qHdr.append(qCount, qClear);

    const list = document.createElement("div");
    list.style.cssText =
      "flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--border);padding-top:6px";

    function loadState() {
      try {
        const s = JSON.parse(localStorage.getItem(STORAGE) || "null");
        const pos = JSON.parse(localStorage.getItem(POSITION) || "null");
        if (s?.version === 1) {
          queue = Array.isArray(s.queue) ? s.queue.slice(0, MAX_QUEUE).map(cleanTrack).filter(Boolean) : [];
          const rem = cleanTrack(s.track);
          if (rem) {
            index =
              Number.isInteger(s.index) && trackKey(queue[s.index]) === trackKey(rem)
                ? s.index
                : queue.findIndex((t) => trackKey(t) === trackKey(rem));
            if (!current) {
              current = rem;
              resumeAt = pos?.url === rem.url && Number.isFinite(pos.seconds) ? Math.max(0, pos.seconds) : 0;
              nowTitle.textContent = rem.name;
              nowSub.textContent = "Saved · " + fmtTime(resumeAt);
            }
          }
          if (["off", "all", "one"].includes(s.repeat)) repeat.value = s.repeat;
          shuffle.checked = s.shuffle === true;
        }
      } catch (_) {}
      renderQueue();
    }

    function saveState() {
      try {
        const prev = JSON.parse(localStorage.getItem(STORAGE) || "{}") || {};
        const snap = Object.assign({}, prev, {
          version: 1,
          queue: queue.slice(0, MAX_QUEUE).map(cleanTrack).filter(Boolean),
          index,
          track: cleanTrack(current),
          repeat: repeat.value,
          shuffle: shuffle.checked,
        });
        localStorage.setItem(STORAGE, JSON.stringify(snap));
      } catch (_) {}
    }

    async function dropToken() {
      const old = token;
      token = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (old) {
        try {
          await api("release", { token: old });
        } catch (_) {}
      }
    }

    async function playIndex(i, pos = 0) {
      if (busy || i < 0 || i >= queue.length) return;
      busy = true;
      const myEpoch = ++epoch;
      const track = queue[i];
      index = i;
      const targetPos = pos > 0 ? pos : Number.isFinite(track.start_sec) ? track.start_sec : 0;
      try {
        if (token && current?.url === track.url && audio.readyState >= 1 && Number.isFinite(track.start_sec)) {
          current = track;
          nowTitle.textContent = track.name;
          nowSub.textContent =
            (track.album ? track.album + " · " : "") +
            fmtTime(track.start_sec) +
            (Number.isFinite(track.end_sec) ? "–" + fmtTime(track.end_sec) : "");
          saveState();
          renderQueue();
          try {
            audio.currentTime = Number.isFinite(audio.duration)
              ? Math.min(targetPos, Math.max(0, audio.duration - 0.25))
              : targetPos;
          } catch (_) {}
          audio.play().catch(() => {});
          return;
        }
        await dropToken();
        if (myEpoch !== epoch || destroyed) return;
        current = track;
        resumeAt = targetPos;
        restoringSeek = targetPos > 0;
        nowTitle.textContent = track.name;
        nowSub.textContent = "Opening Drive stream…";
        saveState();
        renderQueue();
        const r = await api("prepare", { url: track.url });
        if (myEpoch !== epoch || destroyed) {
          await api("release", { token: r.token }).catch(() => {});
          return;
        }
        token = r.token;
        const begin = () => {
          if (myEpoch !== epoch || token !== r.token) return;
          audio.play().catch(() => {
            nowSub.textContent = "Ready — press Play";
          });
        };
        if (restoringSeek) {
          audio.addEventListener(
            "loadedmetadata",
            () => {
              if (myEpoch !== epoch || token !== r.token) return;
              try {
                audio.currentTime = Number.isFinite(audio.duration)
                  ? Math.min(targetPos, Math.max(0, audio.duration - 0.25))
                  : targetPos;
              } catch (_) {}
              restoringSeek = false;
              begin();
            },
            { once: true }
          );
        }
        audio.src = r.url;
        nowSub.textContent =
          (track.album ? track.album + " · " : "") + (r.bytes / 1048576).toFixed(1) + " MB";
        if (!restoringSeek) begin();
      } catch (e) {
        restoringSeek = false;
        nowSub.textContent = e.message;
      } finally {
        busy = false;
      }
    }

    function advance(delta = 1, ended = false) {
      if (busy || !queue.length) return;
      if (ended && repeat.value === "one") {
        audio.currentTime = Number.isFinite(current?.start_sec) ? current.start_sec : 0;
        audio.play().catch(() => {});
        return;
      }
      let n = index + delta;
      if (shuffle.checked && queue.length > 1 && delta > 0) {
        do {
          n = Math.floor(Math.random() * queue.length);
        } while (n === index);
      }
      if (n >= queue.length && repeat.value === "all") n = 0;
      if (n < 0 && repeat.value === "all") n = queue.length - 1;
      if (n >= 0 && n < queue.length) playIndex(n);
      else nowSub.textContent = "End of queue";
    }

    function renderQueue() {
      qCount.textContent = queue.length + " tracks" + (index >= 0 ? " · #" + (index + 1) : "");
      list.replaceChildren();
      if (!queue.length) {
        const empty = document.createElement("div");
        empty.textContent = "Queue is empty. Open Music Player or pick a saved playlist.";
        empty.style.cssText = "color:var(--text-muted);padding:8px 2px";
        list.append(empty);
        return;
      }
      queue.slice(0, 300).forEach((t, i) => {
        const row = document.createElement("div");
        const active = trackKey(current) === trackKey(t);
        row.style.cssText =
          "display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:6px;cursor:pointer;" +
          (active ? "background:var(--accent-muted);color:var(--accent);font-weight:600" : "");
        const num = document.createElement("span");
        num.textContent = String(i + 1).padStart(2, "0");
        num.style.cssText = "font-size:10px;color:var(--text-muted);width:18px;flex:0 0 auto";
        const nm = document.createElement("span");
        nm.textContent = t.name;
        nm.title = t.cue_id || t.url;
        nm.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        row.onclick = () => playIndex(i);
        const rm = document.createElement("button");
        rm.type = "button";
        rm.textContent = "×";
        rm.title = "Remove";
        rm.style.cssText =
          "border:0;background:transparent;color:var(--text-muted);cursor:pointer;padding:0 4px;font-size:13px";
        rm.onclick = (e) => {
          e.stopPropagation();
          if (busy) return;
          queue.splice(i, 1);
          if (i < index) index--;
          else if (i === index) index = i - 1;
          saveState();
          renderQueue();
        };
        row.append(num, nm, rm);
        list.append(row);
      });
    }

    audio.ontimeupdate = () => {
      if (token && !busy && !restoringSeek && Number.isFinite(current?.end_sec) && audio.currentTime >= current.end_sec) {
        if (repeat.value === "one") {
          audio.currentTime = current.start_sec || 0;
          audio.play().catch(() => {});
        } else {
          advance(1, true);
        }
      }
    };
    audio.onended = () => advance(1, true);
    repeat.onchange = saveState;
    shuffle.onchange = saveState;

    ctrl.append(
      mkBtn("⏮", () => advance(-1)),
      mkBtn("⏭", () => advance(1)),
      mkBtn("⏹", async () => {
        epoch++;
        await dropToken();
        nowSub.textContent = "Stopped";
      }),
      repeat,
      shLbl
    );

    wrap.append(hdr, nowTitle, nowSub, audio, ctrl, plRow, qHdr, list);
    host.append(wrap);

    const onStorage = (e) => {
      if (e.key === STORAGE) loadState();
    };
    window.addEventListener("storage", onStorage);
    loadState();

    // Load saved playlists asynchronously
    api("playlists_list")
      .then((r) => {
        if (destroyed) return;
        playlists = r.playlists || [];
        plSel.replaceChildren(new Option("Saved playlists (" + playlists.length + ")", ""));
        for (const p of playlists) plSel.add(new Option(p.name + " · " + p.count, p.id));
      })
      .catch(() => {});

    return function dispose() {
      destroyed = true;
      window.removeEventListener("storage", onStorage);
      void dropToken();
      host.replaceChildren();
    };
  }

  // Register with BOTH AppUIPanelApp (Sidebar Gallery) and AppUIShellSidebarRenderer
  const def = {
    id: TYPE,
    sidebarType: TYPE,
    label: "Music Player",
    icon: "♫",
    mountSidebar: (host) => mountMusicSidebar(host),
    mount: (host) => mountMusicSidebar(host),
  };
  if (window.AppUIPanelApp && typeof window.AppUIPanelApp.registerSidebarType === "function") {
    window.AppUIPanelApp.registerSidebarType(def);
  }
  if (window.AppUIShellSidebarRenderer && typeof window.AppUIShellSidebarRenderer.registerType === "function") {
    window.AppUIShellSidebarRenderer.registerType(TYPE, (_spec, container) => mountMusicSidebar(container));
  }
  window.MusicPlayerSidebar = { mount: mountMusicSidebar, type: TYPE };
})();
