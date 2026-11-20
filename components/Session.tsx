"use client";

import { useEffect, useRef, useState } from "react";
import { carById } from "@/lib/game/cars";
import { CIRCUITS } from "@/lib/game/circuits";
import { formatTime, GameEngine, type HudState, type SessionConfig, type TrackInfo } from "@/lib/game/engine";
import { Hud } from "./Hud";
import { readRecord } from "./Menu";

export function Session({ config, onExit }: { config: SessionConfig; onExit: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const engine = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [info, setInfo] = useState<TrackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("Preparando el circuito…");
  const meta = CIRCUITS.find((c) => c.id === config.trackId) ?? CIRCUITS[0];

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const e = new GameEngine(el, config, { onReady: setInfo, onHud: setHud, onError: setError, onProgress: setProgress });
    e.enableAudio();
    engine.current = e;
    return () => {
      e.dispose();
      engine.current = null;
    };
  }, [config]);

  return (
    <div className="fixed inset-0 bg-black">
      <div ref={mount} className="absolute inset-0" />

      {!info && !error && <LoadingScreen trackId={meta.id} trackName={meta.name} carId={config.carId} progress={progress} />}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0b0d12] text-white">
          <p>{error}</p>
          <button onClick={onExit} className="rounded bg-[#e10600] px-4 py-2 font-bold">
            Volver
          </button>
        </div>
      )}

      {hud && info && <Hud hud={hud} info={info} trackName={meta.name} onMenu={() => engine.current?.togglePause()} />}

      {hud?.paused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-80 overflow-hidden rounded-md border border-white/15 bg-[#0d1626] text-white shadow-2xl">
            <div className="bg-gradient-to-r from-[#1b5fb8] to-[#123f7a] px-5 py-3 text-lg font-black uppercase italic tracking-wider">Pausa</div>
            <div className="flex flex-col gap-2 p-5">
              <MenuButton onClick={() => engine.current?.setPaused(false)}>Continuar</MenuButton>
              <MenuButton onClick={() => engine.current?.restart()}>Reiniciar sesión</MenuButton>
              <MenuButton onClick={onExit}>Salir al menú</MenuButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingScreen({ trackId, trackName, carId, progress }: { trackId: string; trackName: string; carId: string; progress: string }) {
  const [record] = useState(() => (typeof window === "undefined" ? null : readRecord(trackId)));
  const car = carById(carId);
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#120202] text-white">
      {/* red tunnel */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_55%,#ff2a1a_0%,#b30d0d_18%,#4a0505_45%,#120202_75%)]" />
      <div className="absolute inset-0 opacity-40 [background:repeating-linear-gradient(100deg,transparent_0_60px,rgba(255,255,255,0.08)_60px_63px)]" />
      <div className="absolute -bottom-10 left-0 h-48 w-[70%] -skew-x-[30deg] border-t-[10px] border-white/80" />
      <div className="absolute -bottom-16 left-[20%] h-48 w-[50%] -skew-x-[30deg] border-t-[6px] border-white/40" />

      <div className="absolute left-8 top-6 flex items-center gap-2">
        <span className="h-7 w-1.5 -skew-x-12 bg-white" />
        <span className="text-3xl font-black italic tracking-tight">
          APEX<span className="text-black/70">GP</span>
        </span>
      </div>
      <div className="absolute right-8 top-8 text-right text-sm font-bold uppercase tracking-widest">{trackName}</div>

      <div className="absolute left-[8%] top-[34%] w-[min(560px,80%)]">
        <div className="bg-black/75 px-5 py-3 text-3xl font-black uppercase italic tracking-wide">Contrarreloj</div>
        <div className="mt-1 flex justify-between bg-black/55 px-5 py-2 text-sm font-bold uppercase tracking-widest">
          <span className="text-white/70">Objetivo</span>
          <span className="font-mono tabular-nums">{record ? formatTime(record) : "Marca una vuelta"}</span>
        </div>
        <div className="mt-1 flex justify-between bg-black/55 px-5 py-2 text-sm font-bold uppercase tracking-widest">
          <span className="text-white/70">Coche</span>
          <span>
            {car.team} {car.name}
          </span>
        </div>
      </div>

      <div className="absolute bottom-8 right-8 flex items-center gap-3 text-right">
        <div>
          <div className="text-2xl font-black uppercase italic tracking-widest">Cargando</div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-white/60">{progress}</div>
        </div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 animate-pulse rounded-full bg-white" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border border-white/10 bg-white/5 px-4 py-3 text-left font-bold uppercase tracking-wider transition hover:border-[#e10600] hover:bg-[#e10600]/20"
    >
      {children}
    </button>
  );
}
