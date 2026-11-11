import { useCallback, useEffect, useRef, useState } from "react";
import GameWindow, { WinRect } from "./components/GameWindow";
import {
  ACCEPT,
  Core,
  DEFAULT_SCALE,
  NATIVE,
  applyBindingsLive,
  buildSrcDoc,
  detectCore,
  hookEscape,
  pauseGame,
  resetGame,
  resumeGame,
  setGameVolume,
} from "./lib/emulator";
import {
  Bindings,
  DEFAULT_BINDINGS,
  PAD_BUTTONS,
  PadButton,
  keyName,
  loadBindings,
  parseButton,
  parseKey,
  saveBindings,
} from "./lib/keys";

type Kind = "in" | "out" | "ok" | "err" | "sys" | "dim";
interface Line {
  id: number;
  kind: Kind;
  text: string;
}
interface Rom {
  id: number;
  name: string;
  core: Core;
  url: string;
  size: number;
}
interface Game {
  rom: Rom;
  srcDoc: string;
  nonce: number;
}

const COMMANDS = [
  "help", "open", "load", "ls", "run", "stop", "quit", "pause", "resume", "reset", "volume",
  "bind", "unbind", "swap", "keys", "scale", "size", "move", "center", "clear", "about",
];

const BANNER = `   ____  _   _ _____ ____     ______ ____    _
  / ___|| \\ | | ____/ ___|   / / ___| __ )  / \\
  \\___ \\|  \\| |  _| \\___ \\  / / |  _|  _ \\ / _ \\
   ___) | |\\  | |___ ___) |/ /| |_| | |_) / ___ \\
  |____/|_| \\_|_____|____//_/  \\____|____/_/   \\_\\`;

const HELP = `Команды:
  open | load              выбрать ROM (.snes .sfc .smc .gba) или перетащите файлы в окно
  ls                       список загруженных игр
  run [№|имя]              запустить игру в маленьком окне без рамок
  stop                     закрыть игру
  pause | resume | reset   пауза / продолжить / перезапуск игры
  volume <0-100>           громкость

Управление (разовые команды, сохраняются в браузере):
  bind <кнопка> <клавиша>  назначить клавишу, напр.  bind a space
  bind <кнопка>            назначить следующую нажатую клавишу
  bind a=z b=x start=enter несколько назначений сразу
  unbind <кнопка>          снять клавишу
  swap <кнопка> <кнопка>   поменять местами
  keys [reset]             показать текущую раскладку / сбросить

Окно:
  scale <0.5-8>            масштаб кадра
  size <ш> <в>             точный размер в пикселях
  move <x> <y>             переместить окно   |   center — в центр
  (также: тянуть за верхний край, угол справа внизу — размер)

Прочее:  clear · about · help
Кнопки:  up down left right a b x y l r start select
Esc внутри игры — вернуть фокус в консоль. Tab — автодополнение.`;

function fmtSize(n: number) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

const coreLabel = (c: Core) => (c === "gba" ? "GBA " : "SNES");

export default function App() {
  const idRef = useRef(0);
  const [lines, setLines] = useState<Line[]>(() => [
    { id: -3, kind: "sys", text: BANNER },
    {
      id: -2,
      kind: "dim",
      text: "Консольный эмулятор SNES / GBA. Введите  help  для списка команд.\nНачните с  open  — выберите ROM, затем  run.",
    },
  ]);
  const [input, setInput] = useState("");
  const [roms, setRoms] = useState<Rom[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [rect, setRect] = useState<WinRect | null>(null);
  const [bindings, setBindings] = useState<Bindings>(loadBindings);
  const [dragging, setDragging] = useState(false);

  const romsRef = useRef<Rom[]>([]);
  const gameRef = useRef<Game | null>(null);
  const rectRef = useRef<WinRect | null>(null);
  const bindingsRef = useRef<Bindings>(bindings);
  const volumeRef = useRef(0.6);
  const nonceRef = useRef(0);
  const captureRef = useRef<PadButton | null>(null);
  const pendingRunRef = useRef(false);
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const print = useCallback((text: string, kind: Kind = "out") => {
    setLines((l) => [...l, { id: idRef.current++, kind, text }]);
  }, []);

  const updateRect = useCallback((r: WinRect | null) => {
    rectRef.current = r;
    setRect(r);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ---------- ROM ----------
  const addFiles = useCallback(
    (files: FileList | File[]): Rom[] => {
      const added: Rom[] = [];
      for (const f of Array.from(files)) {
        const core = detectCore(f.name);
        if (!core) {
          print(`✗ ${f.name}: неподдерживаемый формат (нужны .snes .sfc .smc .gba)`, "err");
          continue;
        }
        const old = romsRef.current.find((r) => r.name === f.name);
        if (old) URL.revokeObjectURL(old.url);
        const rom: Rom = {
          id: 0,
          name: f.name,
          core,
          url: URL.createObjectURL(f),
          size: f.size,
        };
        const list = romsRef.current.filter((r) => r.name !== f.name);
        list.push(rom);
        list.forEach((r, i) => (r.id = i + 1));
        romsRef.current = list;
        added.push(rom);
        print(`✓ загружено: ${f.name}  [${coreLabel(core).trim()}, ${fmtSize(f.size)}]`, "ok");
      }
      setRoms([...romsRef.current]);
      return added;
    },
    [print]
  );

  const launch = useCallback(
    (rom: Rom) => {
      const n = NATIVE[rom.core];
      const s = DEFAULT_SCALE[rom.core];
      const w = Math.round(n.w * s);
      const h = Math.round(n.h * s);
      const prev = rectRef.current;
      updateRect(
        prev
          ? {
              x: Math.min(prev.x, Math.max(0, window.innerWidth - w)),
              y: Math.min(prev.y, Math.max(0, window.innerHeight - h)),
              w,
              h,
            }
          : { x: Math.max(0, window.innerWidth - w - 24), y: 24, w, h }
      );
      const g: Game = {
        rom,
        nonce: ++nonceRef.current,
        srcDoc: buildSrcDoc({
          core: rom.core,
          url: rom.url,
          name: rom.name,
          bindings: bindingsRef.current,
          volume: volumeRef.current,
        }),
      };
      gameRef.current = g;
      setGame(g);
      print(`▶ запуск: ${rom.name} (${coreLabel(rom.core).trim()})  — Esc: вернуться в консоль`, "ok");
    },
    [print, updateRect]
  );

  const openPicker = useCallback((thenRun: boolean) => {
    pendingRunRef.current = thenRun;
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  }, []);

  // ---------- управление ----------
  const commit = useCallback(
    (nb: Bindings) => {
      bindingsRef.current = nb;
      setBindings(nb);
      saveBindings(nb);
      if (gameRef.current) {
        return applyBindingsLive(frameRef.current, nb);
      }
      return null;
    },
    []
  );

  const setBind = useCallback(
    (btn: PadButton, code: number) => {
      const nb = { ...bindingsRef.current };
      const freed = PAD_BUTTONS.filter((p) => p !== btn && nb[p] === code);
      freed.forEach((p) => (nb[p] = 0));
      nb[btn] = code;
      const live = commit(nb);
      let msg = `✓ ${btn.toUpperCase()} → ${keyName(code)}`;
      if (freed.length) msg += `   (клавиша снята с: ${freed.join(", ").toUpperCase()})`;
      if (live === true) msg += "   [применено сразу]";
      else if (gameRef.current) msg += "   [перезапустите игру: run]";
      print(msg, "ok");
    },
    [commit, print]
  );

  const showKeys = useCallback(() => {
    const b = bindingsRef.current;
    const row = (btn: PadButton) =>
      `${btn.padEnd(7)}→ ${(b[btn] ? keyName(b[btn]) : "—").padEnd(10)}`;
    const out = [
      `${row("up")}${row("a")}${row("start")}`,
      `${row("down")}${row("b")}${row("select")}`,
      `${row("left")}${row("x")}${row("l")}`,
      `${row("right")}${row("y")}${row("r")}`,
    ].join("\n");
    print(out, "out");
  }, [print]);

  // ---------- разбор команд ----------
  const exec = useCallback(
    (raw: string) => {
      const line = raw.trim();
      print(line, "in");
      if (!line) return;
      history.current.push(line);
      const [cmd, ...args] = line.split(/\s+/);
      const c = cmd.toLowerCase();

      const resolveRom = (q?: string): Rom | undefined => {
        const list = romsRef.current;
        if (!q) return list.length ? list[list.length - 1] : undefined;
        if (/^\d+$/.test(q)) return list.find((r) => r.id === parseInt(q, 10));
        const lq = q.trim().toLowerCase();
        return list.find((r) => r.name.toLowerCase() === lq) ?? list.find((r) => r.name.toLowerCase().includes(lq));
      };

      const win = rectRef.current;
      const needGame = () => {
        if (!gameRef.current || !win) {
          print("Игра не запущена. Используйте  run.", "err");
          return false;
        }
        return true;
      };
      const num = (s?: string) => (s !== undefined && s.trim() !== "" ? Number(s) : NaN);

      switch (c) {
        case "help":
        case "?":
        case "h":
          print(HELP);
          break;
        case "about":
          print(
            "SNES/GBA console runner (веб-адаптер). Ядра: snes9x и mGBA (EmulatorJS).\nОригинал — настоящее консольное приложение для cmd: см. папку cli/ (snesgba run game.gba).\nУправление хранится в localStorage, ROM-файлы не покидают ваш браузер."
          );
          break;
        case "clear":
        case "cls":
          setLines([]);
          break;
        case "open":
        case "load":
          print("Выберите ROM-файлы в диалоге…", "dim");
          openPicker(false);
          break;
        case "ls":
        case "roms":
          if (!romsRef.current.length) print("Список пуст. Загрузите игры командой  open.", "dim");
          else
            print(
              romsRef.current
                .map(
                  (r) =>
                    `${gameRef.current?.rom.id === r.id ? "▶" : " "} ${String(r.id).padStart(2)}  ${coreLabel(r.core)}  ${fmtSize(r.size).padStart(8)}  ${r.name}`
                )
                .join("\n")
            );
          break;
        case "run":
        case "play":
        case "start": {
          if (!romsRef.current.length) {
            print("Игр нет — открываю выбор файла…", "dim");
            openPicker(true);
            break;
          }
          const found = resolveRom(args.length ? args.join(" ") : undefined);
          if (!found) print(`✗ игра не найдена: ${args.join(" ")}  (см. ls)`, "err");
          else launch(found);
          break;
        }
        case "stop":
        case "quit":
        case "exit":
        case "close":
          if (!gameRef.current) print("Игра не запущена.", "err");
          else {
            gameRef.current = null;
            frameRef.current = null;
            setGame(null);
            print("■ игра закрыта", "ok");
          }
          break;
        case "pause":
          if (needGame()) print(pauseGame(frameRef.current) ? "⏸ пауза" : "✗ эмулятор ещё не готов", "ok");
          break;
        case "resume":
          if (needGame()) print(resumeGame(frameRef.current) ? "▶ продолжаем" : "✗ эмулятор ещё не готов", "ok");
          break;
        case "reset":
          if (needGame()) print(resetGame(frameRef.current) ? "↺ перезапуск" : "✗ эмулятор ещё не готов", "ok");
          break;
        case "volume":
        case "vol": {
          const v = num(args[0]);
          if (isNaN(v) || v < 0 || v > 100) {
            print(`Громкость: ${Math.round(volumeRef.current * 100)}%.  Использование: volume <0-100>`, "dim");
            break;
          }
          volumeRef.current = v / 100;
          const live = gameRef.current ? setGameVolume(frameRef.current, v / 100) : false;
          print(`✓ громкость ${v}%${live ? "" : gameRef.current ? " (со следующего запуска)" : ""}`, "ok");
          break;
        }
        case "bind": {
          if (!args.length) {
            showKeys();
            print("Использование: bind <кнопка> [клавиша]   или   bind a=z b=x", "dim");
            break;
          }
          if (args.every((a) => a.includes("=") && a.length > 2)) {
            for (const a of args) {
              const idx = a.indexOf("=");
              const btn = parseButton(a.slice(0, idx));
              const code = parseKey(a.slice(idx + 1));
              if (!btn) print(`✗ неизвестная кнопка: ${a.slice(0, idx)}`, "err");
              else if (code === null) print(`✗ неизвестная клавиша: ${a.slice(idx + 1)}`, "err");
              else setBind(btn, code);
            }
            break;
          }
          const btn = parseButton(args[0]);
          if (!btn) {
            print(`✗ неизвестная кнопка: ${args[0]}\nДоступны: ${PAD_BUTTONS.join(" ")}`, "err");
            break;
          }
          if (args.length === 1) {
            captureRef.current = btn;
            print(`Нажмите клавишу для ${btn.toUpperCase()}…  (Esc — отмена)`, "sys");
            break;
          }
          const code = parseKey(args.slice(1).join(" "));
          if (code === null) print(`✗ неизвестная клавиша: ${args.slice(1).join(" ")}`, "err");
          else setBind(btn, code);
          break;
        }
        case "unbind": {
          const btn = args[0] ? parseButton(args[0]) : null;
          if (!btn) {
            print("Использование: unbind <кнопка>", "err");
            break;
          }
          const nb = { ...bindingsRef.current, [btn]: 0 };
          const live = commit(nb);
          print(`✓ ${btn.toUpperCase()} → —${live === true ? "   [применено сразу]" : ""}`, "ok");
          break;
        }
        case "swap": {
          const a = args[0] ? parseButton(args[0]) : null;
          const b = args[1] ? parseButton(args[1]) : null;
          if (!a || !b) {
            print("Использование: swap <кнопка> <кнопка>", "err");
            break;
          }
          const nb = { ...bindingsRef.current };
          [nb[a], nb[b]] = [nb[b], nb[a]];
          const live = commit(nb);
          print(
            `✓ ${a.toUpperCase()} ⇄ ${b.toUpperCase()}   (${a}=${nb[a] ? keyName(nb[a]) : "—"}, ${b}=${nb[b] ? keyName(nb[b]) : "—"})${live === true ? "   [применено сразу]" : ""}`,
            "ok"
          );
          break;
        }
        case "keys":
        case "binds":
          if (args[0] === "reset") {
            const live = commit({ ...DEFAULT_BINDINGS });
            print(`✓ раскладка сброшена${live === true ? "   [применено сразу]" : ""}`, "ok");
          }
          showKeys();
          break;
        case "scale": {
          if (!needGame() || !win) break;
          const s = num(args[0]);
          if (isNaN(s) || s < 0.5 || s > 8) {
            print("Использование: scale <0.5-8>", "err");
            break;
          }
          const n = NATIVE[gameRef.current!.rom.core];
          const w = Math.round(n.w * s);
          const h = Math.round(n.h * s);
          updateRect({ ...win, w, h });
          print(`✓ окно ${w}×${h}`, "ok");
          break;
        }
        case "size": {
          if (!needGame() || !win) break;
          const w = num(args[0]);
          const h = num(args[1]);
          if (isNaN(w) || isNaN(h) || w < 120 || h < 80) {
            print("Использование: size <ширина> <высота>  (мин. 120×80)", "err");
            break;
          }
          updateRect({ ...win, w: Math.round(w), h: Math.round(h) });
          print(`✓ окно ${Math.round(w)}×${Math.round(h)}`, "ok");
          break;
        }
        case "move": {
          if (!needGame() || !win) break;
          const x = num(args[0]);
          const y = num(args[1]);
          if (isNaN(x) || isNaN(y)) {
            print("Использование: move <x> <y>", "err");
            break;
          }
          updateRect({ ...win, x: Math.round(x), y: Math.round(y) });
          print(`✓ позиция ${Math.round(x)}, ${Math.round(y)}`, "ok");
          break;
        }
        case "center": {
          if (!needGame() || !win) break;
          updateRect({
            ...win,
            x: Math.max(0, Math.round((window.innerWidth - win.w) / 2)),
            y: Math.max(0, Math.round((window.innerHeight - win.h) / 2)),
          });
          print("✓ окно по центру", "ok");
          break;
        }
        default: {
          const near = COMMANDS.find((k) => k.startsWith(c));
          print(`✗ неизвестная команда: ${cmd}${near ? `  — возможно, ${near}?` : ""}   (help)`, "err");
        }
      }
    },
    [commit, launch, openPicker, print, setBind, showKeys, updateRect]
  );

  // ---------- ввод ----------
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const cap = captureRef.current;
    if (cap) {
      e.preventDefault();
      captureRef.current = null;
      if (e.key === "Escape") print("отменено", "dim");
      else setBind(cap, e.keyCode);
      return;
    }
    if (e.key === "Enter") {
      const v = input;
      setInput("");
      histPos.current = -1;
      exec(v);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = history.current;
      if (!h.length) return;
      histPos.current = histPos.current < 0 ? h.length - 1 : Math.max(0, histPos.current - 1);
      setInput(h[histPos.current]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = history.current;
      if (histPos.current < 0) return;
      histPos.current++;
      if (histPos.current >= h.length) {
        histPos.current = -1;
        setInput("");
      } else setInput(h[histPos.current]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const t = input.trim().toLowerCase();
      if (t && !t.includes(" ")) {
        const m = COMMANDS.filter((k) => k.startsWith(t));
        if (m.length === 1) setInput(m[0] + " ");
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    const added = addFiles(files);
    if (pendingRunRef.current && added.length) launch(added[0]);
    pendingRunRef.current = false;
    inputRef.current?.focus();
  };

  const onGameLoad = (frame: HTMLIFrameElement) => {
    hookEscape(frame, () => {
      window.focus();
      inputRef.current?.focus();
    });
    frame.focus();
    try {
      frame.contentWindow?.focus();
    } catch {
      /* ignore */
    }
  };

  const running = game;

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#0b0e11] font-mono text-[13px] text-zinc-300"
      onClick={() => {
        if (!window.getSelection()?.toString()) inputRef.current?.focus();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {/* статус-строка */}
      <div className="flex items-center gap-3 border-b border-white/5 bg-[#10151a] px-4 py-2 text-[11px] text-zinc-500">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
          <i className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <i className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        </span>
        <span className="text-zinc-400">snesgba — console</span>
        <span className="ml-auto flex items-center gap-3">
          <span>ROM: {roms.length}</span>
          {running ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {running.rom.name}
            </span>
          ) : (
            <span>idle</span>
          )}
        </span>
      </div>

      {/* вывод */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {lines.map((l) => (
          <div
            key={l.id}
            className={
              "whitespace-pre-wrap break-words leading-relaxed " +
              (l.kind === "in"
                ? "text-zinc-100 before:mr-2 before:text-emerald-400 before:content-['❯']"
                : l.kind === "ok"
                  ? "text-emerald-400"
                  : l.kind === "err"
                    ? "text-rose-400"
                    : l.kind === "sys"
                      ? "text-cyan-300"
                      : l.kind === "dim"
                        ? "text-zinc-500"
                        : "text-zinc-300")
            }
          >
            {l.text}
          </div>
        ))}

        <div className="mt-1 flex items-center">
          <span className="mr-2 text-emerald-400">❯</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="flex-1 bg-transparent text-zinc-100 caret-emerald-400 outline-none"
            aria-label="command"
          />
        </div>
        <div ref={endRef} />
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-emerald-400/60 bg-emerald-400/5 text-lg text-emerald-300">
          Отпустите ROM-файлы (.snes / .sfc / .smc / .gba)
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {game && rect && (
        <GameWindow
          key={game.nonce}
          rect={rect}
          srcDoc={game.srcDoc}
          onRect={updateRect}
          onLoad={onGameLoad}
          frameRef={frameRef}
        />
      )}
    </div>
  );
}
