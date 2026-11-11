#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

const K = require('../lib/keys');
const C = require('../lib/config');
const Rom = require('../lib/rom');
const { configCommand, applyCaptured } = require('../lib/commands');
const Fetch = require('../scripts/fetch-emulator');
const pkg = require('../package.json');

const HELP = `rwv2 ${pkg.version} — консольный запуск приложений

ЗАПУСК
  rwv2 run <rom> [опции]     открыть в окне 
  rwv2 <rom>                 то же самое
    --scale <0.5-8>             масштаб кадра (GBA по умолч. x2, SNES x1.5)
    --size <Ш>x<В>              точный размер окна, напр. 480x320
    --pos <X>,<Y>               позиция окна на экране
    --volume <0-100>            громкость
    --top                       окно поверх остальных
    --core snes|gba             указать систему вручную (для нестандартных расширений)
    -d, --detach                вернуть консоль сразу, окно живёт отдельно

  Форматы: .snes .sfc .smc .swc .fig (SNES) и .gba .agb (GBA)

УПРАВЛЕНИЕ (разовые команды, сохраняются в конфиг)
  rwv2 keys                  показать раскладку
  rwv2 keys reset            сбросить на стандартную
  rwv2 bind <кнопка> <клав>  назначить клавишу:   rwv2 bind a space
  rwv2 bind <кнопка>         назначить следующую нажатую клавишу
  rwv2 bind a=z b=x start=enter    несколько сразу
  rwv2 unbind <кнопка>       снять клавишу
  rwv2 swap <кнопка> <кнопка>      поменять местами
  rwv2 scale <n>             масштаб окна по умолчанию
  rwv2 volume <0-100>        громкость по умолчанию

  Кнопки: ${K.BUTTONS.join(' ')}
  Клавиши: буквы, цифры, up down left right, space, enter, tab, shift, ctrl, alt,
           f1-f12, num0-num9, , . / ; ' [ ] \\ - = (код KeyboardEvent тоже подходит).
  Если проложение уже запущено в другой консоли — новая раскладка применится сразу.

КОНСОЛЬ ВНУТРИ ЗАПУЩЕННОГО ПРИЛОЖЕНИЯ (приглашение rwv2>)
  keys, bind, unbind, swap      как выше
  pause | resume | reset        пауза / продолжить / перезапуск
  volume <n>                    громкость
  scale <n> | size <Ш> <В>      размер окна
  move <x> <y> | center         положение окна
  top [on|off]                  поверх всех окон
  info                          размер и позиция окна
  quit                          закрыть

ОКНО
  Тащите окно мышью за любую точку. Размер — за край или правый нижний угол.
  Горячие клавиши: Ctrl+Q выход, Ctrl+P пауза, Ctrl+R сброс,
                   Ctrl+ +/- масштаб, Ctrl+T поверх окон.

Конфиг: ${C.file()}
`;

// ---------- консоль Windows: UTF-8 ----------
let restoreConsole = () => {};
(function setupConsole() {
  if (process.platform !== 'win32' || !process.stdout.isTTY) return;
  try {
    const out = spawnSync('cmd.exe', ['/d', '/c', 'chcp'], { encoding: 'utf8' }).stdout || '';
    const m = /(\d+)\s*$/.exec(out.trim());
    const prev = m && m[1];
    if (prev && prev !== '65001') {
      spawnSync('cmd.exe', ['/d', '/c', 'chcp 65001>nul'], { stdio: 'ignore' });
      restoreConsole = () => {
        try {
          spawnSync('cmd.exe', ['/d', '/c', `chcp ${prev}>nul`], { stdio: 'ignore' });
        } catch {
          /* ignore */
        }
        restoreConsole = () => {};
      };
      process.on('exit', () => restoreConsole());
    }
  } catch {
    /* ignore */
  }
})();

const out = (s) => process.stdout.write(s + '\n');
const die = (s, code = 1) => {
  process.stderr.write(s + '\n');
  process.exit(code);
};

// ---------- разбор аргументов ----------
const VALUE_OPTS = new Set(['scale', 'size', 'pos', 'volume', 'core']);
function parseArgs(argv) {
  const pos = [];
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      if (eq > 0) o[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const k = a.slice(2);
        o[k] = VALUE_OPTS.has(k) ? argv[++i] : true;
      }
    } else if (a === '-d') o.detach = true;
    else if (a === '-s') o.scale = argv[++i];
    else if (a === '-h') o.help = true;
    else if (a === '-v') o.version = true;
    else pos.push(a);
  }
  return { pos, o };
}

function num(s) {
  const n = Number(s);
  return s !== undefined && s !== '' && Number.isFinite(n) ? n : NaN;
}

// ---------- ловим нажатие клавиши прямо в консоли ----------
function captureRawKey() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(null);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const done = (v) => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(v);
    };
    const onKey = (str, key) => {
      key = key || {};
      if ((key.ctrl && key.name === 'c') || key.name === 'escape') return done(null);
      const code = K.parseKey(key.name) || K.parseKey(str);
      done(code || 'unknown');
    };
    process.stdin.on('keypress', onKey);
  });
}

// ---------- разовые команды управления ----------
async function oneShot(name, args) {
  const res = configCommand(name, args);
  res.lines.forEach(out);
  if (res.capture) {
    out(`Нажмите клавишу для ${res.capture.toUpperCase()}...  (Esc — отмена)`);
    const code = await captureRawKey();
    if (code === null) return die('Отменено.', 1);
    if (code === 'unknown') return die('ОШИБКА  клавиша не распознана (переключите раскладку на EN или укажите имя: bind a z)');
    applyCaptured(res.capture, code).forEach(out);
  }
  process.exit(res.error ? 1 : 0);
}

// ---------- запуск ----------
async function run(romArg, o) {
  if (!romArg) return die('Укажите файл:  rwv2 run <rom>');
  const rom = path.resolve(process.cwd(), romArg);
  if (!fs.existsSync(rom) || !fs.statSync(rom).isFile()) return die(`ОШИБКА  файл не найден: ${rom}`);

  const core = o.core ? String(o.core).toLowerCase() : Rom.detectCore(rom);
  if (core !== 'snes' && core !== 'gba') {
    return die('ОШИБКА  не удалось определить систему. Поддерживаются .snes .sfc .smc .gba (или --core snes|gba)');
  }

  const opts = { rom, core, top: !!o.top };
  if (o.scale !== undefined) {
    const s = num(o.scale);
    if (!(s >= 0.5 && s <= 8)) return die('ОШИБКА  --scale: число от 0.5 до 8');
    opts.scale = s;
  }
  if (o.size !== undefined) {
    const m = /^(\d+)\s*[x×,]\s*(\d+)$/i.exec(String(o.size));
    if (!m) return die('ОШИБКА  --size: формат 480x320');
    opts.size = { w: +m[1], h: +m[2] };
  }
  if (o.pos !== undefined) {
    const m = /^(-?\d+)\s*[,x]\s*(-?\d+)$/i.exec(String(o.pos));
    if (!m) return die('ОШИБКА  --pos: формат 100,50');
    opts.pos = { x: +m[1], y: +m[2] };
  }
  if (o.volume !== undefined) {
    const v = num(o.volume);
    if (!(v >= 0 && v <= 100)) return die('ОШИБКА  --volume: число от 0 до 100');
    opts.volume = v;
  }

  // файлы эмулятора (скачиваются один раз)
  try {
    await Fetch.ensure((s) => out(s));
  } catch (e) {
    return die(`ОШИБКА  не удалось скачать эмулятор: ${e.message}\nПроверьте интернет и повторите, либо выполните: npm run fetch (в папке cli)`);
  }

  let electronPath = process.env.rwv2_ELECTRON;
  if (!electronPath) {
    try {
      electronPath = require('electron');
    } catch {
      return die('ОШИБКА  не установлен Electron. Выполните в папке приложения:  npm install');
    }
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const mainJs = path.join(__dirname, '..', 'electron', 'main.js');
  const label = `${path.basename(rom)} [${core.toUpperCase()}]`;

  // --- без консоли: просто запустить окно и выйти ---
  if (o.detach) {
    const child = spawn(electronPath, [mainJs, '--opts=' + Buffer.from(JSON.stringify(opts)).toString('base64')], {
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.unref();
    out(`Запущено: ${label}`);
    return process.exit(0);
  }

  // --- с консолью: TCP-канал к окну + приглашение rwv2> ---
  let sock = null;
  let rl = null;
  let capturing = null;
  let closing = false;

  const say = (s) => {
    if (rl && process.stdout.isTTY) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    }
    out(s);
    if (rl && !closing) rl.prompt(true);
  };
  const send = (name, args) => {
    if (sock && !sock.destroyed) sock.write(JSON.stringify({ t: 'cmd', name, args }) + '\n');
  };

  const ctl = net.createServer((s) => {
    sock = s;
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        onMessage(m);
      }
    });
    s.on('error', () => {});
  });

  function onMessage(m) {
    switch (m.t) {
      case 'ready':
        startRepl();
        break;
      case 'started':
        break;
      case 'log':
        say(m.text);
        break;
      case 'captured': {
        if (capturing === m.button) capturing = null;
        applyCaptured(m.button, m.code).forEach(say);
        send('bindings', { bindings: C.load().bindings });
        break;
      }
      case 'closed':
        break;
    }
  }

  const port = await new Promise((res) => ctl.listen(0, '127.0.0.1', () => res(ctl.address().port)));
  opts.ctlPort = port;

  out(`Запуск: ${label} ...`);
  const child = spawn(electronPath, [mainJs, '--opts=' + Buffer.from(JSON.stringify(opts)).toString('base64')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });

  child.on('error', (e) => die('ОШИБКА  не удалось запустить окно: ' + e.message));
  child.on('exit', (code) => {
    closing = true;
    if (rl) rl.close();
    ctl.close();
    out('Окно закрыто.');
    restoreConsole();
    process.exit(code || 0);
  });

  function quit() {
    closing = true;
    send('quit');
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, 1500).unref();
  }
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);

  let replStarted = false;
  function startRepl() {
    if (replStarted || !process.stdin.isTTY) return;
    replStarted = true;
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'rwv2> ' });
    out("Введите help для списка команд, quit — закрыть.");
    rl.prompt();
    rl.on('line', (line) => {
      handle(line.trim());
      if (!closing) rl.prompt();
    });
    rl.on('SIGINT', quit);
    rl.on('close', () => {
      if (!closing) quit();
    });
  }

  function handle(line) {
    if (!line) return;
    const [cmd, ...args] = line.split(/\s+/);
    const c = cmd.toLowerCase();

    const cr = configCommand(c, args);
    if (cr.handled) {
      cr.lines.forEach(out);
      if (cr.capture) {
        capturing = cr.capture;
        send('capture', { button: cr.capture });
        out(`Нажмите клавишу для ${cr.capture.toUpperCase()} в окне (Esc — отмена)`);
      }
      if (cr.changed) send('bindings', { bindings: C.load().bindings });
      return;
    }

    switch (c) {
      case 'help':
      case '?':
        out(HELP);
        break;
      case 'pause':
      case 'resume':
      case 'reset':
      case 'info':
      case 'center':
        send(c);
        break;
      case 'quit':
      case 'exit':
      case 'q':
        quit();
        break;
      case 'clear':
      case 'cls':
        console.clear();
        break;
      case 'volume': {
        const v = num(args[0]);
        if (!(v >= 0 && v <= 100)) return out('Использование: volume <0-100>');
        C.update((cfg) => (cfg.volume = v));
        send('volume', { v });
        out(`OK  громкость ${v}%`);
        break;
      }
      case 'scale': {
        const s = num(args[0]);
        if (!(s >= 0.5 && s <= 8)) return out('Использование: scale <0.5-8>');
        send('scale', { s });
        break;
      }
      case 'size': {
        let w;
        let h;
        const m = /^(\d+)[x×](\d+)$/i.exec(args[0] || '');
        if (m) [w, h] = [+m[1], +m[2]];
        else [w, h] = [num(args[0]), num(args[1])];
        if (!(w >= 120 && h >= 80)) return out('Использование: size <Ш> <В>   (мин. 120x80)');
        send('size', { w, h });
        break;
      }
      case 'move': {
        const x = num(args[0]);
        const y = num(args[1]);
        if (isNaN(x) || isNaN(y)) return out('Использование: move <x> <y>');
        send('move', { x, y });
        break;
      }
      case 'top':
        send('top', { on: args[0] !== 'off' });
        break;
      default:
        out(`Неизвестная команда: ${cmd}   (help)`);
    }
  }
}

// ---------- точка входа ----------
(async function main() {
  const { pos, o } = parseArgs(process.argv.slice(2));
  const cmd = (pos[0] || '').toLowerCase();

  if (o.version) return out(pkg.version);
  if (!pos.length || cmd === 'help' || o.help) return out(HELP);

  switch (cmd) {
    case 'run':
    case 'play':
      return run(pos[1], o);
    case 'keys':
    case 'binds':
    case 'bind':
    case 'unbind':
    case 'swap':
      return oneShot(cmd, pos.slice(1));
    case 'scale': {
      const s = num(pos[1]);
      if (!(s >= 0.5 && s <= 8)) return die('Использование: rwv2 scale <0.5-8>');
      C.update((cfg) => {
        cfg.scale = s;
        cfg.window = {};
      });
      return out(`OK  масштаб окна по умолчанию: x${s}`);
    }
    case 'volume': {
      const v = num(pos[1]);
      if (!(v >= 0 && v <= 100)) return die('Использование: rwv2 volume <0-100>');
      C.update((cfg) => (cfg.volume = v));
      return out(`OK  громкость по умолчанию: ${v}%`);
    }
    case 'fetch':
      return Fetch.ensure(out).catch((e) => die('ОШИБКА  ' + e.message));
    case 'version':
      return out(pkg.version);
    default:
      // rwv2 game.gba
      if (Rom.detectCore(pos[0]) || fs.existsSync(pos[0])) return run(pos[0], o);
      return die(`Неизвестная команда: ${pos[0]}\nСправка: rwv2 help`);
  }
})().catch((e) => die('ОШИБКА  ' + (e && e.message ? e.message : e)));
