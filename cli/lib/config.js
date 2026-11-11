'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS, BUTTONS } = require('./keys');

function dir() {
  if (process.env.rwv2_HOME) return process.env.rwv2_HOME;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'rwv2');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'rwv2');
}

function file() {
  return path.join(dir(), 'config.json');
}

function defaults() {
  return {
    bindings: { ...DEFAULTS },
    volume: 60,
    scale: null, // общий масштаб по умолчанию (null — по ядру)
    window: {}, // последние позиция/масштаб: { gba: {x,y,scale}, snes: {...} }
  };
}

function load() {
  const d = defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (raw && typeof raw === 'object') {
      if (raw.bindings && typeof raw.bindings === 'object') {
        for (const b of BUTTONS) if (b in raw.bindings) d.bindings[b] = raw.bindings[b] || '';
      }
      if (typeof raw.volume === 'number') d.volume = raw.volume;
      if (typeof raw.scale === 'number') d.scale = raw.scale;
      if (raw.window && typeof raw.window === 'object') d.window = raw.window;
    }
  } catch {
    /* нет файла или он повреждён — берём значения по умолчанию */
  }
  return d;
}

function save(cfg) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, file());
}

/** прочитать -> изменить -> записать */
function update(fn) {
  const cfg = load();
  fn(cfg);
  save(cfg);
  return cfg;
}

module.exports = { dir, file, load, save, update, defaults };
