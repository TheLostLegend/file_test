import { Bindings, BUTTON_INDEX, PAD_BUTTONS, buildControls } from "./keys";

export type Core = "snes" | "gba";

export const EJS_DATA_PATH = "https://cdn.emulatorjs.org/stable/data/";

const SNES_EXT = ["snes", "sfc", "smc", "swc", "fig"];
const GBA_EXT = ["gba", "agb"];

export function detectCore(filename: string): Core | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (SNES_EXT.includes(ext)) return "snes";
  if (GBA_EXT.includes(ext)) return "gba";
  return null;
}

export const ACCEPT = [...SNES_EXT, ...GBA_EXT].map((e) => "." + e).join(",");

// Размеры «родного» кадра
export const NATIVE: Record<Core, { w: number; h: number }> = {
  gba: { w: 240, h: 160 },
  snes: { w: 256, h: 224 },
};

export const DEFAULT_SCALE: Record<Core, number> = { gba: 2, snes: 1.5 };

function hash(str: string): number {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000003;
  return h + 1;
}

export interface LaunchOptions {
  core: Core;
  url: string; // blob url
  name: string; // исходное имя файла
  bindings: Bindings;
  volume: number;
}

/** Собирает HTML для iframe без рамок: только экран игры. */
export function buildSrcDoc(o: LaunchOptions): string {
  const safe = o.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "game";
  const ext = o.core === "gba" ? "gba" : "sfc";
  const buttons: Record<string, boolean> = {};
  [
    "playPause", "play", "pause", "restart", "mute", "unmute", "settings", "fullscreen",
    "enterFullscreen", "exitFullscreen", "saveState", "loadState", "screenRecord", "gamepad",
    "cheat", "volume", "saveSavFiles", "loadSavFiles", "quickSave", "quickLoad", "screenshot",
    "cacheManager", "exitEmulation", "netplay", "diskButton", "contextMenu",
  ].forEach((k) => (buttons[k] = false));

  const cfg = {
    EJS_player: "#game",
    EJS_core: o.core,
    EJS_gameUrl: o.url,
    EJS_gameName: `${safe}.${ext}`,
    EJS_gameID: hash(o.name),
    EJS_pathtodata: EJS_DATA_PATH,
    EJS_startOnLoaded: true,
    EJS_volume: o.volume,
    EJS_Buttons: buttons,
    EJS_defaultControls: buildControls(o.bindings),
    EJS_disableLocalStorage: true,
    EJS_noAutoFocus: false,
    EJS_backgroundColor: "#000",
    EJS_AdUrl: "",
    EJS_language: "en-US",
    EJS_threads: false,
  };

  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
#game{width:100%;height:100%}
.ejs_menu_bar,.ejs_context_menu{display:none!important}
</style></head><body>
<div id="game"></div>
<script>Object.assign(window, ${json});</script>
<script src="${EJS_DATA_PATH}loader.js"></script>
</body></html>`;
}

type AnyWin = Window & {
  EJS_emulator?: {
    controls?: Record<number, Record<number, { value?: number; value2?: string }>>;
    gameManager?: { restart?: () => void };
    play?: (d?: boolean) => void;
    pause?: (d?: boolean) => void;
    setVolume?: (v: number) => void;
    paused?: boolean;
  };
};

function emu(frame: HTMLIFrameElement | null) {
  try {
    return (frame?.contentWindow as AnyWin | null)?.EJS_emulator ?? null;
  } catch {
    return null;
  }
}

/** Применить клавиши «вживую», если игра уже запущена. Возвращает true, если получилось. */
export function applyBindingsLive(frame: HTMLIFrameElement | null, b: Bindings): boolean {
  const e = emu(frame);
  if (!e || !e.controls) return false;
  const p0 = e.controls[0] ?? (e.controls[0] = {});
  for (const btn of PAD_BUTTONS) {
    const idx = BUTTON_INDEX[btn];
    p0[idx] = { ...(p0[idx] ?? {}), value: b[btn] };
  }
  return true;
}

export function pauseGame(frame: HTMLIFrameElement | null): boolean {
  const e = emu(frame);
  if (!e?.pause) return false;
  e.pause(true);
  return true;
}

export function resumeGame(frame: HTMLIFrameElement | null): boolean {
  const e = emu(frame);
  if (!e?.play) return false;
  e.play(true);
  return true;
}

export function resetGame(frame: HTMLIFrameElement | null): boolean {
  const e = emu(frame);
  if (!e?.gameManager?.restart) return false;
  e.gameManager.restart();
  return true;
}

export function setGameVolume(frame: HTMLIFrameElement | null, v: number): boolean {
  const e = emu(frame);
  if (!e?.setVolume) return false;
  e.setVolume(v);
  return true;
}

/** Esc внутри игры возвращает фокус в консоль. */
export function hookEscape(frame: HTMLIFrameElement | null, onEsc: () => void) {
  try {
    const doc = frame?.contentWindow?.document;
    doc?.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key === "Escape") onEsc();
      },
      true
    );
  } catch {
    /* ignore */
  }
}
