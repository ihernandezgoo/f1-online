"use client";

import { useState } from "react";
import { CARS } from "@/lib/game/cars";
import { CIRCUITS } from "@/lib/game/circuits";
import type { SessionConfig } from "@/lib/game/engine";
import { Menu } from "./Menu";
import { Session } from "./Session";

export function Game() {
  const [config, setConfig] = useState<SessionConfig>({ trackId: CIRCUITS[0].id, carId: CARS[0].id });
  const [playing, setPlaying] = useState(false);

  if (playing) return <Session config={config} onExit={() => setPlaying(false)} />;
  return (
    <Menu
      initial={config}
      onStart={(c) => {
        setConfig(c);
        setPlaying(true);
      }}
    />
  );
}
