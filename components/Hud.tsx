"use client";

import { formatTime, type HudState, type TrackInfo } from "@/lib/game/engine";

const TONE: Record<string, string> = {
  purple: "bg-[#9b30ff]",
  green: "bg-[#16a34a]",
  yellow: "bg-[#eab308] text-black",
  red: "bg-[#e10600]",
  white: "bg-white text-black",
};

function sectorTone(v: number | null, best: number | null) {
  if (v === null) return "bg-white/15";
  if (best !== null && v <= best + 1e-6) return "bg-[#16a34a]";
  return "bg-[#eab308]";
}

const box = "bg-black/65 backdrop-blur-sm";

export function Hud({ hud, info, trackName, onMenu }: { hud: HudState; info: TrackInfo; trackName: string; onMenu: () => void }) {
  const rpmFrac = Math.max(0, Math.min(1, (hud.rpm - 4000) / 11000));
  const leds = 15;
  const lit = Math.round(rpmFrac * leds);
  const vb = info.svg.viewBox.split(" ").map(Number);
  const cx = vb[0] + vb[2] / 2;
  const cy = vb[1] + vb[3] / 2;
  // rotate the minimap so it matches the fixed aerial camera (screen-up = camYaw)
  const rot = -90 - (Math.atan2(Math.cos(hud.camYaw), Math.sin(hud.camYaw)) * 180) / Math.PI;
  const size = Math.max(vb[2], vb[3]);

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-white">
      {/* ---------- top-left: session / lap / target */}
      <div className="absolute left-3 top-3 w-[300px]">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white/80 drop-shadow">{trackName}</div>
        <div className={`flex items-stretch ${box}`}>
          <div className="flex items-baseline gap-1 border-r border-white/15 px-3 py-1">
            <span className="text-lg font-black italic text-white/60">L</span>
            <span className="font-mono text-4xl font-black italic leading-none tabular-nums">{String(Math.max(hud.lap, 0)).padStart(2, "0")}</span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 px-3">
            <div className="grid grid-cols-3 gap-1">
              {hud.sectors.map((s, i) => (
                <div key={i} className={`h-1.5 ${sectorTone(s, hud.bestSectors[i])}`} />
              ))}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">
              {hud.lap === 0 ? "Vuelta de salida" : "Contrarreloj"}
            </div>
          </div>
        </div>
        <div className={`mt-0.5 flex justify-between px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${box}`}>
          <span className="text-white/60">Objetivo</span>
          <span className="font-mono tabular-nums text-[#c77dff]">{formatTime(hud.recordLap)}</span>
        </div>
      </div>

      {/* ---------- top-right: menu + timer */}
      <div className="absolute right-3 top-3 flex w-[300px] flex-col items-end gap-1">
        <button
          onClick={onMenu}
          className={`pointer-events-auto px-4 py-1 text-[11px] font-black uppercase tracking-[0.2em] transition hover:bg-[#e10600] ${box}`}
        >
          Menú
        </button>
        <div className={`w-full px-3 py-1 text-right ${box}`}>
          <span className="font-mono text-4xl font-black tabular-nums">{formatTime(hud.lap > 0 ? hud.lapTime : null)}</span>
        </div>
        <div className={`flex w-full justify-between px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${box}`}>
          <span className="text-white/60">Mejor sesión</span>
          <span className="font-mono tabular-nums text-[#22c55e]">{formatTime(hud.bestLap)}</span>
        </div>
        <div className={`flex w-full justify-between px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${box}`}>
          <span className="text-white/60">Última</span>
          <span className="font-mono tabular-nums">{formatTime(hud.lastLap)}</span>
        </div>
        {hud.delta !== null && (
          <div className={`px-2 py-0.5 font-mono text-sm font-bold tabular-nums ${hud.delta <= 0 ? "bg-[#16a34a]" : "bg-[#e10600]"}`}>
            {hud.delta <= 0 ? "−" : "+"}
            {Math.abs(hud.delta).toFixed(3)}
          </div>
        )}
      </div>

      {/* ---------- bottom-left: minimap (rotated like the camera) */}
      <div className="absolute bottom-3 left-3 h-44 w-44">
        <svg viewBox={`${cx - size * 0.55} ${cy - size * 0.55} ${size * 1.1} ${size * 1.1}`} className="h-full w-full drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          <g transform={`rotate(${rot} ${cx} ${cy})`}>
            <path d={info.svg.d} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={size / 22} strokeLinejoin="round" />
            <path d={info.svg.d} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={size / 45} strokeLinejoin="round" />
            <circle cx={hud.carX} cy={hud.carZ} r={size / 28} fill="#e10600" stroke="white" strokeWidth={size / 110} />
          </g>
        </svg>
      </div>

      {/* ---------- start lights */}
      {hud.phase === "countdown" && (
        <div className="absolute left-1/2 top-16 flex -translate-x-1/2 gap-3 rounded-lg bg-black/80 px-5 py-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              {[0, 1].map((r) => (
                <div
                  key={r}
                  className={`h-9 w-9 rounded-full border-2 border-black ${
                    i < hud.lights ? "bg-[#ff1a1a] shadow-[0_0_24px_#ff1a1a]" : "bg-[#2a0505]"
                  }`}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ---------- next corner */}
      {hud.corner && <CornerCallout corner={hud.corner} />}

      {/* ---------- message */}
      {hud.message && (
        <div className="absolute left-1/2 top-[30%] -translate-x-1/2">
          <div className={`-skew-x-12 px-6 py-2 font-black italic tracking-wide shadow-xl ${TONE[hud.message.tone]}`}>
            <span className="inline-block skew-x-12 font-mono text-2xl tabular-nums">{hud.message.text}</span>
          </div>
        </div>
      )}

      {hud.surface === "grass" && hud.phase === "running" && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-[#eab308] px-3 py-1 text-xs font-black uppercase tracking-widest text-black">
          Fuera de pista
        </div>
      )}

      {/* ---------- bottom-right: revs, speed, gear */}
      <div className="absolute bottom-3 right-3 w-[300px]">
        <div className="mb-1 flex justify-end gap-1 px-1">
          {Array.from({ length: leds }).map((_, i) => {
            const on = i < lit;
            const color = i < 5 ? "#22c55e" : i < 10 ? "#e10600" : "#7c3aed";
            return (
              <span
                key={i}
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: on ? color : "rgba(0,0,0,0.55)", boxShadow: on ? `0 0 6px ${color}` : "none" }}
              />
            );
          })}
        </div>
        <div className="flex items-stretch">
          <div className="flex flex-1 flex-col justify-center gap-1 bg-[#b10a0a]/90 px-3">
            <Bar value={hud.throttle} color="#ffffff" />
            <Bar value={hud.brake} color="#111111" />
          </div>
          <div className={`flex items-center gap-2 py-1 pl-3 pr-1 ${box}`}>
            <div className="text-right leading-none">
              <div className="font-mono text-4xl font-black tabular-nums">{hud.speedKmh}</div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-white/50">km/h</div>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/70 bg-[#1b5fb8] font-mono text-2xl font-black italic">
              {hud.gear === 0 ? "R" : hud.speedKmh < 2 && hud.throttle === 0 ? "N" : hud.gear}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- hints (until the first flying lap starts) */}
      {(hud.phase !== "running" || hud.lap === 0) && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/55 px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/70">
          🖱 Apunta para girar · Clic izq. acelera · Clic der. frena · Rueda: zoom · C cámara · R volver a pista
        </div>
      )}
    </div>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden bg-black/30">
      <div className="h-full transition-[width] duration-75" style={{ width: `${value * 100}%`, background: color }} />
    </div>
  );
}

const GRADE_COLOR = ["", "#e10600", "#ff6a00", "#f5b400", "#c6d300", "#22c55e", "#22c55e"];
const GRADE_LABEL = ["", "Horquilla", "Lenta", "Media", "Rápida", "Muy rápida", "A fondo"];

/** Rally-style pace note: direction, severity, distance and a brake warning. */
function CornerCallout({ corner }: { corner: NonNullable<HudState["corner"]> }) {
  const color = GRADE_COLOR[corner.grade];
  // tighter corners get a sharper arrow
  const bend = [0, 150, 120, 90, 60, 40, 25][corner.grade];
  const a = (bend * Math.PI) / 180;
  // stem goes up from the bottom, then turns left (dir=1) or right (dir=-1)
  const ex = 24 - corner.dir * Math.sin(a) * 16;
  const ey = 24 - Math.cos(a) * 16;
  const path = `M24 44 L24 24 L${ex.toFixed(1)} ${ey.toFixed(1)}`;
  const ang = Math.atan2(ey - 24, ex - 24);
  const head = (o: number) => `${ex - Math.cos(ang + o) * 9} ${ey - Math.sin(ang + o) * 9}`;
  return (
    <div className="absolute left-1/2 top-3 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg bg-black/70 py-2 pl-2 pr-4 shadow-xl backdrop-blur" style={{ borderBottom: `3px solid ${color}` }}>
        <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
          <path d={path} />
          <path d={`M${head(0.5)} L${ex} ${ey} L${head(-0.5)}`} />
        </svg>
        <div className="leading-tight">
          <div className="text-[11px] uppercase tracking-widest text-white/60">
            Curva {corner.number} · {corner.dir > 0 ? "Izquierda" : "Derecha"}
          </div>
          <div className="text-lg font-black italic uppercase" style={{ color }}>
            {GRADE_LABEL[corner.grade]}
          </div>
        </div>
        <div className="ml-2 text-right font-mono text-2xl font-bold tabular-nums">{corner.distance > 0 ? `${corner.distance} m` : "—"}</div>
      </div>
      {corner.brake && (
        <div className="mt-2 animate-pulse rounded bg-[#e10600] py-1 text-center text-lg font-black uppercase italic tracking-[0.3em] shadow-[0_0_24px_#e10600]">
          Frena
        </div>
      )}
    </div>
  );
}
