import { useRef } from "react";

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  rect: WinRect;
  srcDoc: string;
  onRect: (r: WinRect) => void;
  onLoad: (frame: HTMLIFrameElement) => void;
  frameRef: React.MutableRefObject<HTMLIFrameElement | null>;
}

const MIN_W = 120;

/** Маленькое окно без рамок и заголовка. Двигать — за верхний край, размер — правый нижний угол. */
export default function GameWindow({ rect, srcDoc, onRect, onLoad, frameRef }: Props) {
  const drag = useRef<{ mode: "move" | "size"; sx: number; sy: number; r: WinRect } | null>(null);

  const start = (mode: "move" | "size") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r: rect };
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === "move") {
      const x = Math.min(Math.max(d.r.x + dx, 40 - d.r.w), window.innerWidth - 40);
      const y = Math.min(Math.max(d.r.y + dy, 0), window.innerHeight - 20);
      onRect({ ...d.r, x, y });
    } else {
      const w = Math.max(MIN_W, d.r.w + dx);
      const h = Math.round((w * d.r.h) / d.r.w);
      onRect({ ...d.r, w, h });
    }
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed z-50 bg-black shadow-2xl shadow-black/70"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <iframe
        ref={frameRef}
        title="game"
        srcDoc={srcDoc}
        allow="autoplay; gamepad; fullscreen"
        className="block h-full w-full border-0"
        onLoad={(e) => onLoad(e.currentTarget)}
      />
      {/* невидимая зона перетаскивания */}
      <div
        className="group absolute inset-x-0 top-0 h-2.5 cursor-move touch-none"
        onPointerDown={start("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="h-full w-full bg-emerald-400/0 transition group-hover:bg-emerald-400/40" />
      </div>
      {/* невидимый угол изменения размера */}
      <div
        className="group absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
        onPointerDown={start("size")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="absolute bottom-0 right-0 h-0 w-0 border-b-[10px] border-l-[10px] border-b-emerald-400/0 border-l-transparent transition group-hover:border-b-emerald-400/60" />
      </div>
    </div>
  );
}
