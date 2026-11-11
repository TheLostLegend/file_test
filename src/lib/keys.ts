// Кнопки консоли и клавиши клавиатуры

export type PadButton =
  | "up"
  | "down"
  | "left"
  | "right"
  | "a"
  | "b"
  | "x"
  | "y"
  | "l"
  | "r"
  | "start"
  | "select";

export const PAD_BUTTONS: PadButton[] = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "x",
  "y",
  "l",
  "r",
  "start",
  "select",
];

// индексы кнопок в libretro / EmulatorJS
export const BUTTON_INDEX: Record<PadButton, number> = {
  b: 0,
  y: 1,
  select: 2,
  start: 3,
  up: 4,
  down: 5,
  left: 6,
  right: 7,
  a: 8,
  x: 9,
  l: 10,
  r: 11,
};

export const GAMEPAD_LABEL: Record<PadButton, string> = {
  b: "BUTTON_2",
  y: "BUTTON_4",
  select: "SELECT",
  start: "START",
  up: "DPAD_UP",
  down: "DPAD_DOWN",
  left: "DPAD_LEFT",
  right: "DPAD_RIGHT",
  a: "BUTTON_1",
  x: "BUTTON_3",
  l: "LEFT_TOP_SHOULDER",
  r: "RIGHT_TOP_SHOULDER",
};

export type Bindings = Record<PadButton, number>; // кнопка -> keyCode

export const DEFAULT_BINDINGS: Bindings = {
  up: 38,
  down: 40,
  left: 37,
  right: 39,
  a: 90, // Z
  b: 88, // X
  x: 65, // A
  y: 83, // S
  l: 81, // Q
  r: 69, // E
  start: 13, // Enter
  select: 86, // V
};

// имя клавиши -> keyCode
const NAMED: Record<string, number> = {
  backspace: 8,
  tab: 9,
  enter: 13,
  return: 13,
  shift: 16,
  ctrl: 17,
  control: 17,
  alt: 18,
  space: 32,
  spacebar: 32,
  pageup: 33,
  pgup: 33,
  pagedown: 34,
  pgdn: 34,
  end: 35,
  home: 36,
  left: 37,
  arrowleft: 37,
  "←": 37,
  up: 38,
  arrowup: 38,
  "↑": 38,
  right: 39,
  arrowright: 39,
  "→": 39,
  down: 40,
  arrowdown: 40,
  "↓": 40,
  insert: 45,
  ins: 45,
  delete: 46,
  del: 46,
  semicolon: 186,
  ";": 186,
  equal: 187,
  "=": 187,
  comma: 188,
  ",": 188,
  minus: 189,
  dash: 189,
  "-": 189,
  period: 190,
  dot: 190,
  ".": 190,
  slash: 191,
  "/": 191,
  backquote: 192,
  grave: 192,
  "`": 192,
  bracketleft: 219,
  "[": 219,
  backslash: 220,
  "\\": 220,
  bracketright: 221,
  "]": 221,
  quote: 222,
  "'": 222,
};

for (let i = 0; i < 26; i++) NAMED[String.fromCharCode(97 + i)] = 65 + i;
for (let i = 0; i < 10; i++) {
  NAMED[String(i)] = 48 + i;
  NAMED["num" + i] = 96 + i;
  NAMED["numpad" + i] = 96 + i;
}
for (let i = 1; i <= 12; i++) NAMED["f" + i] = 111 + i;

const DISPLAY: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  16: "Shift",
  17: "Ctrl",
  18: "Alt",
  32: "Space",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "←",
  38: "↑",
  39: "→",
  40: "↓",
  45: "Insert",
  46: "Delete",
  186: ";",
  187: "=",
  188: ",",
  189: "-",
  190: ".",
  191: "/",
  192: "`",
  219: "[",
  220: "\\",
  221: "]",
  222: "'",
};

export const ESCAPE_CODE = 27;

export function keyName(code: number): string {
  if (DISPLAY[code]) return DISPLAY[code];
  if (code >= 65 && code <= 90) return String.fromCharCode(code);
  if (code >= 48 && code <= 57) return String.fromCharCode(code);
  if (code >= 96 && code <= 105) return "Num" + (code - 96);
  if (code >= 112 && code <= 123) return "F" + (code - 111);
  if (code === ESCAPE_CODE) return "Esc";
  return "#" + code;
}

export function parseKey(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "esc" || s === "escape") return null; // Esc зарезервирован для возврата в консоль
  if (NAMED[s] !== undefined) return NAMED[s];
  const m = /^#(\d{1,3})$/.exec(s);
  if (m) return parseInt(m[1], 10);
  return null;
}

export function parseButton(raw: string): PadButton | null {
  const s = raw.trim().toLowerCase();
  const alias: Record<string, PadButton> = {
    lb: "l",
    rb: "r",
    l1: "l",
    r1: "r",
    sel: "select",
    back: "select",
    dpad_up: "up",
    dpad_down: "down",
    dpad_left: "left",
    dpad_right: "right",
  };
  if (alias[s]) return alias[s];
  return (PAD_BUTTONS as string[]).includes(s) ? (s as PadButton) : null;
}

const STORAGE_KEY = "snesgba.bindings.v1";

export function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_BINDINGS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_BINDINGS };
}

export function saveBindings(b: Bindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

export function buildControls(b: Bindings) {
  const p0: Record<number, { value: number; value2: string }> = {};
  for (const btn of PAD_BUTTONS) {
    p0[BUTTON_INDEX[btn]] = { value: b[btn], value2: GAMEPAD_LABEL[btn] };
  }
  return { 0: p0, 1: {}, 2: {}, 3: {} };
}
