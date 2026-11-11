'use strict';
const path = require('path');

const SNES_EXT = ['.snes', '.sfc', '.smc', '.swc', '.fig'];
const GBA_EXT = ['.gba', '.agb'];

// Размер «родного» кадра и масштаб по умолчанию (маленькое окно)
const NATIVE = { gba: { w: 240, h: 160 }, snes: { w: 256, h: 224 } };
const DEFAULT_SCALE = { gba: 2, snes: 1.5 };

function detectCore(file) {
  const ext = path.extname(file).toLowerCase();
  if (SNES_EXT.includes(ext)) return 'snes';
  if (GBA_EXT.includes(ext)) return 'gba';
  return null;
}

module.exports = { detectCore, NATIVE, DEFAULT_SCALE, SNES_EXT, GBA_EXT };
