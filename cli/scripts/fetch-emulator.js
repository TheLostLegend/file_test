'use strict';
// Скачивает файлы EmulatorJS (ядра snes9x и mGBA) в cli/vendor/emulatorjs,
// чтобы дальше всё работало без интернета.
const fs = require('fs');
const https = require('https');
const path = require('path');

const BASE = 'https://cdn.emulatorjs.org/stable/data/';
const DEST = path.join(__dirname, '..', 'vendor', 'emulatorjs');

const FILES = [
  'loader.js',
  'emulator.min.js',
  'emulator.min.css',
  'cores/snes9x-wasm.data',
  'cores/snes9x-legacy-wasm.data',
  'cores/mgba-wasm.data',
  'cores/mgba-legacy-wasm.data',
  'compression/extract7z.js',
  'compression/extractzip.js',
  'compression/libunrar.js',
];

function download(url, out, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).href, out, redirects - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} для ${url}`));
        }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const tmp = out + '.part';
        const ws = fs.createWriteStream(tmp);
        res.pipe(ws);
        ws.on('finish', () => {
          ws.close(() => {
            fs.renameSync(tmp, out);
            resolve();
          });
        });
        ws.on('error', reject);
      })
      .on('error', reject);
  });
}

function missing() {
  return FILES.filter((f) => !fs.existsSync(path.join(DEST, f)));
}

async function ensure(log = () => {}) {
  const todo = missing();
  if (!todo.length) return true;
  log(`Загрузка файлов эмулятора (${todo.length})...`);
  for (const f of todo) {
    log('  ' + f);
    await download(BASE + f, path.join(DEST, f));
  }
  log('Готово.');
  return true;
}

module.exports = { ensure, missing, DEST };

if (require.main === module) {
  ensure(console.log).catch((e) => {
    // не ломаем npm install, если нет сети — докачается при первом запуске
    console.warn('Не удалось скачать эмулятор сейчас: ' + e.message);
    console.warn('Файлы будут загружены при первом запуске rwv2 run.');
  });
}
