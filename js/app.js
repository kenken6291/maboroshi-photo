/* まぼろしフォト app.js v1.0.0 */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;
  const { Speaker, VoiceInput } = window.Voice;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeJSON = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

  const KEY = CFG.STORAGE_KEY;
  const TUT_KEY = KEY + '_tutorial_done';
  const RING_C = 2 * Math.PI * 28;  // 写真ピンの輪
  const SHUT_C = 2 * Math.PI * 40;  // シャッターの輪

  const S = {
    user: null, pos: null, mission: null, clockOffset: 0,
    posts: [], users: [], trails: [],
    settings: Object.assign({}, CFG.DEFAULTS, safeJSON(localStorage.getItem(KEY + '_settings'), {})),
    map: null, layers: {}, markers: new Map(), meMarker: null,
    timers: {}, geoId: null, stream: null, shot: null, mic: null,
    current: null, comments: [], tutIndex: 0,
    announced: new Set(safeJSON(localStorage.getItem(KEY + '_announced'), []))
  };
  const now = () => Date.now() + S.clockOffset;
  const saveSettings = () => localStorage.setItem(KEY + '_settings', JSON.stringify(S.settings));

  /* ========== 表示ヘルパー ========== */
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtTime = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit' });
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`);
  const fmtLeft = (ms) => {
    const m = Math.ceil(ms / 60000);
    if (m <= 1) return 'まもなく消えます';
    if (m < 60) return `あと${m}分で消えます`;
    return `あと${Math.floor(m / 60)}時間${m % 60}分`;
  };
  function dist(a, b, c, d) {
    const R = 6371000, r = (x) => x * Math.PI / 180;
    const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const PALETTE = ['#FF4D7D', '#3DDC97', '#FF9F1C', '#7B5CFF', '#E040FB', '#00A6A6'];
  const colorFor = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

  let toastTimer;
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast ' + type; }, type === 'error' ? 5000 : 3200);
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || '処理中…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  function openSheet(id) {
    const el = $('#' + id);
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('open');
  }
  function closeSheet(id) {
    const el = $('#' + id);
    if (!el || el.hidden) return;
    el.classList.remove('open');
    setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 220);
    if (id === 'cameraModal') stopStream();
    if (id === 'tutorialModal') localStorage.setItem(TUT_KEY, '1');
    if (S.mic) S.mic.stop();
  }

  function ask(title, message, options) {
    return new Promise((resolve) => {
      $('#askTitle').textContent = title;
      $('#askMsg').textContent = message || '';
      $('#askMsg').hidden = !message;
      const box = $('#askOptions');
      box.innerHTML = '';
      [...options, { label: 'キャンセル', value: null }].forEach((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn block ' + (o.kind || '');
        b.textContent = o.label;
        b.onclick = () => { closeSheet('askModal'); resolve(o.value); };
        box.appendChild(b);
      });
      openSheet('askModal');
    });
  }

  function setupVideo(video, src) {
    if (!video || !src || video.dataset.ready) return;
    video.dataset.ready = '1';
    video.onerror = () => { video.hidden = true; };
    video.onloadeddata = () => { if (video.id === 'missionVideo') $('#earthCredit').hidden = false; };
    video.src = src;
    video.play().catch(() => {});
  }

  /* ========== パスワード表示切替 ========== */
  const EYE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  function bindEyes() {
    $$('.pw-wrap').forEach((w) => {
      const b = $('.eye', w), input = $('input', w);
      b.innerHTML = EYE;
      b.onclick = () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.innerHTML = show ? EYE_OFF : EYE;
        b.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示');
      };
    });
  }

  /* ========== 認証 ========== */
  function switchTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }

  function initAuth() {
    $$('.tab').forEach((t) => { t.onclick = () => switchTab(t.dataset.tab); });

    const boxes = $$('#registerForm input[name=agree]');
    const sync = () => {
      const all = boxes.every((b) => b.checked);
      $('#registerSubmit').disabled = !all;
      $('#agreeAll').checked = all;
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    $('#agreeAll').addEventListener('change', (e) => { boxes.forEach((b) => { b.checked = e.target.checked; }); sync(); });

    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, btn = $('[type=submit]', f);
      busy(btn, true, 'ログイン中…');
      try {
        const r = await API.call('login', { email: f.email.value.trim(), password: f.password.value });
        Session.set({ token: r.token, user: r.user }, f.remember.checked);
        S.user = r.user;
        f.password.value = '';
        enterApp();
      } catch (err) { toast(err.message, 'error'); }
      finally { busy(btn, false); }
    });

    $('#registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, btn = $('#registerSubmit');
      const agree = {};
      boxes.forEach((b) => { agree[b.value] = b.checked; });
      busy(btn, true, '送信中…');
      try {
        const email = f.email.value.trim();
        const r = await API.call('register', { nickname: f.nickname.value.trim(), email, agree });
        toast(r.message);
        f.reset();
        switchTab('login');
        $('#loginForm').email.value = email;
      } catch (err) { toast(err.message, 'error'); }
      finally { busy(btn, false); sync(); }
    });

    $('#resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, btn = $('[type=submit]', f);
      busy(btn, true, '送信中…');
      try {
        const r = await API.call('resetPassword', { email: f.email.value.trim() });
        toast(r.message);
        switchTab('login');
        $('#loginForm').email.value = f.email.value.trim();
      } catch (err) { toast(err.message, 'error'); }
      finally { busy(btn, false); }
    });
  }

  function showAuth() {
    $('#mainScreen').hidden = true;
    $('#authScreen').hidden = false;
    setupVideo($('#authVideo'), CFG.EARTH && CFG.EARTH.authVideo);
  }

  function enterApp() {
    $('#authScreen').hidden = true;
    $('#mainScreen').hidden = false;
    if (!S.map) initMap();
    setTimeout(() => S.map.invalidateSize(), 50);
    startGeo();
    startLoops();
    updateFilterSummary();
    refreshMission();
    refreshMap();
    if (S.user.mustChange) openPwModal(true);
  }

  async function logout() {
    try { await API.call('logout'); } catch { /* 期限切れでも続行 */ }
    Session.clear();
    stopLoops();
    if (S.geoId != null) { navigator.geolocation.clearWatch(S.geoId); S.geoId = null; }
    S.user = null; S.mission = null; S.posts = [];
    S.markers.forEach((m) => S.layers.posts.removeLayer(m));
    S.markers.clear();
    closeSheet('menuSheet');
    showAuth();
  }

  /* ========== パスワード変更 ========== */
  function openPwModal(forced) {
    const f = $('#pwForm');
    f.reset();
    $('#pwTitle').textContent = forced ? '新しいパスワードを設定' : 'パスワードを変更';
    $('#pwNote').textContent = forced ? 'メールで届いた仮パスワードを入力し、自分で決めたパスワードに変更してください。' : '';
    $('#pwClose').hidden = forced;
    $('#pwModal').dataset.lock = forced ? '1' : '';
    openSheet('pwModal');
  }

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, btn = $('[type=submit]', f);
    if (f.next.value !== f.confirm.value) return toast('確認用のパスワードが一致しません', 'error');
    busy(btn, true, '変更中…');
    try {
      const r = await API.call('changePassword', { currentPassword: f.current.value, newPassword: f.next.value });
      S.user.mustChange = false;
      Session.update({ user: S.user });
      $('#pwModal').dataset.lock = '';
      closeSheet('pwModal');
      toast(r.message);
      if (!localStorage.getItem(TUT_KEY)) openTutorial();
    } catch (err) { toast(err.message, 'error'); }
    finally { busy(btn, false); }
  });

  /* ========== 地図 ========== */
  function initMap() {
    S.map = L.map('map', { zoomControl: false }).setView(CFG.MAP.defaultCenter, CFG.MAP.defaultZoom);
    L.tileLayer(CFG.MAP.tileUrl, { maxZoom: 19, attribution: CFG.MAP.attribution }).addTo(S.map);
    S.layers.range = L.layerGroup().addTo(S.map);
    S.layers.trails = L.layerGroup().addTo(S.map);
    S.layers.users = L.layerGroup().addTo(S.map);
    S.layers.posts = L.layerGroup().addTo(S.map);
  }

  function startGeo() {
    if (!('geolocation' in navigator)) { toast('この端末では位置情報が使えません', 'error'); return; }
    if (S.geoId != null) return;
    let first = true;
    S.geoId = navigator.geolocation.watchPosition((p) => {
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      drawMe();
      if (first) {
        first = false;
        S.map.setView([S.pos.lat, S.pos.lng], 16);
        sendLocation();
        refreshMap();
      }
    }, (err) => {
      toast(err.code === 1 ? '位置情報の利用が許可されていません。ブラウザの設定で許可してください' : '現在地を取得できません。電波の良い場所でお試しください', 'error');
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }

  function drawMe() {
    if (!S.pos) return;
    const ll = [S.pos.lat, S.pos.lng];
    if (!S.meMarker) {
      S.meMarker = L.marker(ll, {
        icon: L.divIcon({ className: 'pin-wrap', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="pin-me"></div>' }),
        interactive: false, zIndexOffset: 1000
      }).addTo(S.map);
    } else {
      S.meMarker.setLatLng(ll);
    }
    drawRange();
  }

  function drawRange() {
    if (!S.layers.range) return;
    S.layers.range.clearLayers();
    if (!S.pos) return;
    const st = S.settings, ll = [S.pos.lat, S.pos.lng];
    if (st.distanceMode === 'near') {
      L.circle(ll, { radius: st.nearM, color: '#25205E', weight: 2, fillColor: '#FFE04A', fillOpacity: 0.18, interactive: false }).addTo(S.layers.range);
    } else if (st.distanceMode === 'far') {
      L.circle(ll, { radius: st.farM, color: '#FF4D7D', weight: 3, dashArray: '8 8', fill: false, interactive: false }).addTo(S.layers.range);
    }
  }

  function remainFrac(p) {
    const start = p.pending ? p.createdAt : p.revealAt;
    const total = p.expireAt - start;
    return total > 0 ? Math.max(0, Math.min(1, (p.expireAt - now()) / total)) : 0;
  }

  function postIcon(p) {
    const cls = ['pin-photo', p.mine ? 'mine' : '', p.pending ? 'pending' : ''].join(' ');
    return L.divIcon({
      className: 'pin-wrap', iconSize: [64, 64], iconAnchor: [32, 32],
      html: `<div class="${cls}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" class="rb"/><circle cx="32" cy="32" r="28" class="rf" style="stroke-dashoffset:${(RING_C * (1 - remainFrac(p))).toFixed(1)}"/></svg><img src="${esc(p.thumbUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="nm">${esc(p.nickname)}</span></div>`
    });
  }

  function removeMarker(id) {
    const m = S.markers.get(id);
    if (!m) return;
    S.markers.delete(id);
    const el = m.getElement();
    const inner = el && el.firstElementChild;
    if (inner) { inner.classList.add('poof'); setTimeout(() => S.layers.posts.removeLayer(m), 430); }
    else S.layers.posts.removeLayer(m);
  }

  function renderMap() {
    const ids = new Set(S.posts.map((p) => p.postId));
    for (const id of Array.from(S.markers.keys())) if (!ids.has(id)) removeMarker(id);

    S.posts.forEach((p) => {
      const ex = S.markers.get(p.postId);
      if (ex) {
        ex.post = p;
        if (ex.pendingState !== p.pending) { ex.setIcon(postIcon(p)); ex.pendingState = p.pending; }
        return;
      }
      const m = L.marker([p.lat, p.lng], { icon: postIcon(p), riseOnHover: true, title: `${p.nickname}さんの写真` });
      m.post = p;
      m.pendingState = p.pending;
      m.on('click', () => openPost(m.post.postId));
      m.addTo(S.layers.posts);
      S.markers.set(p.postId, m);
    });

    S.layers.users.clearLayers();
    S.users.forEach((u) => {
      L.marker([u.lat, u.lng], {
        icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: `<div class="pin-user">${esc(u.nickname)}</div>` }),
        interactive: false
      }).addTo(S.layers.users);
    });

    S.layers.trails.clearLayers();
    S.trails.forEach((t) => {
      const color = t.mine ? '#22B8EE' : colorFor(t.userId);
      const pts = t.points.map((p) => [p.lat, p.lng]);
      if (pts.length > 1) L.polyline(pts, { color, weight: 5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(S.layers.trails);
      t.points.forEach((p, i) => {
        const last = i === t.points.length - 1;
        if (!last && i % 3) return;
        L.circleMarker([p.lat, p.lng], { radius: last ? 8 : 4, color: '#25205E', weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(`${esc(t.nickname)}（${fmtTime(p.at)}）`, { direction: 'top' })
          .addTo(S.layers.trails);
      });
    });

    updateCount();
    if ($('#listSheet').classList.contains('open')) renderList();
  }

  function updateCount() {
    $('#postCount').textContent = S.posts.filter((p) => !p.pending || p.mine).length;
  }

  /** 輪を減らし、時間切れの写真をその場で消す（サーバーを待たない） */
  function updateRings() {
    let changed = false;
    for (const [id, m] of Array.from(S.markers.entries())) {
      const p = m.post;
      if (now() >= p.expireAt) {
        removeMarker(id);
        S.posts = S.posts.filter((x) => x.postId !== id);
        changed = true;
        continue;
      }
      if (p.pending && now() >= p.revealAt) {
        p.pending = false;
        m.setIcon(postIcon(p));
        m.pendingState = false;
        continue;
      }
      const el = m.getElement();
      const rf = el && el.querySelector('.rf');
      if (rf) rf.style.strokeDashoffset = (RING_C * (1 - remainFrac(p))).toFixed(1);
    }
    if (changed) updateCount();
  }

  async function refreshMap() {
    if (document.hidden || !S.user || !S.map) return;
    const st = S.settings;
    try {
      const r = await API.call('listMap', {
        lat: S.pos ? S.pos.lat : null,
        lng: S.pos ? S.pos.lng : null,
        filter: {
          timeMode: st.timeMode, historyMin: st.historyMin,
          distanceMode: st.distanceMode, distanceM: st.distanceMode === 'far' ? st.farM : st.nearM
        }
      });
      S.clockOffset = r.serverNow - Date.now();
      S.posts = r.posts || [];
      S.users = r.users || [];
      S.trails = r.trails || [];
      renderMap();
    } catch (e) { console.warn(e); }
  }

  async function sendLocation() {
    if (!S.user || !S.pos || !S.settings.share || document.hidden) return;
    try { await API.call('updateLocation', { lat: S.pos.lat, lng: S.pos.lng }); } catch (e) { console.warn(e); }
  }

  /* ========== ミッション ========== */
  async function refreshMission() {
    if (document.hidden || !S.user) return;
    try {
      const r = await API.call('getMission');
      S.clockOffset = r.serverNow - Date.now();
      const m = r.mission;
      S.mission = m;
      if (m.status === 'open' && !S.announced.has(m.missionId)) {
        S.announced.add(m.missionId);
        localStorage.setItem(KEY + '_announced', JSON.stringify(Array.from(S.announced).slice(-30)));
        if (!m.posted) announce(m);
      }
      if (m.status === 'showing' && !S.lastShowing) refreshMap();
      S.lastShowing = m.status === 'showing' ? m.missionId : null;
      tick();
    } catch (e) { console.warn(e); }
  }

  function announce(m) {
    $('#bannerText').textContent = m.text;
    $('#bannerSub').textContent = `撮影できるのは ${fmtTime(m.closeAt)} まで。写真は ${fmtTime(m.revealAt)} にいっせいに地図へ現れ、${m.displayMin}分後に消えます。`;
    setupVideo($('#missionVideo'), CFG.EARTH && CFG.EARTH.missionVideo);
    openSheet('missionBanner');
    $('#missionVideo').play().catch(() => {});
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    Speaker.speak(m.speech || m.text);
  }

  /** 1秒ごと：ミッション表示・シャッター・カメラ残り時間・詳細の残り時間 */
  function tick() {
    const m = S.mission, chip = $('#missionChip'), cam = $('#cameraBtn'), ring = $('#shutterRing');
    if (m && m.status === 'open') {
      const left = m.closeAt - now();
      if (left <= 0) {
        S.mission = { status: 'waiting' };
        refreshMission();
        setTimeout(refreshMap, 3000);
        return;
      }
      chip.dataset.state = 'open';
      chip.innerHTML = `ミッション中：${esc(m.text)} <span class="t">残り${fmtClock(left)}</span>`;
      cam.disabled = !!m.posted;
      $('#shutterLabel').textContent = m.posted ? '投稿済み' : '撮影';
      ring.style.strokeDashoffset = (SHUT_C * (1 - left / (m.closeAt - m.openAt))).toFixed(1);
      $('#camLeft').textContent = fmtClock(left);
    } else if (m && m.status === 'showing') {
      chip.dataset.state = 'showing';
      chip.textContent = `公開中「${m.text}」${fmtLeft(m.expireAt - now()).replace('で消えます', '')}`;
      cam.disabled = true;
      $('#shutterLabel').textContent = '待機中';
      ring.style.strokeDashoffset = SHUT_C;
    } else {
      chip.dataset.state = 'waiting';
      chip.textContent = '次のミッションを待っています';
      cam.disabled = true;
      $('#shutterLabel').textContent = '待機中';
      ring.style.strokeDashoffset = SHUT_C;
    }
    updatePostRemain();
  }

  function startLoops() {
    stopLoops();
    S.timers.mission = setInterval(refreshMission, CFG.POLL.missionSec * 1000);
    S.timers.map = setInterval(refreshMap, CFG.POLL.mapSec * 1000);
    S.timers.loc = setInterval(sendLocation, CFG.POLL.locationSec * 1000);
    S.timers.tick = setInterval(tick, 1000);
    S.timers.ring = setInterval(updateRings, 5000);
  }
  function stopLoops() {
    Object.values(S.timers).forEach(clearInterval);
    S.timers = {};
  }

  /* ========== カメラ ========== */
  function showCamStep(step) {
    $$('#cameraModal [data-step]').forEach((el) => { el.hidden = el.dataset.step !== step; });
  }
  function stopStream() {
    if (S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
  }

  async function openCamera() {
    const m = S.mission;
    if (!m || m.status !== 'open') return toast('撮影できるのはミッションの時間中だけです');
    if (m.posted) return toast('このミッションには投稿済みです');
    if (!S.pos) return toast('現在地を取得中です。位置情報をオンにしてください', 'error');
    $('#camMission').textContent = m.text;
    $('#camComment').value = '';
    openSheet('cameraModal');
    startStream();
  }

  async function startStream() {
    S.shot = null;
    showCamStep('live');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showCamStep('fallback');
    try {
      stopStream();
      S.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false
      });
      if ($('#cameraModal').hidden) { stopStream(); return; }
      const v = $('#camVideo');
      v.srcObject = S.stream;
      await v.play();
    } catch (e) {
      console.warn(e);
      showCamStep('fallback');
    }
  }

  function toJpeg(src, w, h) {
    const scale = Math.min(1, CFG.IMAGE.maxSize / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', CFG.IMAGE.quality);
  }

  function showPreview(dataUrl) {
    S.shot = dataUrl;
    $('#camPreview').src = dataUrl;
    showCamStep('preview');
  }

  function captureFrame() {
    const v = $('#camVideo');
    if (!v.videoWidth) return toast('カメラの準備中です。もう一度押してください');
    showPreview(toJpeg(v, v.videoWidth, v.videoHeight));
    stopStream();
  }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const img = new Image();
    img.onload = () => { showPreview(toJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
    img.onerror = () => toast('写真を読み込めませんでした', 'error');
    img.src = URL.createObjectURL(file);
  }

  async function sendPhoto() {
    const m = S.mission;
    if (!S.shot) return;
    if (!m || m.status !== 'open') return toast('ミッションの時間が終わりました', 'error');
    if (!S.pos) return toast('現在地がわかりません。位置情報をオンにしてください', 'error');
    const btn = $('#camSend');
    busy(btn, true, '送信中…');
    try {
      const r = await API.call('uploadPhoto', {
        missionId: m.missionId, image: S.shot, lat: S.pos.lat, lng: S.pos.lng, comment: $('#camComment').value.trim()
      }, { timeout: 90000 });
      m.posted = true;
      closeSheet('cameraModal');
      toast(r.message);
      refreshMap();
      tick();
    } catch (err) { toast(err.message, 'error'); }
    finally { busy(btn, false); }
  }

  /* ========== 写真の詳細・コメント ========== */
  async function openPost(id) {
    S.current = null;
    $('#postBody').innerHTML = '<p class="muted">読み込み中…</p>';
    $('#commentForm').hidden = true;
    openSheet('postSheet');
    try {
      const r = await API.call('getPost', { postId: id });
      S.current = r.post;
      S.comments = r.comments || [];
      $('#commentForm').hidden = false;
      renderPost();
    } catch (err) {
      $('#postBody').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  function commentHtml(c) {
    const p = S.current;
    let tools = c.edited ? '<small>編集済み</small>' : '';
    if (c.mine) tools += '<button type="button" data-act="editC">編集</button><button type="button" data-act="delC">削除</button>';
    else {
      if (p.mine) tools += '<button type="button" data-act="delC">削除</button>';
      tools += '<button type="button" data-act="moreC">通報・ブロック</button>';
    }
    return `<li data-cid="${esc(c.commentId)}"><div class="c-head"><span>${esc(c.nickname)}</span><span class="c-tools">${tools}</span></div><p class="c-text">${esc(c.text)}</p></li>`;
  }

  function renderPost() {
    const p = S.current;
    if (!p) return;
    const far = S.pos ? `／ここから${fmtDist(dist(S.pos.lat, S.pos.lng, p.lat, p.lng))}` : '';
    $('#postBody').innerHTML = `
      <img class="post-photo" src="${esc(p.imageUrl)}" alt="${esc(p.nickname)}さんの写真" referrerpolicy="no-referrer">
      <div class="post-meta"><strong>${esc(p.nickname)}</strong><span class="remain" id="postRemain"></span></div>
      <p class="mission-tag">ミッション「${esc(p.missionText)}」${esc(far)}</p>
      <div id="postCommentBox">${p.comment ? `<p class="bubble">${esc(p.comment)}</p>` : (p.mine ? '<p class="muted small">ひとことはまだありません</p>' : '')}</div>
      <div class="actions">
        <button type="button" class="btn sm like ${p.liked ? 'on' : ''}" data-act="like" aria-pressed="${p.liked}">いいね ${p.likes}</button>
        ${p.mine
          ? '<button type="button" class="btn sm" data-act="editPost">ひとことを編集</button><button type="button" class="btn sm danger" data-act="deletePost">写真を削除</button>'
          : '<button type="button" class="btn sm" data-act="postMore">通報・ブロック</button>'}
      </div>
      <h3>コメント ${S.comments.length}</h3>
      <ul class="comments">${S.comments.map(commentHtml).join('') || '<li class="muted small">まだコメントはありません。最初のひとことをどうぞ</li>'}</ul>`;
    updatePostRemain();
  }

  function updatePostRemain() {
    const p = S.current, el = $('#postRemain');
    if (!p || !el || $('#postSheet').hidden) return;
    if (now() >= p.expireAt) {
      closeSheet('postSheet');
      toast('写真が消えました');
      S.current = null;
      return;
    }
    const pending = now() < p.revealAt;
    el.classList.toggle('pending', pending);
    el.textContent = pending ? `${fmtTime(p.revealAt)}に公開` : fmtLeft(p.expireAt - now());
  }

  async function reportOrBlock(type, id, userId, nickname) {
    const what = type === 'post' ? '写真' : 'コメント';
    const act = await ask(`${nickname}さんの${what}`, '通報すると、あなたの画面からすぐに見えなくなります。ブロックすると、おたがいの写真とコメントが見えなくなります。', [
      { label: `この${what}を通報する`, value: 'report', kind: 'danger' },
      { label: `${nickname}さんをブロックする`, value: 'block' }
    ]);
    if (!act) return;
    try {
      if (act === 'report') {
        const reason = await ask('通報の理由', '', [
          { label: '悪口・攻撃的な内容', value: 'abuse' },
          { label: '個人情報・プライバシーの侵害', value: 'privacy' },
          { label: '性的・暴力的な内容', value: 'explicit' },
          { label: 'スパム・宣伝', value: 'spam' },
          { label: 'その他', value: 'other' }
        ]);
        if (!reason) return;
        const r = await API.call('report', { targetType: type, targetId: id, reason });
        toast(r.message);
      } else {
        const r = await API.call('block', { targetUserId: userId });
        toast(r.message);
      }
      if (type === 'post' || act === 'block') closeSheet('postSheet');
      else { S.comments = S.comments.filter((c) => c.commentId !== id); renderPost(); }
      refreshMap();
    } catch (err) { toast(err.message, 'error'); }
  }

  $('#postBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !S.current) return;
    const p = S.current;
    const li = b.closest('[data-cid]');
    const cid = li ? li.dataset.cid : null;
    const c = cid ? S.comments.find((x) => x.commentId === cid) : null;
    try {
      switch (b.dataset.act) {
        case 'like': {
          b.disabled = true;
          const r = await API.call('toggleLike', { postId: p.postId });
          p.liked = r.liked; p.likes = r.likes;
          const m = S.markers.get(p.postId);
          if (m) Object.assign(m.post, { liked: r.liked, likes: r.likes });
          renderPost();
          break;
        }
        case 'editPost':
          $('#postCommentBox').innerHTML = `<div class="c-edit"><div class="comment-row"><textarea id="editPostText" maxlength="100" rows="2">${esc(p.comment)}</textarea><button type="button" class="mic" data-mic="editPostText" aria-label="音声で入力">🎤</button></div><div class="row"><button type="button" class="btn sm" data-act="cancel">やめる</button><button type="button" class="btn sm primary" data-act="savePost">保存</button></div></div>`;
          $('#editPostText').focus();
          break;
        case 'savePost': {
          busy(b, true, '保存中…');
          const r = await API.call('editPost', { postId: p.postId, comment: $('#editPostText').value });
          p.comment = r.comment;
          toast(r.message);
          renderPost();
          break;
        }
        case 'cancel':
          renderPost();
          break;
        case 'deletePost': {
          const ok = await ask('この写真を削除しますか？', '削除すると元に戻せません。', [{ label: '削除する', value: true, kind: 'danger' }]);
          if (!ok) return;
          const r = await API.call('deletePost', { postId: p.postId });
          closeSheet('postSheet');
          removeMarker(p.postId);
          S.posts = S.posts.filter((x) => x.postId !== p.postId);
          updateCount();
          toast(r.message);
          break;
        }
        case 'postMore':
          reportOrBlock('post', p.postId, p.userId, p.nickname);
          break;
        case 'editC':
          $('.c-text', li).outerHTML = `<div class="c-edit"><div class="comment-row"><textarea id="editC_${esc(cid)}" maxlength="200" rows="2">${esc(c.text)}</textarea><button type="button" class="mic" data-mic="editC_${esc(cid)}" aria-label="音声で入力">🎤</button></div><div class="row"><button type="button" class="btn sm" data-act="cancel">やめる</button><button type="button" class="btn sm primary" data-act="saveC">保存</button></div></div>`;
          break;
        case 'saveC': {
          busy(b, true, '保存中…');
          const r = await API.call('editComment', { commentId: cid, text: $('textarea', li).value });
          c.text = r.text; c.edited = true;
          renderPost();
          break;
        }
        case 'delC': {
          const ok = await ask('このコメントを削除しますか？', '', [{ label: '削除する', value: true, kind: 'danger' }]);
          if (!ok) return;
          await API.call('deleteComment', { commentId: cid });
          S.comments = S.comments.filter((x) => x.commentId !== cid);
          renderPost();
          break;
        }
        case 'moreC':
          reportOrBlock('comment', cid, c.userId, c.nickname);
          break;
      }
    } catch (err) {
      toast(err.message, 'error');
      if (b.isConnected) busy(b, false);
      b.disabled = false;
    }
  });

  $('#commentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('#commentText'), text = ta.value.trim();
    if (!text || !S.current) return;
    const btn = $('[type=submit]', e.target);
    busy(btn, true, '送信中…');
    try {
      const r = await API.call('addComment', { postId: S.current.postId, text });
      S.comments.push(r.comment);
      ta.value = '';
      renderPost();
    } catch (err) { toast(err.message, 'error'); }
    finally { busy(btn, false); }
  });

  /* ========== 音声入力ボタン ========== */
  function toggleMic(btn, ta) {
    if (S.mic) { S.mic.stop(); return; }
    if (!ta) return;
    if (!VoiceInput.supported()) return toast('このブラウザは音声入力に対応していません（Chrome・Edge・Safariの最新版をお使いください）', 'error');
    const max = ta.maxLength > 0 ? ta.maxLength : 500;
    const base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
    S.mic = new VoiceInput(Object.assign({}, CFG.VOICE, {
      onUpdate: (t) => { ta.value = (base + t).slice(0, max); },
      onEnd: (t) => {
        ta.value = (base + t).trim().slice(0, max);
        btn.classList.remove('rec');
        btn.setAttribute('aria-pressed', 'false');
        S.mic = null;
      },
      onError: (msg) => toast(msg, 'error')
    }));
    try {
      S.mic.start();
      btn.classList.add('rec');
      btn.setAttribute('aria-pressed', 'true');
      toast('話してください。しばらく黙ると自動で終わります');
    } catch (err) {
      S.mic = null;
      toast(err.message, 'error');
    }
  }

  /* ========== 写真一覧 ========== */
  function renderList() {
    const items = S.posts.filter((p) => !p.pending || p.mine).sort((a, b) => a.expireAt - b.expireAt);
    if (!items.length) {
      $('#listBody').innerHTML = `<div class="empty"><p>いま見える写真はありません。</p><p class="muted small">${S.settings.timeMode === 'history'
        ? '足あと表示では写真は出ません。表示条件を「いま公開中の写真」に切り替えてください。'
        : 'ミッションが来たら撮影して、地図に写真を浮かべましょう。表示条件の距離を広げると見つかるかもしれません。'}</p></div>`;
      return;
    }
    $('#listBody').innerHTML = `<ul class="plist">${items.map((p) => {
      const when = p.pending ? `${fmtTime(p.revealAt)}に公開` : fmtLeft(p.expireAt - now());
      const far = S.pos ? `／${fmtDist(dist(S.pos.lat, S.pos.lng, p.lat, p.lng))}` : '';
      return `<li><button type="button" data-pid="${esc(p.postId)}"><img src="${esc(p.thumbUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span><strong>${esc(p.nickname)}</strong><br><small>${esc(when + far)}</small><br><small class="muted">${esc(p.comment || p.missionText)}</small></span></button></li>`;
    }).join('')}</ul>`;
  }

  $('#listBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    const p = S.posts.find((x) => x.postId === b.dataset.pid);
    closeSheet('listSheet');
    if (p) S.map.flyTo([p.lat, p.lng], 17);
    openPost(b.dataset.pid);
  });

  /* ========== 表示条件 ========== */
  function syncFilterUi() {
    const f = $('#filterForm');
    $('#historyField').hidden = f.timeMode.value !== 'history';
    $('#nearField').hidden = f.distanceMode.value !== 'near';
    $('#farField').hidden = f.distanceMode.value !== 'far';
    $('#nearOut').textContent = fmtDist(Number(f.nearM.value));
    $('#farOut').textContent = fmtDist(Number(f.farM.value));
  }

  function openFilter() {
    const f = $('#filterForm'), st = S.settings;
    f.timeMode.value = st.timeMode;
    f.historyMin.value = String(st.historyMin);
    f.distanceMode.value = st.distanceMode;
    f.nearM.value = st.nearM;
    f.farM.value = st.farM;
    f.share.checked = !!st.share;
    syncFilterUi();
    openSheet('filterSheet');
  }

  function updateFilterSummary() {
    const st = S.settings;
    const t = st.timeMode === 'history'
      ? `${st.historyMin >= 60 ? st.historyMin / 60 + '時間' : st.historyMin + '分'}前からの足あと`
      : 'いま公開中';
    const d = st.distanceMode === 'near' ? `${fmtDist(st.nearM)}以内` : st.distanceMode === 'far' ? `${fmtDist(st.farM)}以上先` : 'すべての距離';
    $('#filterSummary').textContent = `${t}・${d}`;
  }

  $('#filterForm').addEventListener('input', syncFilterUi);
  $('#filterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    Object.assign(S.settings, {
      timeMode: f.timeMode.value, historyMin: Number(f.historyMin.value),
      distanceMode: f.distanceMode.value, nearM: Number(f.nearM.value), farM: Number(f.farM.value),
      share: f.share.checked
    });
    saveSettings();
    drawRange();
    updateFilterSummary();
    closeSheet('filterSheet');
    if (S.settings.distanceMode !== 'all' && !S.pos) toast('現在地がわかるまで、距離の条件は使えません');
    S.posts = [];
    renderMap();
    refreshMap();
    if (S.settings.share) sendLocation();
  });

  /* ========== メニュー ========== */
  async function openMenu() {
    $('#menuNick').textContent = `${S.user.nickname} さん`;
    $('#adminMissionBtn').hidden = S.user.role !== 'admin';
    openSheet('menuSheet');
    const box = $('#blockList');
    box.innerHTML = '<li class="muted small">読み込み中…</li>';
    try {
      const r = await API.call('listBlocks');
      box.innerHTML = r.blocks.length
        ? r.blocks.map((b) => `<li><span>${esc(b.nickname)}</span><button type="button" class="btn sm" data-unblock="${esc(b.userId)}">解除</button></li>`).join('')
        : '<li class="muted small">ブロック中のユーザーはいません</li>';
    } catch (err) { box.innerHTML = `<li class="muted small">${esc(err.message)}</li>`; }
  }

  $('#blockList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unblock]');
    if (!b) return;
    try {
      const r = await API.call('unblock', { targetUserId: b.dataset.unblock });
      toast(r.message);
      b.closest('li').remove();
      refreshMap();
    } catch (err) { toast(err.message, 'error'); }
  });

  /* ========== 遊び方 ========== */
  const TUT = [
    { art: '📡', title: 'ミッションは突然くる', text: 'AIがときどき「青いものを撮って」のようなお題を出します。画面の上が赤く光ったら合図です。' },
    { art: '📷', title: '撮れるのはミッション中だけ', text: '下の丸いボタンで撮影します。ひとことを添えて投稿すると、撮った場所に写真のピンが立ちます。' },
    { art: '⏳', title: 'みんなの写真がいっせいに出て、消える', text: 'ミッションが終わると全員の写真が同時に地図へ。ピンのまわりの赤い輪がなくなると消えます。' },
    { art: '🧭', title: '近く・遠く・少し前を探検', text: '「表示条件」で、近くだけ・遠くだけ・少し前の足あとを切り替えられます。' },
    { art: '💬', title: 'いいねとコメントで交流', text: '写真をタップするとコメントできます。いやな相手は通報・ブロックできます。人の顔や住まいが分かるものは撮らないでください。' }
  ];

  function openTutorial() {
    S.tutIndex = 0;
    renderTutorial();
    openSheet('tutorialModal');
  }
  function renderTutorial() {
    const i = S.tutIndex, s = TUT[i];
    $('#tutBody').innerHTML = `<div class="tut-art" aria-hidden="true">${s.art}</div><p class="tut-step">${i + 1} / ${TUT.length}</p><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>`;
    $('#tutDots').innerHTML = TUT.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    $('#tutPrev').disabled = i === 0;
    $('#tutNext').textContent = i === TUT.length - 1 ? 'はじめる' : 'つぎへ';
  }
  $('#tutPrev').onclick = () => { if (S.tutIndex > 0) { S.tutIndex--; renderTutorial(); } };
  $('#tutNext').onclick = () => {
    if (S.tutIndex < TUT.length - 1) { S.tutIndex++; renderTutorial(); }
    else closeSheet('tutorialModal');
  };

  /* ========== 読み上げ ========== */
  function setSound(on, silent) {
    S.settings.sound = on;
    saveSettings();
    Speaker.enabled = on;
    const b = $('#soundBtn');
    b.textContent = on ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? '読み上げをオフにする' : '読み上げをオンにする');
    if (on && !silent) { Speaker.unlock(); Speaker.speak('読み上げをオンにしました'); }
  }

  /* ========== イベント ========== */
  function initUi() {
    $('#soundBtn').onclick = () => setSound(!S.settings.sound);
    $('#menuBtn').onclick = openMenu;
    $('#filterBtn').onclick = openFilter;
    $('#filterSummary').onclick = openFilter;
    $('#listBtn').onclick = () => { renderList(); openSheet('listSheet'); };
    $('#locateBtn').onclick = () => { if (S.pos) S.map.flyTo([S.pos.lat, S.pos.lng], 16); else toast('現在地を取得中です'); };
    $('#cameraBtn').onclick = openCamera;
    $('#missionChip').onclick = () => {
      const m = S.mission;
      if (m && m.status === 'open') openCamera();
      else if (m && m.status === 'showing') { renderList(); openSheet('listSheet'); }
      else toast('ミッションはいつ来るか分かりません。地図を開いたまま探検してみてください');
    };
    $('#bannerShoot').onclick = () => { closeSheet('missionBanner'); openCamera(); };
    $('#bannerLater').onclick = () => closeSheet('missionBanner');
    $('#camShot').onclick = captureFrame;
    $('#camRetake').onclick = startStream;
    $('#camSend').onclick = sendPhoto;
    $('#camClose').onclick = () => closeSheet('cameraModal');
    $('#camFile').onchange = onFile;
    $('#changePwBtn').onclick = () => { closeSheet('menuSheet'); openPwModal(false); };
    $('#logoutBtn').onclick = logout;
    $('#adminMissionBtn').onclick = async () => {
      const text = window.prompt('ミッションのお題（空欄ならAIが考えます）', '');
      if (text === null) return;
      try {
        const r = await API.call('adminMission', { text });
        toast(r.message);
        closeSheet('menuSheet');
        refreshMission();
      } catch (err) { toast(err.message, 'error'); }
    };

    document.addEventListener('click', (e) => {
      const mic = e.target.closest('[data-mic]');
      if (mic) { e.preventDefault(); toggleMic(mic, document.getElementById(mic.dataset.mic)); return; }
      const close = e.target.closest('[data-close]');
      if (close) { closeSheet(close.closest('.overlay').id); return; }
      if (e.target.classList && e.target.classList.contains('overlay') && !e.target.dataset.lock) { closeSheet(e.target.id); return; }
      if (e.target.closest('[data-open-tutorial]')) openTutorial();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const o = $$('.overlay.open').filter((x) => !x.dataset.lock).pop();
      if (o) closeSheet(o.id);
    });
    document.addEventListener('pointerdown', () => { if (S.settings.sound) Speaker.unlock(); }, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S.user) { refreshMission(); refreshMap(); }
    });
    window.addEventListener('auth-expired', () => {
      if (!S.user) return;
      S.user = null;
      stopLoops();
      showAuth();
      toast('ログインの有効期限が切れました。もう一度ログインしてください', 'error');
    });
  }

  /* ========== 起動 ========== */
  async function boot() {
    document.title = CFG.APP_NAME;
    $$('.ver').forEach((el) => { el.textContent = CFG.VERSION; });
    bindEyes();
    initAuth();
    initUi();
    setSound(!!S.settings.sound, true);

    const s = Session.get();
    if (s && s.token) {
      try {
        const r = await API.call('me');
        S.user = r.user;
        Session.update({ user: r.user });
        enterApp();
      } catch { showAuth(); }
    } else {
      showAuth();
    }
    $('#boot').remove();
    if (!localStorage.getItem(TUT_KEY) && !(S.user && S.user.mustChange)) openTutorial();
  }

  boot();
})();
