/**
 * まぼろしフォト 設定ファイル
 * デプロイ先や初期値はここだけ書き換えれば変更できます。
 *
 * ※ Gemini APIキーはここに書かないでください。
 *   GitHub Pages上のJSは誰でも読めるため、キーはGASのスクリプトプロパティ GEMINI_API_KEY に設定します。
 */
window.APP_CONFIG = {
  APP_NAME: 'まぼろしフォト',
  VERSION: 'v1.2.0',

  // GASウェブアプリのURL（デプロイ後に貼り替え）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzFZ4kwCPUHJNy5NceV70XHM6p6JYBC4PsKTfl2Cz7tOQu0QiRYoEgM3o_KWM0qhwh9fA/exec',

  // ブラウザ保存用のキー（他アプリと重ならない名前）
  STORAGE_KEY: 'maboroshi_photo',

  // 地図（Leaflet + OpenStreetMap）
  MAP: {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    defaultCenter: [35.681236, 139.767125],
    defaultZoom: 15
  },

  // 表示条件の初期値
  DEFAULTS: {
    timeMode: 'live',      // live = いま公開中 / history = 少し前の足あと
    historyMin: 60,        // 足あとをさかのぼる分数
    distanceMode: 'all',   // all / near（以内）/ far（以上）
    nearM: 500,            // 近接表示の距離（m）
    farM: 5000,            // 遠隔表示の距離（m）
    share: true,           // 自分の現在地を共有する
    sound: false           // 読み上げ
  },

  // サーバー確認の間隔（秒）
  POLL: { missionSec: 30, mapSec: 45, locationSec: 60 },

  // 音声入力：話し始めを待つ時間・言葉の間として許す無音・最大録音時間（ミリ秒）
  VOICE: { lang: 'ja-JP', startWaitMs: 8000, silenceMs: 3000, maxSessionMs: 90000 },

  // 読み上げ：Gemini TTSを使い、失敗時はブラウザの読み上げに切り替え
  TTS: { useGemini: true, fallbackWebSpeech: true, rate: 1.05 },

  // じゆう投稿：表示までの時間・表示する時間の選択肢（分）
  FREE: {
    delays: [0, 5, 15, 30, 60, 180],
    durations: [10, 30, 60, 180, 720, 1440],
    defaultDelay: 0,
    defaultDuration: 60
  },

  // 投稿写真の縮小（長辺px・JPEG画質）
  IMAGE: { maxSize: 1280, quality: 0.82 },

  // Google Earth Studioで書き出した演出動画（無ければ自動で非表示）
  EARTH: {
    authVideo: 'assets/earth/auth.mp4',
    missionVideo: 'assets/earth/mission.mp4'
  }
};
