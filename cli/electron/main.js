'use strict';
// Процесс Electron: безрамочное окно с эмулятором.
// Запускается из консольного лаунчера (bin/snesgba.js), с ним общается по TCP (localhost).
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const fs = require('fs');
const net = require('net');
const path = require('path');

const Config = require('../lib/config');
const Rom = require('../lib/rom');
const Server = require('../lib/server');

// ---- параметры от лаунчера (base64 JSON в argv[2]) ----
let opts = {};
try {
  const raw = process.argv.find((a) => a.startsWith('--opts='));
  opts = JSON.parse(Buffer.from(raw.slice(7), 'base64').toString('utf8'));
} catch {
  console.error('snesgba: не переданы параметры запуска');
  app.exit(2);
}

app.setPath('userData', path.join(Config.dir(), 'electron'));
// Свой идентификатор приложения: иконка в панели задач Windows не сливается с Electron
app.setAppUserModelId('snesgba');

// ИКОНКА ОКНА: положите файл в cli/assets/ (icon.ico для Windows, icon.png для Linux/macOS)
function findIcon() {
  const dir = path.join(__dirname, '..', 'assets');
  const names = process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png', 'icon.ico'];
  for (const n of names) {
    const f = path.join(dir, n);
    if (fs.existsSync(f)) return f;
  }
  return undefined; // файла нет — остаётся стандартная иконка Electron
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---- связь с консолью ----
let ctl = null;
function send(msg) {
  if (ctl && !ctl.destroyed) ctl.write(JSON.stringify(msg) + '\n');
}
function log(text, kind) {
  if (ctl) send({ t: 'log', text, kind });
  else console.log(text);
}

let win = null;
let server = null;
let ratio = 1;
let native = Rom.NATIVE[opts.core] || Rom.NATIVE.gba;
let saved = false;

function toRenderer(msg) {
  if (win && !win.isDestroyed()) win.webContents.send('msg', msg);
}

function setSize(w, h) {
  w = Math.max(120, Math.round(w));
  h = Math.max(80, Math.round(h));
  ratio = w / h;
  win.setContentSize(w, h);
  win.setAspectRatio(ratio);
}

function setScale(s) {
  setSize(native.w * s, native.h * s);
}

function saveWindow() {
  if (saved || !win || win.isDestroyed()) return;
  saved = true;
  try {
    const [x, y] = win.getPosition();
    const [w] = win.getContentSize();
    Config.update((cfg) => {
      cfg.window = cfg.window || {};
      cfg.window[opts.core] = { x, y, scale: +(w / native.w).toFixed(3) };
    });
  } catch {
    /* ignore */
  }
}

function onVisibleDisplay(x, y) {
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return x >= b.x - 20 && y >= b.y - 20 && x < b.x + b.width - 40 && y < b.y + b.height - 40;
  });
}

function handleCommand(m) {
  if (!win || win.isDestroyed()) return;
  const a = m.args || {};
  switch (m.name) {
    case 'pause':
    case 'resume':
    case 'reset':
      toRenderer({ t: m.name });
      log(m.name === 'pause' ? 'Пауза' : m.name === 'resume' ? 'Продолжаем' : 'Перезапуск игры');
      break;
    case 'volume':
      toRenderer({ t: 'volume', v: a.v });
      break;
    case 'bindings':
      toRenderer({ t: 'bindings', bindings: a.bindings });
      break;
    case 'capture':
      toRenderer({ t: 'capture', button: a.button });
      break;
    case 'scale':
      setScale(a.s);
      log(`Окно ${win.getContentSize().join('x')}`);
      break;
    case 'size':
      setSize(a.w, a.h);
      log(`Окно ${win.getContentSize().join('x')}`);
      break;
    case 'move':
      win.setPosition(Math.round(a.x), Math.round(a.y));
      log(`Позиция ${win.getPosition().join(', ')}`);
      break;
    case 'center':
      win.center();
      log('Окно по центру');
      break;
    case 'top':
      win.setAlwaysOnTop(!!a.on);
      log(a.on ? 'Поверх всех окон: включено' : 'Поверх всех окон: выключено');
      break;
    case 'info': {
      const [w, h] = win.getContentSize();
      const [x, y] = win.getPosition();
      log(`Окно ${w}x${h} (x${(w / native.w).toFixed(2)}), позиция ${x}, ${y}`);
      break;
    }
    case 'quit':
      win.close();
      break;
  }
}

function connectCtl() {
  if (!opts.ctlPort) return;
  ctl = net.connect(opts.ctlPort, '127.0.0.1');
  let buf = '';
  ctl.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.t === 'cmd') handleCommand(m);
      } catch {
        /* ignore */
      }
    }
  });
  ctl.on('close', () => app.quit()); // консоль закрыта — закрываем и окно
  ctl.on('error', () => app.quit());
}

function hash(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000003;
  return h + 1;
}

async function start() {
  Menu.setApplicationMenu(null);
  connectCtl();

  const emuDir = path.join(__dirname, '..', 'vendor', 'emulatorjs');
  const rendererDir = path.join(__dirname, 'renderer');
  server = await Server.start({ emuDir, rendererDir, romPath: opts.rom });

  const cfg = Config.load();
  const savedWin = (cfg.window || {})[opts.core];
  let scale = opts.scale || (savedWin && savedWin.scale) || cfg.scale || Rom.DEFAULT_SCALE[opts.core] || 2;
  let w = native.w * scale;
  let h = native.h * scale;
  if (opts.size) {
    w = opts.size.w;
    h = opts.size.h;
  }
  w = Math.max(120, Math.round(w));
  h = Math.max(80, Math.round(h));
  ratio = w / h;

  const winOpts = {
    width: w,
    height: h,
    useContentSize: true,
    frame: false, // без рамок
    resizable: true, // масштабируется мышью (края/угол)
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#000000',
    title: path.basename(opts.rom),
    icon: findIcon(), // <-- иконка окна / панели задач / Alt+Tab
    hasShadow: true,
    alwaysOnTop: !!opts.top,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  };
  const pos = opts.pos || (!opts.size && !opts.scale && savedWin && Number.isFinite(savedWin.x) ? savedWin : null);
  if (pos && onVisibleDisplay(pos.x, pos.y)) {
    winOpts.x = Math.round(pos.x);
    winOpts.y = Math.round(pos.y);
  }

  win = new BrowserWindow(winOpts);
  win.setAspectRatio(ratio);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('close', saveWindow);
  win.on('closed', () => {
    send({ t: 'closed' });
    if (server) server.close();
    app.quit();
  });

  // конфиг для страницы плеера
  ipcMain.handle('config', () => {
    const c = Config.load();
    return {
      core: opts.core,
      gameName: path.basename(opts.rom),
      gameId: hash(opts.rom),
      bindings: c.bindings,
      volume: opts.volume != null ? opts.volume : c.volume,
    };
  });

  ipcMain.on('msg', (_e, m) => {
    if (!m) return;
    switch (m.t) {
      case 'started':
        send({ t: 'started' });
        log('Игра запущена. Мышь: тащить окно — перемещение, край/угол — размер. Ctrl+Q — выход.');
        break;
      case 'captured':
        send({ t: 'captured', button: m.button, code: m.code });
        break;
      case 'quit':
        win.close();
        break;
      case 'scale-step': {
        const [cw] = win.getContentSize();
        const cur = cw / native.w;
        setScale(Math.min(8, Math.max(0.5, Math.round((cur + m.d) * 4) / 4)));
        break;
      }
      case 'toggle-top':
        win.setAlwaysOnTop(!win.isAlwaysOnTop());
        toRenderer({ t: 'toast', text: win.isAlwaysOnTop() ? 'Поверх окон: ВКЛ' : 'Поверх окон: ВЫКЛ' });
        break;
    }
  });

  ipcMain.on('resize-to', (_e, newW) => {
    if (!win || win.isDestroyed()) return;
    const nw = Math.max(120, Math.round(newW));
    win.setContentSize(nw, Math.round(nw / ratio));
  });

  // разовые команды из другой консоли (snesgba bind ...) подхватываются на лету
  let timer = null;
  try {
    fs.mkdirSync(Config.dir(), { recursive: true });
    fs.watch(Config.dir(), (_ev, name) => {
      if (name !== 'config.json') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const c = Config.load();
        toRenderer({ t: 'bindings', bindings: c.bindings });
        toRenderer({ t: 'volume', v: c.volume });
      }, 150);
    });
  } catch {
    /* ignore */
  }

  win.loadURL(`http://127.0.0.1:${server.port}/`);
  send({ t: 'ready' });
}

app.on('window-all-closed', () => app.quit());
app.whenReady().then(start).catch((e) => {
  log('ОШИБКА: ' + (e && e.message ? e.message : e), 'err');
  app.exit(1);
});
