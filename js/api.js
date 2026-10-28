/* まぼろしフォト api.js — GAS通信とログイン状態の保持 */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;
  const KEY = CFG.STORAGE_KEY + '_session';

  const Session = {
    get() {
      try { return JSON.parse(localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || 'null'); }
      catch { return null; }
    },
    // remember=true: ブラウザを閉じても保持（localStorage） / false: タブを閉じたら終了（sessionStorage）
    set(data, remember) {
      this.clear();
      (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(data));
    },
    update(patch) {
      const s = this.get();
      if (!s) return;
      const store = localStorage.getItem(KEY) ? localStorage : sessionStorage;
      store.setItem(KEY, JSON.stringify(Object.assign({}, s, patch)));
    },
    clear() { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); }
  };

  async function call(action, data = {}, opt = {}) {
    if (!CFG.GAS_URL || CFG.GAS_URL.includes('XXXX')) throw new Error('config.js の GAS_URL を設定してください');
    const s = Session.get();
    const body = Object.assign({ action }, data);
    if (s && s.token) body.token = s.token;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opt.timeout || 30000);
    let res;
    try {
      // text/plain で送るとCORSのプリフライトが発生しない
      res = await fetch(CFG.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError'
        ? '通信がタイムアウトしました。電波の良い場所でもう一度お試しください'
        : '通信できませんでした。ネットワークを確認してください');
    } finally {
      clearTimeout(timer);
    }

    let j;
    try { j = await res.json(); }
    catch { throw new Error('サーバーの応答を読み取れませんでした（GASのデプロイ設定を確認してください）'); }

    if (j.error === 'AUTH') {
      Session.clear();
      window.dispatchEvent(new Event('auth-expired'));
    }
    if (!j.ok) throw new Error(j.message || 'エラーが発生しました');
    return j;
  }

  window.Session = Session;
  window.API = { call };
})();
