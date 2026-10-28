/* まぼろしフォト app.js v1.2.0 */
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
    announced: new Set(safeJSON(localStorage.getItem(KEY + '_announced'), [])),
    // 気配メーター・予想ゲーム
    hint: null, notifiedLevel: -1, omenShown: -1, omenLineAt: 0,
    bet: safeJSON(localStorage.getItem(KEY + '_bet'), null),
    score: Object.assign({ hit: 0, tries: 0, streak: 0, best: 0 }, safeJSON(localStorage.getItem(KEY + '_score'), {})),
    // じゆう投稿・まぼろし新聞
    camMode: 'free',
    freeDelay: CFG.FREE.defaultDelay, freeDur: CFG.FREE.defaultDuration,
    paper: { items: [], total: 0 }, lastArticleEd: 0
  };
  (() => {
    const f = safeJSON(localStorage.getItem(KEY + '_free'), null);
    if (f && CFG.FREE.delays.includes(f.delay)) S.freeDelay = f.delay;
    if (f && CFG.FREE.durations.includes(f.dur)) S.freeDur = f.dur;
  })();
  const now = () => Date.now() + S.clockOffset;
  const saveSettings = () => localStorage.setItem(KEY + '_settings', JSON.stringify(S.settings));

  /* ========== 表示ヘルパー ========== */
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtTime = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit' });
  const fmtWhen = (t) => {
    const d = new Date(t), today = new Date(now());
    const days = Math.round((new Date(d.toDateString()) - new Date(today.toDateString())) / 86400000);
    return (days === 1 ? '明日' : days > 1 ? `${d.getMonth() + 1}/${d.getDate()} ` : '') + fmtTime(t);
  };
  const WEEK = '日月火水木金土';
  const fmtDateJa = (t) => { const d = new Date(t); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`; };
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
    const cls = ['pin-photo', p.mine ? 'mine' : '', p.pending ? 'pending' : '', p.free ? 'free' : ''].join(' ');
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
      if (r.hint) onHint(r.hint);
      if (r.latestArticle) onLatestArticle(r.latestArticle);
      const result = resolveBet(m.openAt || (r.hint && r.hint.lastAt));
      if (m.status === 'open' && !S.announced.has(m.missionId)) {
        S.announced.add(m.missionId);
        localStorage.setItem(KEY + '_announced', JSON.stringify(Array.from(S.announced).slice(-30)));
        S.notifiedLevel = 2;
        if (!m.posted) announce(m, result);
        else if (result) showBetResult(result);
      } else if (result) {
        showBetResult(result);
      }
      if (m.status === 'showing' && !S.lastShowing) refreshMap();
      S.lastShowing = m.status === 'showing' ? m.missionId : null;
      tick();
    } catch (e) { console.warn(e); }
  }

  function announce(m, result) {
    $('#bannerText').textContent = m.text;
    const head = result ? (result.hit ? `予想的中！ ` : `予想は「${BET_LABEL[result.bucket]}」ではずれ。`) : '';
    $('#bannerSub').textContent = `${head}撮影できるのは ${fmtTime(m.closeAt)} まで。写真は ${fmtTime(m.revealAt)} にいっせいに地図へ現れ、${m.displayMin}分後に消えます。`;
    if (result && result.hit) hitBurst('予想的中！');
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
      cam.disabled = false;
      cam.classList.toggle('free', !!m.posted);
      $('#shutterLabel').textContent = m.posted ? '投稿' : '撮影';
      ring.style.strokeDashoffset = (SHUT_C * (1 - left / (m.closeAt - m.openAt))).toFixed(1);
      $('#camLeft').textContent = fmtClock(left);
    } else if (m && m.status === 'showing') {
      chip.dataset.state = 'showing';
      chip.textContent = `公開中「${m.text}」${fmtLeft(m.expireAt - now()).replace('で消えます', '')}`;
      cam.disabled = false;
      cam.classList.add('free');
      $('#shutterLabel').textContent = '投稿';
      ring.style.strokeDashoffset = SHUT_C;
    } else {
      chip.dataset.state = 'waiting';
      chip.textContent = '次のミッションを待っています';
      cam.disabled = false;
      cam.classList.add('free');
      $('#shutterLabel').textContent = '投稿';
      ring.style.strokeDashoffset = SHUT_C;
    }
    renderOmen();
    updatePostRemain();
    if (!$('#cameraModal').hidden && S.camMode === 'free') updateFtSummary();
  }

  /* ========== 気配メーター＆予想ゲーム ========== */
  const LEVELS = [
    { name: 'しずか', min: 0, lines: ['AIはお昼寝中…', 'まだ風はやんでいる', '今のうちに散歩でもどうぞ', 'カメラのレンズをふいておこう', 'AIは別のことを考えているらしい'] },
    { name: 'そわそわ', min: 25, lines: ['AIがあくびをした', '遠くで何かが動いた気がする', 'お題を考えはじめたらしい', 'AIがメモ帳をひらいた'] },
    { name: 'ざわざわ', min: 50, lines: ['空気がざわついてきた', 'AIがペンを持った', 'カメラの準備はいい？', '何色のお題が来るだろう'] },
    { name: 'どきどき', min: 70, lines: ['AIがお題を決めたっぽい', 'そろそろかもしれない', '画面から目を離さないで', '指をシャッターの近くに'] },
    { name: 'もうすぐ!?', min: 88, lines: ['もう来る…！', '3、2、1…いや、まだかも', 'AIが息を吸いこんだ', '空を見上げて待とう'] }
  ];
  const BET_LABEL = { 5: '5分以内', 15: '15分以内', 30: '30分以内', 99: 'もっと先' };
  const levelOf = (heat) => LEVELS.reduce((idx, l, k) => (heat >= l.min ? k : idx), 0);

  /** サーバーからの気配を受け取り、段階が上がったら知らせる（ゆらぎで何度も鳴らないよう、上がった時だけ） */
  function onHint(h) {
    const lv = levelOf(h.heat);
    S.hint = h;
    if (S.notifiedLevel < 0) { S.notifiedLevel = Math.max(2, lv); return; }
    if (lv > S.notifiedLevel && lv >= 3) {
      S.notifiedLevel = lv;
      toast(`気配が「${LEVELS[lv].name}」になった！`);
      if (navigator.vibrate) navigator.vibrate(lv === 4 ? [60, 40, 60] : 40);
      Speaker.speak(lv === 4 ? 'もうすぐ来るかも！' : 'ざわざわしてきた。カメラの準備をしておこう');
    }
  }

  function renderOmen() {
    const box = $('#omen'), h = S.hint, m = S.mission;
    if (!h || !S.user || (m && m.status === 'open')) { box.hidden = true; return; }
    box.hidden = false;
    const lv = levelOf(h.heat);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wobble = calm ? 0 : (Math.random() * 6 - 3) * (lv >= 3 ? 1.7 : 1);
    $('#omenFill').style.width = `${Math.max(3, Math.min(100, h.heat + wobble))}%`;
    box.dataset.level = String(lv);
    $('#omenLevel').textContent = LEVELS[lv].name;
    $('#omenRange').textContent = h.rangeText;
    if (lv !== S.omenShown || Date.now() - S.omenLineAt > 7000) {
      S.omenShown = lv;
      S.omenLineAt = Date.now();
      const el = $('#omenLine'), lines = LEVELS[lv].lines;
      el.textContent = lines[Math.floor(Math.random() * lines.length)];
      el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    }
    const bet = $('#omenBet');
    bet.textContent = S.bet ? `予想：${BET_LABEL[S.bet.bucket]}` : '予想する';
    bet.classList.toggle('placed', !!S.bet);
  }

  /** 予想の答え合わせ：予想した時刻から、実際に発令されるまでの分数で判定 */
  function resolveBet(openAt) {
    const b = S.bet;
    if (!b || !openAt || openAt <= b.madeAt) return null;
    const mins = (openAt - b.madeAt) / 60000;
    const actual = mins <= 5 ? '5' : mins <= 15 ? '15' : mins <= 30 ? '30' : '99';
    const hit = actual === String(b.bucket);
    const sc = S.score;
    sc.tries++;
    if (hit) { sc.hit++; sc.streak++; sc.best = Math.max(sc.best, sc.streak); } else sc.streak = 0;
    localStorage.setItem(KEY + '_score', JSON.stringify(sc));
    S.bet = null;
    localStorage.removeItem(KEY + '_bet');
    return { hit, mins: Math.max(0, Math.round(mins)), bucket: b.bucket, streak: sc.streak };
  }

  function showBetResult(r) {
    if (r.hit) {
      hitBurst(r.streak >= 2 ? `${r.streak}連続的中！` : '予想的中！');
      toast(`予想的中！ ${r.mins}分後にミッションが来ました`);
      Speaker.speak(r.streak >= 2 ? `${r.streak}連続的中！すごい！` : '予想的中！');
    } else {
      toast(`予想ははずれ。ミッションは${r.mins}分後に来ました`);
    }
  }

  function hitBurst(text) {
    const el = document.createElement('div');
    el.className = 'hitburst';
    el.textContent = text;
    document.body.appendChild(el);
    if (navigator.vibrate) navigator.vibrate([40, 30, 40, 30, 120]);
    setTimeout(() => el.remove(), 1900);
  }

  function renderPredict() {
    const h = S.hint, m = S.mission;
    const lv = h ? levelOf(h.heat) : 0;
    const closed = !!h && lv >= 4 && !(m && m.status === 'open');
    if (m && m.status === 'open') $('#predictNow').textContent = 'いまミッション中！ 予想すると、その次のミッションで答え合わせします。';
    else if (h) {
      const since = h.lastAt ? `前回のミッションから${Math.max(1, Math.round((now() - h.lastAt) / 60000))}分。` : '';
      $('#predictNow').textContent = `いまの気配は「${LEVELS[lv].name}」。${h.rangeText}。${since}`;
    } else $('#predictNow').textContent = '気配を読みこみ中…';

    $$('#betOptions .bet').forEach((b) => {
      b.setAttribute('aria-pressed', String(!!S.bet && String(S.bet.bucket) === b.dataset.bet));
      b.disabled = closed;
    });
    $('#betStatus').textContent = closed
      ? '「もうすぐ!?」の間は予想を受け付けません。次のミッションでどうぞ。'
      : S.bet
        ? `「${BET_LABEL[S.bet.bucket]}」で予想中（${fmtTime(S.bet.madeAt)}から数えます）。変えると、その時点から数え直します。`
        : '予想した時刻から、ミッションが来るまでの時間で答え合わせします。';
    $('#scHit').textContent = S.score.hit;
    $('#scTry').textContent = S.score.tries;
    $('#scStreak').textContent = S.score.streak;
    $('#scBest').textContent = S.score.best;
    $('#todayCount').textContent = h ? `${h.todayCount}回` : '';
    $('#recentList').innerHTML = h && h.recent.length
      ? h.recent.map((x) => `<li><span>${esc(x.text)}</span><small>${fmtTime(x.at)}</small></li>`).join('')
      : '<li class="muted">今日はまだミッションが来ていません</li>';
  }

  function placeBet(bucket) {
    S.bet = { bucket: String(bucket), madeAt: now() };
    localStorage.setItem(KEY + '_bet', JSON.stringify(S.bet));
    toast(`「${BET_LABEL[bucket]}」で予想しました`);
    renderPredict();
    renderOmen();
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

  /** ミッション中で未投稿ならミッション投稿、それ以外はじゆう投稿 */
  async function openCamera() {
    const m = S.mission;
    if (!S.pos) return toast('現在地を取得中です。位置情報をオンにしてください', 'error');
    setCamMode(m && m.status === 'open' && !m.posted ? 'mission' : 'free');
    $('#camComment').value = '';
    openSheet('cameraModal');
    startStream();
  }

  function setCamMode(mode) {
    S.camMode = mode;
    const free = mode === 'free';
    $('#cameraModal').classList.toggle('free-mode', free);
    $('#camMission').textContent = free ? 'じゆう投稿：出す時間は自分で決められます' : S.mission.text;
    $('#camLeft').hidden = free;
    $('#freeTiming').hidden = !free;
    if (free) renderFreeTiming();
  }

  const delayLabel = (v) => (v === 0 ? 'すぐ' : v < 60 ? `${v}分後` : `${v / 60}時間後`);
  const durLabel = (v) => (v < 60 ? `${v}分` : `${v / 60}時間`);

  function renderFreeTiming() {
    const F = CFG.FREE;
    $('#delayChips').innerHTML = F.delays.map((v) => `<button type="button" class="chip" data-delay="${v}" aria-pressed="${v === S.freeDelay}">${delayLabel(v)}</button>`).join('');
    $('#durChips').innerHTML = F.durations.map((v) => `<button type="button" class="chip" data-dur="${v}" aria-pressed="${v === S.freeDur}">${durLabel(v)}</button>`).join('');
    updateFtSummary();
  }

  function updateFtSummary() {
    const at = now() + S.freeDelay * 60000;
    $('#ftSummary').textContent = `${S.freeDelay === 0 ? '投稿してすぐ' : fmtWhen(at) + 'に'}地図へ現れて、${fmtWhen(at + S.freeDur * 60000)}に消えます`;
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
    const free = S.camMode === 'free';
    if (!free && (!m || m.status !== 'open')) {
      setCamMode('free');
      return toast('ミッションの撮影時間が終わりました。じゆう投稿として、出す時間を決めて投稿できます');
    }
    if (!S.pos) return toast('現在地がわかりません。位置情報をオンにしてください', 'error');
    const btn = $('#camSend');
    busy(btn, true, '送信中…');
    try {
      const base = { image: S.shot, lat: S.pos.lat, lng: S.pos.lng, comment: $('#camComment').value.trim() };
      const r = await API.call('uploadPhoto', free
        ? Object.assign(base, { missionId: 'free', delayMin: S.freeDelay, durationMin: S.freeDur })
        : Object.assign(base, { missionId: m.missionId }), { timeout: 90000 });
      if (!free) m.posted = true;
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
      <p class="mission-tag">${p.free ? 'じゆう投稿' : `ミッション「${esc(p.missionText)}」`}${esc(far)}</p>
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

  /* ========== まぼろし新聞 ========== */
  function onLatestArticle(a) {
    const seen = Number(localStorage.getItem(KEY + '_seenEdition') || 0);
    $('#paperBtn').classList.toggle('has-new', a.edition > seen);
    if (S.lastArticleEd && a.edition > S.lastArticleEd) {
      toast(`号外！ 第${a.edition}号「${a.headline}」`);
      if (navigator.vibrate) navigator.vibrate(30);
    }
    S.lastArticleEd = a.edition;
  }

  async function openPaper() {
    $('#paperBack').hidden = true;
    $('#paperBody').innerHTML = '<p class="paper-empty">刷り上がりを待っています…</p>';
    openSheet('paperSheet');
    try {
      const r = await API.call('listArticles', { offset: 0, limit: 20 });
      S.paper = { items: r.items, total: r.total };
      if (r.items[0]) {
        localStorage.setItem(KEY + '_seenEdition', String(r.items[0].edition));
        $('#paperBtn').classList.remove('has-new');
      }
      renderPaperIndex();
    } catch (err) { $('#paperBody').innerHTML = `<p class="paper-empty">${esc(err.message)}</p>`; }
  }

  function renderPaperIndex() {
    const { items, total } = S.paper;
    const mast = `<header class="masthead"><div class="masthead-title">まぼろし新聞</div>
      <div class="masthead-sub"><span>縮刷版　全${total}号</span><span>${fmtDateJa(now())}</span></div></header>`;
    if (!items.length) {
      $('#paperBody').innerHTML = mast + '<p class="paper-empty">まだ一号も刷られていません。<br>ミッションが終わると、AI記者が記事にします。</p>';
      return;
    }
    $('#paperBody').innerHTML = mast + `<ul class="clips">${items.map((a) => `
      <li><button type="button" class="clip ${a.style === 'magazine' ? 'mag' : ''}" data-aid="${esc(a.articleId)}">
        <span class="clip-no">第${a.edition}号</span>
        <span class="clip-head">${esc(a.headline)}</span>
        <span class="clip-sub">${esc(a.subhead)}</span>
        <span class="clip-meta"><span class="tag ${a.style === 'magazine' ? 'mag' : ''}">${a.style === 'magazine' ? '月刊まぼろし' : '号外'}</span>${esc(fmtDateJa(a.openAt))} ${esc(fmtTime(a.openAt))}／お題「${esc(a.missionText)}」／参加${a.participants}人</span>
      </button></li>`).join('')}</ul>
      ${items.length < total ? '<button type="button" class="btn paper-more" data-more>もっと前の号を読む</button>' : ''}`;
  }

  async function loadMorePaper(btn) {
    busy(btn, true, '読み込み中…');
    try {
      const r = await API.call('listArticles', { offset: S.paper.items.length, limit: 20 });
      S.paper.items = S.paper.items.concat(r.items);
      S.paper.total = r.total;
      renderPaperIndex();
    } catch (err) { toast(err.message, 'error'); busy(btn, false); }
  }

  async function openArticle(id) {
    $('#paperBody').innerHTML = '<p class="paper-empty">記事を広げています…</p>';
    $('#paperBack').hidden = false;
    try {
      const r = await API.call('getArticle', { articleId: id });
      S.article = r.article;
      $('#paperBody').innerHTML = r.article.style === 'magazine' ? magazineHtml(r.article) : newspaperHtml(r.article);
      $('#paperBody').scrollTop = 0;
    } catch (err) { $('#paperBody').innerHTML = `<p class="paper-empty">${esc(err.message)}</p>`; }
  }

  const paras = (t) => String(t || '').split(/\n+/).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('');

  function newspaperHtml(a) {
    const st = a.stats || {};
    const n = st.participants || 0;
    return `<article class="np">
      <header class="np-mast">
        <div class="np-title">まぼろし新聞</div>
        <div class="np-meta">第${a.edition}号<br>${esc(fmtDateJa(a.openAt))} ${esc(fmtTime(a.openAt))}発令<br>お題「${esc(a.missionText)}」</div>
      </header>
      <span class="np-gogai">号外</span>
      <div class="np-main">
        <h1 class="np-head">${esc(a.headline)}</h1>
        <div class="np-col">
          <p class="np-sub">${esc(a.subhead)}</p>
          <figure class="np-photo">
            <div class="halftone"></div><span class="stamp">消滅済み</span>
            <figcaption>写真はすでに消えました。見られたのは、その${st.displayMin || ''}分間に地図を開いていた人だけ。</figcaption>
          </figure>
          <p class="np-lead">${esc(a.lead)}</p>
          <div class="np-body">${paras(a.body)}</div>
        </div>
      </div>
      <aside class="np-stats"><h3>本日の数字</h3>
        <dl><div><dt>参加</dt><dd>${n}</dd></div><div><dt>コメント</dt><dd>${st.comments || 0}</dd></div><div><dt>いいね</dt><dd>${st.likes || 0}</dd></div>
        ${st.top ? `<p class="top">最多いいね：${esc(st.top.nickname)}さん（${st.top.likes}）${st.top.comment ? `「${esc(st.top.comment)}」` : ''}</p>` : ''}</dl>
      </aside>
      <section class="np-column"><h3>${esc(a.columnTitle || 'AIの独り言')}</h3><p>${esc(a.column)}</p></section>
      <button type="button" class="btn sm read-btn" data-speak>見出しを読み上げる</button>
    </article>`;
  }

  function magazineHtml(a) {
    const st = a.stats || {};
    return `<article class="mg">
      <div class="mg-cover">
        <div class="mg-logo">月刊まぼろし</div>
        <div class="mg-vol">第${a.edition}号　${esc(fmtDateJa(a.openAt))}</div>
        <h1 class="mg-head">${esc(a.headline)}</h1>
        <ul class="mg-catches">${(a.catches || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        <div class="mg-badge"><span>消えた写真<b>${st.participants || 0}</b>枚</span></div>
      </div>
      <div class="mg-inner">
        <p class="mg-sub">${esc(a.subhead)}</p>
        <p class="mg-lead">${esc(a.lead)}</p>
        <p class="muted small">特集：お題「${esc(a.missionText)}」／コメント${st.comments || 0}件・いいね${st.likes || 0}${st.top ? `／最多いいねは${esc(st.top.nickname)}さん` : ''}</p>
        <div class="mg-body">${paras(a.body)}</div>
        <section class="mg-after"><h3>${esc(a.columnTitle || '編集後記')}</h3><p>${esc(a.column)}</p></section>
        <button type="button" class="btn sm read-btn" data-speak>見出しを読み上げる</button>
      </div>
    </article>`;
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
    { art: '🌡️', title: '気配を読んで、予想しよう', text: '気配メーターが「しずか」から「もうすぐ!?」まで上がっていきます。タップして「何分後に来るか」を予想し、連続的中をねらおう。' },
    { art: '📷', title: '撮れるのはミッション中だけ', text: '下の丸いボタンで撮影します。ひとことを添えて投稿すると、撮った場所に写真のピンが立ちます。' },
    { art: '⏳', title: 'みんなの写真がいっせいに出て、消える', text: 'ミッションが終わると全員の写真が同時に地図へ。ピンのまわりの赤い輪がなくなると消えます。' },
    { art: '🧭', title: '近く・遠く・少し前を探検', text: '「表示条件」で、近くだけ・遠くだけ・少し前の足あとを切り替えられます。' },
    { art: '🕰️', title: 'じゆう投稿もできる', text: 'ミッションがない時も、丸いボタンから写真を出せます。「何分後に出すか」「どれくらい出しておくか」を自分で決めて、時間差のサプライズにしよう。' },
    { art: '📰', title: 'まぼろし新聞', text: 'ミッションが終わると、AI記者が新聞や雑誌の記事にします。写真は消えても、記事は残ります。右上の新聞ボタンから読めます。' },
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
      else openCamera();
    };
    $('#paperBtn').onclick = openPaper;
    $('#paperBack').onclick = renderPaperIndex.bind(null);
    $('#paperBack').addEventListener('click', () => { $('#paperBack').hidden = true; });
    $('#paperBody').addEventListener('click', (e) => {
      const a = e.target.closest('[data-aid]');
      if (a) return openArticle(a.dataset.aid);
      const more = e.target.closest('[data-more]');
      if (more) return loadMorePaper(more);
      if (e.target.closest('[data-speak]') && S.article) {
        if (!S.settings.sound) setSound(true, true);
        Speaker.unlock();
        Speaker.speak(`まぼろし新聞、第${S.article.edition}号。${S.article.headline}。${S.article.lead}`);
      }
    });
    $('#camPickFile').onchange = onFile;
    $('#freeTiming').addEventListener('click', (e) => {
      const d = e.target.closest('[data-delay]'), u = e.target.closest('[data-dur]');
      if (!d && !u) return;
      if (d) S.freeDelay = Number(d.dataset.delay);
      if (u) S.freeDur = Number(u.dataset.dur);
      localStorage.setItem(KEY + '_free', JSON.stringify({ delay: S.freeDelay, dur: S.freeDur }));
      renderFreeTiming();
    });
    $('#omen').onclick = () => { renderPredict(); openSheet('predictSheet'); };
    $('#betOptions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-bet]');
      if (b && !b.disabled) placeBet(b.dataset.bet);
    });
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
