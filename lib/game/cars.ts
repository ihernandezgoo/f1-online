// Selectable cars. Models are GLB files in /public/models (Sketchfab, CC-BY-4.0, by Dave Love).
// To add one: drop the .glb in /public/models and add an entry here.

export interface CarDef {
  id: string;
  name: string; // shown in the menu
  team: string;
  model: string | null; // null = built-in procedural car
  color: string; // UI accent / minimap dot
  accent: string;
  credit?: string;
}

const SKETCHFAB_AUTHOR = "Dave Love (Sketchfab) · CC-BY-4.0";

export const CARS: CarDef[] = [
  { id: "redbull", name: "RB22", team: "Red Bull", model: "/models/2026_redbull_r22.glb", color: "#1e2a5a", accent: "#ffc906", credit: `“2026 Redbull RB22” · ${SKETCHFAB_AUTHOR}` },
  { id: "ferrari", name: "SF-26", team: "Ferrari", model: "/models/2026_ferrari_sf-26.glb", color: "#d4141c", accent: "#fff200", credit: `“2026 Ferrari SF-26” · ${SKETCHFAB_AUTHOR}` },
  { id: "mercedes", name: "W17", team: "Mercedes", model: "/models/2026_mercedes_w17.glb", color: "#9aa3ab", accent: "#00d2be", credit: `“2026 Mercedes W17” · ${SKETCHFAB_AUTHOR}` },
  { id: "audi", name: "R26", team: "Audi", model: "/models/2026_audi_r26.glb", color: "#2b2b2b", accent: "#ff3b30", credit: `“2026 Audi R26” · ${SKETCHFAB_AUTHOR}` },
  { id: "cadillac", name: "MAC-26", team: "Cadillac", model: "/models/2026_cadillac_mac-26.glb", color: "#e8e8e8", accent: "#111111", credit: `“2026 Cadillac MAC-26” · ${SKETCHFAB_AUTHOR}` },
  { id: "proto", name: "Prototipo", team: "Genérico", model: null, color: "#d4141c", accent: "#f5f5f5" },
];

export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];
