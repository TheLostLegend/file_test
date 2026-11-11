'use strict';
(async function () {
  const host = window.host;
  const cfg = await host.getConfig();

  const INDEX = { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, x: 9, l: 10, r: 11 };
  const ext = cfg.core === 'gba' ? 'gba' : 'sfc';
  const safe = cfg.gameName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'game';

  // ---- настройки EmulatorJS ----
  const buttons = {};
  [
    'playPause', 'play', 'pause', 'restart', 'mute', 'unmute', 'settings', 'fullscreen', 'enterFullscreen',
    'exitFullscreen', 'saveState', 'loadState', 'screenRecord', 'gamepad', 'cheat', 'volume', 'saveSavFiles',
    'loadSavFiles', 'quickSave', 'quickLoad', 'screenshot', 'cacheManager', 'exitEmulation', 'netplay',
    'diskButton', 'contextMenu',
  ].forEach((k) => (buttons[k] = false));

  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: cfg.core,
    EJS_gameUrl: '/rom',
    EJS_gameName: safe + '.' + ext,
    EJS_gameID: cfg.gameId,
    EJS_pathtodata: '/emu/',
    EJS_startOnLoaded: true,
    EJS_volume: cfg.volume / 100,
    EJS_Buttons: buttons,
    // Клавиатуру обрабатываем сами (см. ниже) — у EmulatorJS раскладка пустая
    EJS_defaultControls: { 0: {}, 1: {}, 2: {}, 3: {} },
    EJS_disableLocalStorage: true,
    EJS_disableAutoLang: false,
    EJS_language: 'en-US',
    EJS_threads: false,
    EJS_backgroundColor: '#000',
    EJS_AdUrl: '',
    EJS_onGameStart: () => {
      started = true;
      setVolume(volume);
      host.send({ t: 'started' });
    },
  });

  let started = false;
  let volume = cfg.volume;

  const emu = () => window.EJS_emulator;
  const gm = () => (emu() && emu().gameManager) || null;

  function setVolume(v) {
    volume = Math.max(0, Math.min(100, v));
    try {
      if (emu() && emu().setVolume) emu().setVolume(volume / 100);
    } catch (e) { /* ignore */ }
  }

  // ---- toast ----
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  // ---- клавиши ----
  let codeMap = new Map(); // code -> [index]
  const pressed = new Set(); // индексы кнопок, зажатых сейчас
  function setBindings(b) {
    releaseAll();
    codeMap = new Map();
    for (const [btn, code] of Object.entries(b || {})) {
      if (!code || !(btn in INDEX)) continue;
      if (!codeMap.has(code)) codeMap.set(code, []);
      codeMap.get(code).push(INDEX[btn]);
    }
  }
  setBindings(cfg.bindings);

  function simulate(idx, v) {
    const g = gm();
    if (!g || !started) return;
    try {
      g.simulateInput(0, idx, v);
    } catch (e) { /* ignore */ }
  }
  function releaseAll() {
    for (const idx of pressed) simulate(idx, 0);
    pressed.clear();
  }

  let captureBtn = null;
  let paused = false;

  function togglePause() {
    try {
      if (!emu()) return;
      if (paused) emu().play(true);
      else emu().pause(true);
      paused = !paused;
      toast(paused ? 'Пауза' : 'Продолжаем');
    } catch (e) { /* ignore */ }
  }

  document.addEventListener(
    'keydown',
    (e) => {
      // режим «нажмите клавишу» (bind <кнопка> без клавиши)
      if (captureBtn) {
        e.preventDefault();
        const btn = captureBtn;
        captureBtn = null;
        if (e.code === 'Escape') toast('Отменено');
        else {
          host.send({ t: 'captured', button: btn, code: e.code });
          toast(btn.toUpperCase() + ' = ' + e.code.replace(/^Key|^Digit/, ''));
        }
        return;
      }
      // горячие клавиши окна
      if (e.ctrlKey && !e.altKey) {
        const k = e.code;
        if (k === 'KeyQ') return void host.send({ t: 'quit' });
        if (k === 'KeyP') return void (e.preventDefault(), togglePause());
        if (k === 'KeyR') return void (e.preventDefault(), toast('Перезапуск'), gm() && gm().restart());
        if (k === 'KeyT') return void (e.preventDefault(), host.send({ t: 'toggle-top' }));
        if (k === 'Equal' || k === 'NumpadAdd') return void (e.preventDefault(), host.send({ t: 'scale-step', d: 0.25 }));
        if (k === 'Minus' || k === 'NumpadSubtract') return void (e.preventDefault(), host.send({ t: 'scale-step', d: -0.25 }));
      }
      const idxs = codeMap.get(e.code);
      if (!idxs) return;
      e.preventDefault();
      if (e.repeat) return;
      idxs.forEach((i) => {
        pressed.add(i);
        simulate(i, 1);
      });
    },
    true
  );
  document.addEventListener(
    'keyup',
    (e) => {
      const idxs = codeMap.get(e.code);
      if (!idxs) return;
      e.preventDefault();
      idxs.forEach((i) => {
        pressed.delete(i);
        simulate(i, 0);
      });
    },
    true
  );
  window.addEventListener('blur', releaseAll);

  // ---- сообщения из консоли ----
  host.onMessage((m) => {
    switch (m.t) {
      case 'bindings':
        setBindings(m.bindings);
        toast('Управление обновлено');
        break;
      case 'volume':
        setVolume(m.v);
        break;
      case 'pause':
        if (!paused) togglePause();
        break;
      case 'resume':
        if (paused) togglePause();
        break;
      case 'reset':
        if (gm()) gm().restart();
        toast('Перезапуск');
        break;
      case 'capture':
        captureBtn = m.button;
        window.focus();
        toast('Нажмите клавишу для ' + m.button.toUpperCase());
        break;
      case 'toast':
        toast(m.text);
        break;
    }
  });

  // ---- изменение размера за угол ----
  const grip = document.getElementById('grip');
  let rs = null;
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('active');
    rs = { x: e.screenX, w: window.innerWidth };
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (rs) host.resizeTo(rs.w + (e.screenX - rs.x));
  });
  const endResize = (e) => {
    rs = null;
    grip.classList.remove('active');
    try { grip.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);

  // ---- загрузка эмулятора ----
  const s = document.createElement('script');
  s.src = '/emu/loader.js';
  document.body.appendChild(s);
})();
