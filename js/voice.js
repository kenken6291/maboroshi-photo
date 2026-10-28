/* まぼろしフォト voice.js — 音声入力（言葉の間を許容）と読み上げ（メタ発言を除去） */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);

  /**
   * 読み上げ用テキストから「承知しました」「以下を読み上げます」などの前置き・メタ指示・
   * 話者ラベル・ト書き・Markdown記号を取り除き、発話本文だけを返す（GAS側にも同じ処理あり）
   */
  function cleanSpeech(text) {
    const lead = /^(はい|ええ|もちろん)?[、,。!！\s]*(承知(いた)?しました|かしこまりました|了解(いた)?しました|了解です|わかりました|分かりました|では[、,]?(読み上げ|お伝え)します|読み上げます|お伝えします)[。、,!！\s]*/;
    const intro = /^(以下|次)の?.{0,20}?(を|で)?.{0,10}?(読み上げ|お伝え|話し)(ます|します)?[:：。、\s]*/;
    const lines = [];
    String(text || '')
      .replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, '').replace(/[*_#`~>|]/g, '')
      .split(/\r?\n/).forEach(function (raw) {
        let l = raw.trim();
        for (let i = 0; i < 3; i++) { const before = l; l = l.replace(lead, '').replace(intro, '').trim(); if (l === before) break; }
        if (!l || /[:：]$/.test(l)) return;
        if (/(で|と|を)?読み上げ(てください|てね|ます|る|ください)[。.!！]?$/.test(l)) return;
        l = l.replace(/^[^\s：:「」。、！!]{1,12}[：:]\s*/, '');
        l = l.replace(/[（(\[［【][^）)\]］】]{0,15}[）)\]］】]/g, '');
        l = l.replace(/^[「『"“]+/, '').replace(/[」』"”]+$/, '').trim();
        if (l) lines.push(/[。！？!?]$/.test(l) ? l : l + '。');
      });
    return lines.join('').replace(/。{2,}/g, '。').replace(/\s+/g, ' ').trim();
  }

  /**
   * 音声入力：ブラウザが無音で認識セッションを切っても自動で再開し、
   * 「最後に声が入ってから silenceMs」経つまでは聞き取りを続ける。
   */
  class VoiceInput {
    constructor(opt = {}) {
      this.lang = opt.lang || 'ja-JP';
      this.startWaitMs = opt.startWaitMs || 8000;
      this.silenceMs = opt.silenceMs || 3000;
      this.maxSessionMs = opt.maxSessionMs || 90000;
      this.onUpdate = opt.onUpdate || (() => {});
      this.onEnd = opt.onEnd || (() => {});
      this.onError = opt.onError || (() => {});
      this.active = false;
    }
    static supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

    start() {
      if (!VoiceInput.supported()) throw new Error('このブラウザは音声入力に対応していません（Chrome・Edge・Safariの最新版をお使いください）');
      this.active = true;
      this.committed = '';
      this.sessionText = '';
      this.interim = '';
      this._spawn();
      this._arm(this.startWaitMs);
      this.maxTimer = setTimeout(() => this.stop(), this.maxSessionMs);
    }

    _spawn() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const r = new SR();
      r.lang = this.lang;
      r.interimResults = true;
      r.maxAlternatives = 1;
      // Androidのcontinuousは結果が重複するため、1発話ごとに自動再開する方式にする
      r.continuous = !IS_ANDROID;

      r.onresult = (e) => {
        let finals = '', interim = '';
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finals += t; else interim += t;
        }
        this.sessionText = finals;
        this.interim = interim;
        this.onUpdate(this.text(true));
        this._arm(this.silenceMs); // 声が入るたびに無音タイマーをリセット
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.onError('マイクの使用が許可されていません。ブラウザの設定で許可してください');
          this.stop();
        }
        // no-speech / network / aborted は onend で自動再開する
      };
      r.onend = () => {
        this.committed += this.sessionText;
        this.sessionText = '';
        this.interim = '';
        if (this.active) {
          setTimeout(() => { if (this.active) { try { this._spawn(); } catch (_) { /* 再開失敗は無視 */ } } }, 120);
        }
      };
      this.rec = r;
      r.start();
    }

    text(withInterim) {
      return (this.committed + this.sessionText + (withInterim ? this.interim : '')).trim();
    }

    _arm(ms) {
      clearTimeout(this.silTimer);
      this.silTimer = setTimeout(() => this.stop(), ms);
    }

    stop() {
      if (!this.active) return;
      this.active = false;
      clearTimeout(this.silTimer);
      clearTimeout(this.maxTimer);
      const r = this.rec;
      this.rec = null;
      if (r) { r.onend = null; r.onresult = null; try { r.stop(); } catch (_) { /* noop */ } }
      this.onEnd(this.text(true));
    }
  }

  /* ---------- 読み上げ ---------- */
  function pcmToWav(b64, rate) {
    const bin = atob(b64);
    const len = bin.length;
    const buf = new ArrayBuffer(44 + len);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len, true);
    const u8 = new Uint8Array(buf, 44);
    for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: 'audio/wav' });
  }

  function audioBlob(b64, mime) {
    if (/L16|pcm/i.test(mime || '')) {
      const m = /rate=(\d+)/.exec(mime);
      return pcmToWav(b64, m ? Number(m[1]) : 24000);
    }
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime || 'audio/wav' });
  }

  function playUrl(audio, url) {
    return new Promise((resolve) => {
      audio.onended = audio.onerror = () => resolve();
      audio.src = url;
      audio.play().catch(() => resolve());
    });
  }

  function webSpeak(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = CFG.TTS.rate || 1;
      const voice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.startsWith('ja'));
      if (voice) u.voice = voice;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  }

  const Speaker = {
    enabled: false,
    audio: new Audio(),
    cache: new Map(),
    queue: Promise.resolve(),
    unlocked: false,

    // iOSなどで自動再生を許可させるため、ユーザー操作のタイミングで無音を一度鳴らす
    unlock() {
      if (this.unlocked) return;
      this.unlocked = true;
      const silent = pcmToWav(btoa('\0'.repeat(4800)), 24000);
      this.audio.src = URL.createObjectURL(silent);
      this.audio.play().catch(() => {});
      if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    },

    speak(text) {
      const t = cleanSpeech(text);
      if (!this.enabled || !t) return Promise.resolve();
      this.queue = this.queue.then(() => this._speak(t)).catch(() => {});
      return this.queue;
    },

    async _speak(t) {
      if (CFG.TTS.useGemini) {
        try {
          let url = this.cache.get(t);
          if (!url) {
            const r = await window.API.call('tts', { text: t }, { timeout: 40000 });
            url = URL.createObjectURL(audioBlob(r.audio, r.mimeType));
            this.cache.set(t, url);
          }
          await playUrl(this.audio, url);
          return;
        } catch (e) {
          console.warn('Gemini TTS失敗、ブラウザ読み上げに切り替えます', e);
        }
      }
      if (CFG.TTS.fallbackWebSpeech) await webSpeak(t);
    }
  };

  window.Voice = { cleanSpeech, VoiceInput, Speaker };
})();
