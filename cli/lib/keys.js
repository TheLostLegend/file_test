'use strict';
// Кнопки консоли и клавиши. Клавиши хранятся как KeyboardEvent.code
// (KeyZ, ArrowUp, Space ...) — это не зависит от раскладки (RU/EN).

const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'];

// индексы кнопок libretro / EmulatorJS
const INDEX = { b: 0, y: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, x: 9, l: 10, r: 11 };

const DEFAULTS = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  a: 'KeyZ',
  b: 'KeyX',
  x: 'KeyA',
  y: 'KeyS',
  l: 'KeyQ',
  r: 'KeyE',
  start: 'Enter',
  select: 'KeyV',
};

const ALIAS = {}; // имя -> code
const CODES = {}; // code.toLowerCase() -> code

function add(code, ...names) {
  CODES[code.toLowerCase()] = code;
  for (const n of names) ALIAS[n.toLowerCase()] = code;
}

for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(97 + i);
  add('Key' + ch.toUpperCase(), ch);
}
for (let i = 0; i < 10; i++) {
  add('Digit' + i, String(i));
  add('Numpad' + i, 'num' + i, 'numpad' + i);
}
for (let i = 1; i <= 12; i++) add('F' + i, 'f' + i);

add('ArrowUp', 'up', 'arrowup');
add('ArrowDown', 'down', 'arrowdown');
add('ArrowLeft', 'left', 'arrowleft');
add('ArrowRight', 'right', 'arrowright');
add('Enter', 'enter', 'return');
add('Space', 'space', 'spacebar');
add('Tab', 'tab');
add('Backspace', 'backspace');
add('Escape', 'esc', 'escape');
add('ShiftLeft', 'shift', 'lshift');
add('ShiftRight', 'rshift');
add('ControlLeft', 'ctrl', 'control', 'lctrl');
add('ControlRight', 'rctrl');
add('AltLeft', 'alt', 'lalt');
add('AltRight', 'ralt');
add('Comma', ',', 'comma');
add('Period', '.', 'dot', 'period');
add('Slash', '/', 'slash');
add('Semicolon', ';', 'semicolon');
add('Quote', "'", 'quote');
add('BracketLeft', '[', 'bracketleft');
add('BracketRight', ']', 'bracketright');
add('Backslash', '\\', 'backslash');
add('Minus', '-', 'minus', 'dash');
add('Equal', '=', 'equal');
add('Backquote', '`', 'grave', 'backquote');
add('PageUp', 'pageup', 'pgup');
add('PageDown', 'pagedown', 'pgdn');
add('Home', 'home');
add('End', 'end');
add('Insert', 'insert', 'ins');
add('Delete', 'delete', 'del');
add('NumpadEnter', 'numenter', 'numpadenter');
add('NumpadAdd', 'numplus', 'numpadadd');
add('NumpadSubtract', 'numminus', 'numpadsubtract');

/** "z" | "space" | "ArrowUp" -> code | null */
function parseKey(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  return ALIAS[s] || CODES[s] || null;
}

function parseButton(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const alias = { lb: 'l', rb: 'r', l1: 'l', r1: 'r', sel: 'select', back: 'select' };
  const v = alias[s] || s;
  return BUTTONS.includes(v) ? v : null;
}

function label(code) {
  if (!code) return '-';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Arrow/.test(code)) return code.slice(5);
  return code;
}

module.exports = { BUTTONS, INDEX, DEFAULTS, parseKey, parseButton, label };
