// Circuit data comes from https://github.com/bacinger/f1-circuits (MIT).
// To add a circuit: drop its .geojson into /public/circuits and add a line here.
import type { TrackModelDef } from "./trackModel";

export interface CircuitMeta {
  id: string;
  name: string;
  fullName: string;
  country: string;
  flag: string;
  defaultLaps: number;
  model?: TrackModelDef; // optional detailed 3D circuit
  cameraYaw?: number; // aerial camera "screen up" direction (radians); default: start straight diagonal
}

export const CIRCUITS: CircuitMeta[] = [
  { id: "it-1922", name: "Monza", fullName: "Autodromo Nazionale Monza", country: "Italia", flag: "🇮🇹", defaultLaps: 3 },
  { id: "be-1925", name: "Spa-Francorchamps", fullName: "Circuit de Spa-Francorchamps", country: "Bélgica", flag: "🇧🇪", defaultLaps: 2 },
  { id: "gb-1948", name: "Silverstone", fullName: "Silverstone Circuit", country: "Reino Unido", flag: "🇬🇧", defaultLaps: 3 },
  {
    id: "it-1953",
    name: "Imola",
    fullName: "Autodromo Enzo e Dino Ferrari",
    country: "Italia",
    flag: "🇮🇹",
    defaultLaps: 3,
    // fit computed by ICP of the GeoJSON line onto the model's asphalt (mean error ≈ 0.8 m)
    model: {
      url: "/models/tracks/imola_circuit_2024_layout.glb",
      rotationY: -0.02983139409560436,
      scale: 0.999783961365672,
      pivot: [14.090641340705824, -43.33648882687193],
      offset: [-106.4141806897798, -23.301275458490394],
      credit: "“Imola Circuit 2024 layout” · Dave Love (Sketchfab) · CC-BY-4.0",
    },
  },
];

export interface TeamLivery {
  name: string;
  color: number;
  accent: number;
}

export const LIVERIES: TeamLivery[] = [
  { name: "Rosso Veloce", color: 0xd4141c, accent: 0xf5f5f5 },
  { name: "Silver Arrow", color: 0x9aa3ab, accent: 0x00d2be },
  { name: "Midnight Bull", color: 0x1b2a6b, accent: 0xffc906 },
  { name: "Papaya Works", color: 0xff7a00, accent: 0x1fa2ff },
  { name: "Racing Verde", color: 0x0b6b4f, accent: 0xc9f227 },
  { name: "Bleu Alpine", color: 0x1a7bd8, accent: 0xff66b2 },
  { name: "Shadow Black", color: 0x1c1c1c, accent: 0xe8c547 },
];

export const AI_DRIVERS = ["K. Moreau", "L. Hartmann", "T. Okafor", "R. Silva", "J. Lindqvist", "A. Rossi", "M. Tanaka"];
