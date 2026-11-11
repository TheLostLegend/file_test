'use strict';
// Команды настройки управления. Одни и те же и для разового запуска
// (rwv2 bind a z), и для консоли внутри запущенного приложения.
const K = require('./keys');
const C = require('./config');

function keysTable(b) {
  const cell = (btn) => (btn.padEnd(7) + '= ' + K.label(b[btn])).padEnd(20);
  return [
    cell('up') + cell('a') + cell('start'),
    cell('down') + cell('b') + cell('select'),
    cell('left') + cell('x') + cell('l'),
    cell('right') + cell('y') + cell('r'),
  ]
    .map((s) => '  ' + s.trimEnd())
    .join('\n');
}

function setBinding(cfg, btn, code, lines) {
  const freed = K.BUTTONS.filter((p) => p !== btn && cfg.bindings[p] === code);
  freed.forEach((p) => (cfg.bindings[p] = ''));
  cfg.bindings[btn] = code;
  let msg = `OK  ${btn.toUpperCase()} = ${K.label(code)}`;
  if (freed.length) msg += `   (клавиша снята с: ${freed.join(', ').toUpperCase()})`;
  lines.push(msg);
}

/**
 * @returns {{handled:boolean, lines:string[], changed:boolean, capture?:string, error?:boolean}}
 */
function configCommand(name, args) {
  const lines = [];
  const res = { handled: true, lines, changed: false };
  const fail = (m) => {
    lines.push(m);
    res.error = true;
    return res;
  };

  switch (name) {
    case 'keys':
    case 'binds': {
      if (args[0] === 'reset') {
        C.update((cfg) => (cfg.bindings = { ...K.DEFAULTS }));
        res.changed = true;
        lines.push('OK  раскладка сброшена');
      }
      lines.push(keysTable(C.load().bindings));
      return res;
    }

    case 'bind': {
      if (!args.length) {
        lines.push(keysTable(C.load().bindings));
        lines.push('Использование: bind <кнопка> [клавиша]  |  bind a=z b=x start=enter');
        return res;
      }
      // bind a=z b=x ...
      if (args.every((a) => a.indexOf('=') > 0 && a.indexOf('=') < a.length - 1)) {
        const pairs = [];
        for (const a of args) {
          const i = a.indexOf('=');
          const btn = K.parseButton(a.slice(0, i));
          const code = K.parseKey(a.slice(i + 1));
          if (!btn) return fail(`ОШИБКА  неизвестная кнопка: ${a.slice(0, i)}  (${K.BUTTONS.join(' ')})`);
          if (!code) return fail(`ОШИБКА  неизвестная клавиша: ${a.slice(i + 1)}`);
          pairs.push([btn, code]);
        }
        C.update((cfg) => pairs.forEach(([b, c]) => setBinding(cfg, b, c, lines)));
        res.changed = true;
        return res;
      }
      const btn = K.parseButton(args[0]);
      if (!btn) return fail(`ОШИБКА  неизвестная кнопка: ${args[0]}\nДоступны: ${K.BUTTONS.join(' ')}`);
      if (args.length === 1) {
        res.capture = btn; // ждём нажатие клавиши
        return res;
      }
      const keyArg = args.slice(1).join(' ');
      const code = K.parseKey(keyArg);
      if (!code) return fail(`ОШИБКА  неизвестная клавиша: ${keyArg}\nПримеры: z  space  enter  up  lshift  f5  KeyZ`);
      C.update((cfg) => setBinding(cfg, btn, code, lines));
      res.changed = true;
      return res;
    }

    case 'unbind': {
      const btn = K.parseButton(args[0]);
      if (!btn) return fail('Использование: unbind <кнопка>');
      C.update((cfg) => (cfg.bindings[btn] = ''));
      res.changed = true;
      lines.push(`OK  ${btn.toUpperCase()} = -`);
      return res;
    }

    case 'swap': {
      const a = K.parseButton(args[0]);
      const b = K.parseButton(args[1]);
      if (!a || !b) return fail('Использование: swap <кнопка> <кнопка>');
      const cfg = C.update((c) => {
        const t = c.bindings[a];
        c.bindings[a] = c.bindings[b];
        c.bindings[b] = t;
      });
      res.changed = true;
      lines.push(`OK  ${a.toUpperCase()} = ${K.label(cfg.bindings[a])},  ${b.toUpperCase()} = ${K.label(cfg.bindings[b])}`);
      return res;
    }
  }
  res.handled = false;
  return res;
}

/** применить пойманную клавишу (после «bind a» без клавиши) */
function applyCaptured(btn, code) {
  const lines = [];
  C.update((cfg) => setBinding(cfg, btn, code, lines));
  return lines;
}

module.exports = { configCommand, applyCaptured, keysTable };
