"use client";

import { useEffect, useState } from "react";
import { carById, CARS, type CarDef } from "@/lib/game/cars";
import { CIRCUITS, type CircuitMeta } from "@/lib/game/circuits";
import { formatTime, type SessionConfig } from "@/lib/game/engine";
import { projectCoords } from "@/lib/game/track";
import { CarPreview } from "./CarPreview";

type Screen = "home" | "garage" | "lobby";

// ------------------------------------------------------------------ helpers

export function CircuitPreview({ id, strokeScale = 45 }: { id: string; strokeScale?: number }) {
  const [path, setPath] = useState<{ d: string; vb: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/circuits/${id}.geojson`)
      .then((r) => r.json())
      .then((gj) => {
        if (!alive) return;
        const pts = projectCoords(gj.features[0].geometry.coordinates);
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of pts) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        const pad = Math.max(maxX - minX, maxZ - minZ) * 0.08;
        setPath({
          d: pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(0)} ${p.z.toFixed(0)}`).join("") + "Z",
          vb: `${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}`,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);
  if (!path) return <div className="h-full w-full animate-pulse rounded bg-white/5" />;
  const w = path.vb.split(" ").map(Number)[2];
  return (
    <svg viewBox={path.vb} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <path d={path.d} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={(w / strokeScale) * 2.6} strokeLinejoin="round" />
      <path d={path.d} fill="none" stroke="currentColor" strokeWidth={w / strokeScale} strokeLinejoin="round" />
    </svg>
  );
}

export function readRecord(id: string): number | null {
  try {
    const v = localStorage.getItem(`apexgp:record:${id}`);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function useRecords(circuits: CircuitMeta[]) {
  const [records, setRecords] = useState<Record<string, number | null>>({});
  useEffect(() => {
    const out: Record<string, number | null> = {};
    for (const c of circuits) out[c.id] = readRecord(c.id);
    queueMicrotask(() => setRecords(out)); // localStorage is client-only
  }, [circuits]);
  return records;
}

// ------------------------------------------------------------------ chrome

function TopBar({ car, onHome, screen }: { car: CarDef; onHome: () => void; screen: Screen }) {
  return (
    <div className="relative z-10 flex h-14 items-center justify-between border-b border-white/10 bg-black/40 px-5 backdrop-blur">
      <button onClick={onHome} className="flex items-center gap-2">
        <span className="h-6 w-1.5 -skew-x-12 bg-[#e10600]" />
        <span className="text-2xl font-black italic tracking-tight">
          APEX<span className="text-[#e10600]">GP</span>
        </span>
        {screen !== "home" && <span className="ml-3 text-xs uppercase tracking-[0.3em] text-white/40">← Inicio</span>}
      </button>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-xs uppercase tracking-widest text-white/40">Coche</span>
        <span className="flex items-center gap-2 rounded bg-white/5 px-3 py-1 font-bold italic">
          <span className="h-3 w-5 -skew-x-12" style={{ background: car.color, boxShadow: `inset -4px 0 0 ${car.accent}` }} />
          {car.team} {car.name}
        </span>
      </div>
    </div>
  );
}

function Panel({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-md border border-white/15 bg-[#0d1626]/90 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur ${className}`}>
      <div className="flex items-center justify-between bg-gradient-to-r from-[#1b5fb8] to-[#123f7a] px-4 py-2">
        <span className="text-sm font-black uppercase italic tracking-wider">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function RoundButton({ onClick, color, icon, title, text, disabled }: { onClick?: () => void; color: string; icon: React.ReactNode; title: string; text: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="group flex w-56 flex-col items-center gap-4 text-center disabled:opacity-50">
      <span
        className="flex h-32 w-32 items-center justify-center rounded-full border-4 border-white/80 shadow-[0_0_40px_rgba(0,0,0,0.6)] transition group-enabled:group-hover:scale-105 group-enabled:group-hover:border-white"
        style={{ background: `radial-gradient(circle at 35% 30%, ${color}, #111 85%)` }}
      >
        {icon}
      </span>
      <span className="text-lg font-black uppercase italic tracking-wide">{title}</span>
      <span className="text-xs leading-relaxed text-white/55">{text}</span>
    </button>
  );
}

const iconCls = "h-14 w-14 text-white";
const FlagIcon = () => (
  <svg viewBox="0 0 24 24" className={iconCls} fill="currentColor">
    <path d="M5 3h2v18H5zM8 4h11l-2 4 2 4H8z" opacity=".95" />
    <path d="M9 5h2v2H9zm4 0h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm-6 2h2v2H9zm4 0h2v2h-2z" fill="#111" />
  </svg>
);
const WrenchIcon = () => (
  <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
  </svg>
);
const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.8}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
  </svg>
);

// ------------------------------------------------------------------ screens

function Home({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-14 px-6 py-10">
      <div className="text-center">
        <h1 className="text-6xl font-black italic tracking-tight md:text-7xl">
          APEX<span className="text-[#e10600]">GP</span>
        </h1>
        <p className="mt-2 text-xs uppercase tracking-[0.5em] text-white/50">Carreras de monoplazas · Online</p>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-10">
        <RoundButton
          onClick={() => go("lobby")}
          color="#d4141c"
          icon={<FlagIcon />}
          title="Contrarreloj"
          text="Sal a pista en solitario, bate tu récord en circuitos reales."
        />
        <RoundButton onClick={() => go("garage")} color="#22a243" icon={<WrenchIcon />} title="Garaje" text="Elige tu monoplaza para la próxima sesión." />
        <RoundButton disabled color="#1b5fb8" icon={<GlobeIcon />} title="Carreras online" text="Compite contra otros pilotos. Próximamente." />
      </div>
    </div>
  );
}

function Garage({ carId, setCarId, done }: { carId: string; setCarId: (id: string) => void; done: () => void }) {
  const car = carById(carId);
  return (
    <div className="grid flex-1 grid-cols-1 gap-0 lg:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-2 border-r border-white/10 bg-black/30 p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-white/50">Garaje · Monoplazas</div>
        {CARS.map((c) => {
          const active = c.id === carId;
          return (
            <button
              key={c.id}
              onClick={() => setCarId(c.id)}
              className={`flex items-center gap-3 rounded border px-3 py-2 text-left transition ${
                active ? "border-[#22c55e] bg-[#22c55e]/10" : "border-white/10 bg-white/[0.03] hover:border-white/30"
              }`}
            >
              <span className="h-8 w-12 -skew-x-12 rounded-sm" style={{ background: c.color, boxShadow: `inset -8px 0 0 ${c.accent}` }} />
              <span>
                <span className="block text-[11px] uppercase tracking-widest text-white/50">{c.team}</span>
                <span className="block text-lg font-extrabold italic leading-tight">{c.name}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative flex min-h-[420px] flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(40,120,255,0.25),transparent_65%)]" />
        <div className="relative flex-1">
          <CarPreview car={car} />
        </div>
        <div className="relative flex items-center justify-between gap-4 border-t border-white/10 bg-black/40 px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-white/50">{car.team}</div>
            <div className="text-3xl font-black italic">{car.name}</div>
            {car.credit && <div className="mt-1 text-[11px] text-white/35">Modelo: {car.credit}</div>}
          </div>
          <button onClick={done} className="-skew-x-12 bg-[#22a243] px-8 py-3 font-black uppercase italic tracking-wider transition hover:bg-[#2bc451]">
            <span className="inline-block skew-x-12">Usar este coche ✓</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Lobby({
  trackId,
  setTrackId,
  car,
  back,
  start,
}: {
  trackId: string;
  setTrackId: (id: string) => void;
  car: CarDef;
  back: () => void;
  start: () => void;
}) {
  const records = useRecords(CIRCUITS);
  const sel = CIRCUITS.find((c) => c.id === trackId) ?? CIRCUITS[0];
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Panel
        title="Sesión · Contrarreloj"
        right={<span className="text-xs font-bold uppercase tracking-widest text-white/80">1 piloto · vueltas libres</span>}
        className="w-full max-w-5xl"
      >
        <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
          <div className="border-r border-white/10 p-4">
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="flex items-center gap-2 text-lg italic">
                {sel.flag} {sel.name}
              </span>
              <span className="text-xs uppercase tracking-widest text-white/50">{sel.country}</span>
            </div>
            <div className="mt-3 h-64 rounded bg-[radial-gradient(circle_at_center,#163a6b,#0a1426)] p-4 text-[#9fd0ff]">
              <CircuitPreview id={sel.id} strokeScale={60} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <Stat label="Récord" value={formatTime(records[sel.id])} accent="#c77dff" />
              <Stat label="Escenario" value={sel.model ? "3D detallado" : "Básico"} />
              <Stat label="Coche" value={`${car.team} ${car.name}`} />
            </div>
          </div>
          <div className="flex flex-col">
            <div className="grid grid-cols-[1fr_auto] border-b border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white/50">
              <span>Circuito</span>
              <span>Récord</span>
            </div>
            <div className="flex-1">
              {CIRCUITS.map((c) => {
                const active = c.id === trackId;
                return (
                  <button
                    key={c.id}
                    onClick={() => setTrackId(c.id)}
                    className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/5 px-4 py-3 text-left text-sm transition ${
                      active ? "bg-[#1b5fb8]/50" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="text-lg">{c.flag}</span>
                    <span>
                      <span className="block font-bold">{c.name}</span>
                      <span className="block text-[11px] text-white/45">{c.fullName}</span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[#c77dff]">{formatTime(records[c.id])}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 bg-black/30 px-4 py-3">
          <button onClick={back} className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/70 hover:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e10600]">‹</span> Atrás
          </button>
          <button
            onClick={start}
            className="-skew-x-12 bg-[#e10600] px-10 py-3 font-black uppercase italic tracking-wider shadow-[0_0_30px_rgba(225,6,0,0.45)] transition hover:bg-[#ff1a12]"
          >
            <span className="inline-block skew-x-12">Salir a pista →</span>
          </button>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded bg-white/5 px-2 py-2">
      <div className="uppercase tracking-widest text-white/40">{label}</div>
      <div className="mt-0.5 truncate font-mono font-bold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ root

export function Menu({ initial, onStart }: { initial: SessionConfig; onStart: (c: SessionConfig) => void }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [trackId, setTrackId] = useState(initial.trackId);
  const [carId, setCarId] = useState(initial.carId);
  const car = carById(carId);
  const sel = CIRCUITS.find((c) => c.id === trackId);

  const bg =
    screen === "home"
      ? "bg-[radial-gradient(ellipse_at_50%_120%,#7a0a0a,#2a0606_45%,#0b0d12_80%)]"
      : "bg-[radial-gradient(ellipse_at_50%_-10%,#1b4f9c,#0b1a33_50%,#060a14_85%)]";

  return (
    <div className={`relative flex min-h-screen w-full flex-col overflow-hidden text-white ${bg}`}>
      {/* speed streaks */}
      <div className="pointer-events-none absolute inset-0 opacity-30 [background:repeating-linear-gradient(115deg,transparent_0_80px,rgba(255,255,255,0.04)_80px_82px)]" />
      <TopBar car={car} onHome={() => setScreen("home")} screen={screen} />
      <div className="relative flex flex-1 flex-col">
        {screen === "home" && <Home go={setScreen} />}
        {screen === "garage" && <Garage carId={carId} setCarId={setCarId} done={() => setScreen("lobby")} />}
        {screen === "lobby" && (
          <Lobby trackId={trackId} setTrackId={setTrackId} car={car} back={() => setScreen("home")} start={() => onStart({ trackId, carId })} />
        )}
      </div>
      <footer className="relative px-4 py-2 text-center text-[10px] text-white/30">
        {car.credit && <>Coche: {car.credit} · </>}
        {sel?.model && <>Circuito 3D: {sel.model.credit} · </>}
        Trazados: bacinger/f1-circuits (MIT)
      </footer>
    </div>
  );
}
