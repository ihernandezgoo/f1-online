import * as THREE from "three";
import { EngineAudio } from "./audio";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildCar, type CarVisual } from "./carModel";
import { carById } from "./cars";
import { detectCorners, nextCorner, type Corner, type CornerInfo } from "./corners";
import { createCar, resetToTrack, stepCar, wrapAngle, type CarInput, type CarState } from "./physics";
import { CIRCUITS } from "./circuits";
import { loadTrackModel, type LoadedTrackModel } from "./trackModel";
import { buildTrackScene, loadTrack, trackSvgPath, type Track, type TrackScene } from "./track";

export interface SessionConfig {
  trackId: string;
  carId: string;
}

export type Phase = "loading" | "countdown" | "running";
export type CameraMode = "top" | "chase" | "cockpit";
const CAMERA_ORDER: CameraMode[] = ["top", "chase", "cockpit"];

export interface HudState {
  phase: Phase;
  lights: number; // 0..5 lit, -1 = lights out
  speedKmh: number;
  gear: number;
  rpm: number;
  throttle: number;
  brake: number;
  lap: number;
  lapTime: number;
  lastLap: number | null;
  bestLap: number | null; // this session
  recordLap: number | null; // stored on this device
  sectors: (number | null)[];
  bestSectors: (number | null)[];
  delta: number | null; // vs best lap at the same point
  surface: string;
  carX: number;
  carZ: number;
  heading: number;
  camera: CameraMode;
  muted: boolean;
  paused: boolean;
  message: { text: string; tone: "purple" | "green" | "yellow" | "red" | "white" } | null;
  corner: CornerInfo | null; // next corner warning
  camYaw: number; // aerial camera orientation, for the minimap
}

export interface TrackInfo {
  name: string;
  length: number;
  svg: { d: string; viewBox: string };
}

export interface EngineCallbacks {
  onReady: (info: TrackInfo) => void;
  onHud: (hud: HudState) => void;
  onError: (msg: string) => void;
  onProgress?: (msg: string) => void;
}

const SUBSTEP = 1 / 120;
const CHECKPOINTS = 60;

const recordKey = (id: string) => `apexgp:record:${id}`;
function readRecord(id: string): number | null {
  try {
    const v = localStorage.getItem(recordKey(id));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function writeRecord(id: string, t: number) {
  try {
    localStorage.setItem(recordKey(id), String(t));
  } catch {
    /* storage unavailable */
  }
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.3, 5000);
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  private sky: THREE.Mesh;
  private envTex: THREE.Texture;
  private resizeObs: ResizeObserver;
  private raf = 0;
  private disposed = false;
  private lastFrame = 0;
  private acc = 0;
  private hudTimer = 0;

  private track: Track | null = null;
  private trackScene: TrackScene | null = null;
  private trackModel: LoadedTrackModel | null = null;
  private heights: Float64Array | null = null; // terrain height along the centerline (3D circuits)
  private carY = 0;
  private carPitch = 0;
  private car: CarState | null = null;
  private visual: CarVisual | null = null;
  private audio = new EngineAudio();

  private keys = new Set<string>();
  private input: CarInput = { throttle: 0, brake: 0, steer: 0 };

  // session state
  private phase: Phase = "loading";
  private clock = 0; // sim time (s), stops while paused
  private phaseStart = 0;
  private holdTime = 0;
  private lights = 0;
  private paused = false;
  private camMode: CameraMode = "top";
  private topZoom = 1; // mouse wheel

  // mouse driving: car steers towards the cursor, LMB throttle, RMB brake
  private mouseNdc = new THREE.Vector2();
  private mouseActive = false;
  private mouseLeft = false;
  private mouseRight = false;
  private mouseTarget = new THREE.Vector3();
  private hasMouseTarget = false;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private arrow: THREE.Mesh;
  private arrowTex: THREE.CanvasTexture;
  private camHeading = 0;
  private camH = 0;
  private camYaw = 0; // fixed screen-up direction of the aerial camera
  private camLead = new THREE.Vector2();
  private corners: Corner[] = [];
  private camPos = new THREE.Vector3();
  private shake = 0;

  private lap = 0; // 0 = out lap (before crossing the line)
  private lapStart = 0;
  private prevS = 0;
  private halfway = false;
  private sectorIdx = 0;
  private sectorStart = 0;
  private sectors: (number | null)[] = [null, null, null];
  private bestSectors: (number | null)[] = [null, null, null];
  private lastLap: number | null = null;
  private bestLap: number | null = null;
  private record: number | null = null;
  private lapCp: number[] = [];
  private bestLapCp: number[] | null = null;
  private cpIdx = -1;
  private message: HudState["message"] = null;
  private messageUntil = 0;

  constructor(
    private container: HTMLElement,
    private config: SessionConfig,
    private cb: EngineCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    // image-based lighting so PBR car materials (carbon, chrome, clearcoat) don't render black
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.6;
    this.scene.background = new THREE.Color(0x9fc8ec);
    this.scene.fog = new THREE.Fog(0xb9d5ee, 350, 2200);
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x40602c, 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -80;
    sc.right = 80;
    sc.top = 80;
    sc.bottom = -80;
    sc.near = 1;
    sc.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color(0x3d7fd1) }, bottom: { value: new THREE.Color(0xcfe4f6) } },
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }",
      }),
    );
    this.scene.add(this.sky);

    // green chevron arrow painted on the track towards the cursor
    const ac = document.createElement("canvas");
    ac.width = 64;
    ac.height = 64;
    const g = ac.getContext("2d")!;
    g.strokeStyle = "#39ff6a";
    g.lineWidth = 9;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(10, 46);
    g.lineTo(32, 22);
    g.lineTo(54, 46);
    g.stroke();
    this.arrowTex = new THREE.CanvasTexture(ac);
    this.arrowTex.colorSpace = THREE.SRGBColorSpace;
    this.arrowTex.wrapT = THREE.RepeatWrapping;
    this.arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1),
      new THREE.MeshBasicMaterial({ map: this.arrowTex, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, fog: false }),
    );
    this.arrow.renderOrder = 2;
    this.arrow.visible = false;
    this.scene.add(this.arrow);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    container.addEventListener("contextmenu", this.onContextMenu);
    container.addEventListener("wheel", this.onWheel, { passive: false });

    void this.init();
  }

  private async init() {
    try {
      const track = await loadTrack(this.config.trackId);
      if (this.disposed) return;
      this.track = track;
      const startS = track.length - 14;
      const meta = CIRCUITS.find((c) => c.id === track.id);
      if (meta?.model) {
        // detailed 3D circuit replaces the procedural scenery
        this.cb.onProgress?.("Cargando circuito 3D…");
        const tm = await loadTrackModel(meta.model, track, (loaded, total) =>
          this.cb.onProgress?.(
            total
              ? `Cargando circuito 3D… ${Math.round((loaded / total) * 100)}%`
              : `Cargando circuito 3D… ${(loaded / 1e6).toFixed(0)} MB`,
          ),
        );
        if (this.disposed) {
          tm.dispose();
          return;
        }
        this.trackModel = tm;
        this.heights = tm.heights;
        this.scene.add(tm.group);
        this.scene.fog = new THREE.Fog(0xb9d5ee, 600, 3500);
      } else {
        this.trackScene = buildTrackScene(track, this.renderer.capabilities.getMaxAnisotropy(), [{ s: startS, lat: 0 }]);
        this.scene.add(this.trackScene.group);
      }
      this.cb.onProgress?.("Preparando el coche…");

      const def = carById(this.config.carId);
      const hex = (s: string) => parseInt(s.slice(1), 16);
      const visual = await buildCar(def.model, hex(def.color), hex(def.accent));
      if (this.disposed) {
        visual.dispose();
        return;
      }
      this.visual = visual;
      this.scene.add(visual.root);
      this.car = createCar(track, startS, 0);
      this.record = readRecord(track.id);
      this.corners = detectCorners(track);
      // aerial camera orientation: per-circuit override, else the start straight runs
      // diagonally up-right on screen
      this.camYaw = meta?.cameraYaw ?? this.car.heading + 0.9;
      this.cb.onReady({ name: track.name, length: track.length, svg: trackSvgPath(track) });
      this.resetSession();
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } catch (e) {
      this.cb.onError(e instanceof Error ? e.message : String(e));
    }
  }

  // ------------------------------------------------------------ public api
  restart() {
    if (!this.track) return;
    this.car = createCar(this.track, this.track.length - 14, 0);
    this.resetSession();
    this.setPaused(false);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.audio.suspend();
    else this.audio.resume();
    this.emitHud();
  }

  togglePause() {
    if (this.phase !== "loading") this.setPaused(!this.paused);
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  enableAudio() {
    this.audio.start();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.container.removeEventListener("contextmenu", this.onContextMenu);
    this.container.removeEventListener("wheel", this.onWheel);
    this.arrowTex.dispose();
    this.envTex.dispose();
    (this.arrow.material as THREE.Material).dispose();
    this.resizeObs.disconnect();
    this.audio.dispose();
    this.trackScene?.dispose();
    this.trackModel?.dispose();
    this.visual?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ------------------------------------------------------------ session
  private resetSession() {
    this.phase = "countdown";
    this.phaseStart = this.clock;
    this.holdTime = 0.4 + Math.random() * 1.2;
    this.lights = 0;
    this.lap = 0;
    this.halfway = false;
    this.sectorIdx = 0;
    this.sectors = [null, null, null];
    this.lapCp = [];
    this.cpIdx = -1;
    this.message = null;
    this.prevS = this.car?.s ?? 0;
    this.camHeading = this.car?.heading ?? 0;
    this.camPos.set(0, 0, 0);
    this.camH = 0;
    this.camLead.set(0, 0);
    this.input = { throttle: 0, brake: 0, steer: 0 };
  }

  private flash(text: string, tone: NonNullable<HudState["message"]>["tone"], secs = 2.5) {
    this.message = { text, tone };
    this.messageUntil = this.clock + secs;
  }

  private updateTiming() {
    const t = this.track!;
    const c = this.car!;
    const L = t.length;
    const s = c.s;
    const now = this.clock;
    const crossedForward = this.prevS > 0.75 * L && s < 0.25 * L;
    const crossedBack = this.prevS < 0.25 * L && s > 0.75 * L;

    if (s > 0.4 * L && s < 0.6 * L) this.halfway = true;
    if (crossedBack) this.halfway = false;

    if (crossedForward && (this.lap === 0 || this.halfway)) {
      if (this.lap > 0) {
        const lapTime = now - this.lapStart;
        this.sectors[2] = now - this.sectorStart;
        this.lastLap = lapTime;
        let tone: NonNullable<HudState["message"]>["tone"] = "yellow";
        let label = "";
        if (this.bestLap === null || lapTime < this.bestLap) {
          this.bestLap = lapTime;
          this.bestLapCp = this.lapCp.slice();
          tone = "green";
          label = "MEJOR VUELTA";
        }
        if (this.record === null || lapTime < this.record) {
          this.record = lapTime;
          writeRecord(t.id, lapTime);
          tone = "purple";
          label = "NUEVO RÉCORD";
        }
        this.updateBestSector(2);
        this.flash(`${label ? label + "  " : ""}${formatTime(lapTime)}`, tone, 3.5);
      }
      this.lap++;
      this.lapStart = now;
      this.sectorStart = now;
      this.sectorIdx = 0;
      this.sectors = [null, null, null];
      this.lapCp = [];
      this.cpIdx = -1;
      this.halfway = false;
    }

    if (this.lap > 0) {
      if (this.sectorIdx === 0 && s > L / 3 && s < 0.6 * L) this.closeSector(0, now);
      else if (this.sectorIdx === 1 && s > (2 * L) / 3) this.closeSector(1, now);

      const cp = Math.floor((s / L) * CHECKPOINTS);
      if (cp > this.cpIdx && cp < CHECKPOINTS && s < 0.98 * L) {
        for (let k = this.cpIdx + 1; k <= cp; k++) this.lapCp[k] = now - this.lapStart;
        this.cpIdx = cp;
      }
    }
    this.prevS = s;
  }

  private closeSector(i: number, now: number) {
    const time = now - this.sectorStart;
    this.sectors[i] = time;
    const prevBest = this.bestSectors[i];
    this.updateBestSector(i);
    const d = prevBest === null ? null : time - prevBest;
    this.flash(
      d === null ? `S${i + 1}  ${formatTime(time)}` : `S${i + 1}  ${d <= 0 ? "−" : "+"}${Math.abs(d).toFixed(3)}`,
      d === null || d <= 0 ? "green" : "yellow",
      2,
    );
    this.sectorIdx = i + 1;
    this.sectorStart = now;
  }

  private updateBestSector(i: number) {
    const v = this.sectors[i];
    if (v !== null && (this.bestSectors[i] === null || v < this.bestSectors[i]!)) this.bestSectors[i] = v;
  }

  private liveDelta(): number | null {
    if (!this.bestLapCp || this.cpIdx < 0) return null;
    const a = this.lapCp[this.cpIdx];
    const b = this.bestLapCp[this.cpIdx];
    return a === undefined || b === undefined ? null : a - b;
  }

  // ------------------------------------------------------------ input
  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.code;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(k)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(k);
    if (["ArrowLeft", "ArrowRight", "KeyA", "KeyD"].includes(k)) this.mouseActive = false;
    if (k === "KeyC") {
      this.camMode = CAMERA_ORDER[(CAMERA_ORDER.indexOf(this.camMode) + 1) % CAMERA_ORDER.length];
    } else if (k === "KeyM") {
      this.audio.setMuted(!this.audio.muted);
    } else if (k === "KeyR" && this.car && this.track && this.phase === "running" && !this.paused) {
      resetToTrack(this.car, this.track);
    } else if (k === "Escape" || k === "KeyP") {
      this.togglePause();
    }
    this.emitHud();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseLeft = false;
    this.mouseRight = false;
  };

  private setMouse(e: PointerEvent) {
    const r = this.container.getBoundingClientRect();
    this.mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onPointerMove = (e: PointerEvent) => {
    this.setMouse(e);
    this.mouseActive = true;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.paused) return;
    this.setMouse(e);
    this.mouseActive = true;
    if (e.button === 0) this.mouseLeft = true;
    if (e.button === 2) this.mouseRight = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 0) this.mouseLeft = false;
    if (e.button === 2) this.mouseRight = false;
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.topZoom = Math.max(0.5, Math.min(2, this.topZoom * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
  };

  /** World point on the ground under the cursor. */
  private updateMouseTarget() {
    this.hasMouseTarget = false;
    if (!this.mouseActive || this.camMode === "cockpit") return;
    this.groundPlane.constant = -this.carY;
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.mouseTarget)) this.hasMouseTarget = true;
  }

  private readInput(dt: number) {
    const k = this.keys;
    let throttle = k.has("ArrowUp") || k.has("KeyW") ? 1 : 0;
    let brake = k.has("ArrowDown") || k.has("KeyS") || k.has("Space") ? 1 : 0;
    let steerTarget = (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0) - (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0);
    let analog = false;

    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.08) {
        steerTarget = -Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4;
        analog = true;
      }
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      if (rt > 0.02) throttle = Math.max(throttle, rt);
      if (lt > 0.02) brake = Math.max(brake, lt);
      if (p.buttons[0]?.pressed) throttle = 1;
      if (p.buttons[1]?.pressed) brake = 1;
      break;
    }

    if (this.mouseLeft) throttle = 1;
    if (this.mouseRight) brake = 1;

    const c = this.car;
    if (!analog && this.hasMouseTarget && c) {
      const dx = this.mouseTarget.x - c.x;
      const dz = this.mouseTarget.z - c.z;
      if (dx * dx + dz * dz > 9) {
        let diff = Math.atan2(Math.sin(Math.atan2(dx, dz) - c.heading), Math.cos(Math.atan2(dx, dz) - c.heading));
        if (c.speed < -0.5) diff = -diff;
        steerTarget = Math.max(-1, Math.min(1, diff * 2.4));
      } else steerTarget = 0;
      analog = true;
    }

    if (analog) this.input.steer += (steerTarget - this.input.steer) * Math.min(1, dt * 14);
    else {
      const cur = this.input.steer;
      const rate = steerTarget === 0 || Math.sign(steerTarget) !== Math.sign(cur) ? 7 : 3.2;
      const d = steerTarget - cur;
      this.input.steer = cur + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    }
    this.input.throttle = throttle;
    this.input.brake = brake;
  }

  // ------------------------------------------------------------ loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const t = this.track;
    const c = this.car;
    if (!t || !c) return;

    if (!this.paused) {
      this.updateMouseTarget();
      this.readInput(dt);
      this.acc += dt;
      while (this.acc >= SUBSTEP) {
        this.acc -= SUBSTEP;
        this.clock += SUBSTEP;
        this.tickPhase();
        stepCar(c, this.input, SUBSTEP, t, this.phase !== "running");
        if (this.phase === "running") this.updateTiming();
      }
      if (this.message && this.clock > this.messageUntil) this.message = null;
      this.audio.update(c.rpm, this.input.throttle, Math.abs(c.speed), c.surface === "grass");
    }

    this.updateVisuals(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    this.hudTimer += dt;
    if (this.hudTimer > 0.05) {
      this.hudTimer = 0;
      this.emitHud();
    }
  };

  private tickPhase() {
    if (this.phase !== "countdown") return;
    const e = this.clock - this.phaseStart;
    const lit = Math.max(0, Math.min(5, Math.floor(e - 0.5)));
    if (lit !== this.lights && this.lights >= 0) {
      this.lights = lit;
      this.setLights(lit);
    }
    if (e > 5.5 + this.holdTime) {
      this.lights = -1;
      this.setLights(0);
      this.phase = "running";
      this.flash("¡VAMOS!", "white", 1.2);
    }
  }

  private setLights(n: number) {
    this.trackScene?.startLights.forEach((m, i) => {
      const on = i < n;
      m.color.setHex(on ? 0xff2020 : 0x220000);
      m.emissive.setHex(on ? 0xff0000 : 0x000000);
    });
  }

  private updateVisuals(dt: number) {
    const c = this.car!;
    const v = this.visual!;
    this.updateHeight(dt);
    v.root.position.set(c.x, this.carY, c.z);
    v.root.rotation.order = "YXZ";
    v.root.rotation.set(this.carPitch, c.heading, 0);
    v.body.rotation.y = c.slip;
    // a little pitch under braking/accel and kerb rumble
    const rumble = c.surface === "kerb" ? Math.sin(this.clock * 90) * 0.012 * Math.min(1, Math.abs(c.speed) / 20) : 0;
    v.body.position.y = rumble;
    v.body.rotation.x += ((this.input.brake * 0.012 - this.input.throttle * 0.006) - v.body.rotation.x) * Math.min(1, dt * 6);
    for (const w of v.wheels) w.rotation.x = c.wheelSpin;
    for (const s of v.steer) s.rotation.y = c.steerAngle * 1.6;
    this.sun.position.set(c.x + 60, this.carY + 120, c.z + 40);
    this.sun.target.position.set(c.x, this.carY, c.z);
    this.sky.position.copy(this.camera.position);
    this.updateArrow(dt);
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), Math.min(1, c.impact / 25));
  }

  /** Follow the 3D circuit elevation (flat tracks stay at 0). */
  private updateHeight(dt: number) {
    const t = this.track!;
    const c = this.car!;
    const h = this.heights;
    if (!h) return;
    const n = t.n;
    const i = c.idx;
    const along = (c.x - t.px[i]) * t.tx[i] + (c.z - t.pz[i]) * t.tz[i];
    const j = along >= 0 ? (i + 1) % n : (i - 1 + n) % n;
    const f = Math.min(1, Math.abs(along) / t.ds);
    const y = h[i] + (h[j] - h[i]) * f;
    const slope = (h[(i + 3) % n] - h[(i - 3 + n) % n]) / (6 * t.ds);
    // heading vs track direction decides whether we are climbing or descending
    const dir = Math.cos(c.heading - Math.atan2(t.tx[i], t.tz[i]));
    const k = Math.min(1, dt * 10);
    this.carY = this.carY === 0 ? y : this.carY + (y - this.carY) * k;
    this.carPitch += (-Math.atan(slope * dir) - this.carPitch) * k;
  }

  private updateArrow(dt: number) {
    const c = this.car!;
    if (!this.hasMouseTarget || this.paused) {
      this.arrow.visible = false;
      return;
    }
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    // start just ahead of the nose, point towards the cursor
    const sx = c.x + fx * 3.4;
    const sz = c.z + fz * 3.4;
    const dx = this.mouseTarget.x - sx;
    const dz = this.mouseTarget.z - sz;
    const dist = Math.hypot(dx, dz);
    if (dist < 2) {
      this.arrow.visible = false;
      return;
    }
    const len = Math.min(dist, 32);
    const dir = Math.atan2(dx, dz);
    this.arrow.visible = true;
    this.arrow.position.set(sx + Math.sin(dir) * len * 0.5, this.carY + 0.12, sz + Math.cos(dir) * len * 0.5);
    this.arrow.rotation.set(-Math.PI / 2, 0, dir + Math.PI);
    this.arrow.scale.set(1, len, 1);
    this.arrowTex.repeat.set(1, len / 1.8);
    this.arrowTex.offset.y -= dt * (0.8 + Math.abs(c.speed) * 0.02);
  }

  private updateCamera(dt: number) {
    const c = this.car!;
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    const kmh = Math.abs(c.speed) * 3.6;

    if (this.camMode === "cockpit") {
      this.camera.position.set(c.x + fx * 0.15, this.carY + 1.02, c.z + fz * 0.15);
      this.camera.lookAt(c.x + fx * 20, this.carY + 0.8 - Math.tan(this.carPitch) * 20, c.z + fz * 20);
      this.camera.fov = 70 + kmh * 0.02;
    } else if (this.camMode === "top") {
      // Broadcast-style aerial camera: FIXED orientation (never rotates with the car),
      // high and tilted ~55°. It follows the car's position and leads towards where the car
      // is moving, so the screen opens up in the direction of travel at speed.
      const v = Math.abs(c.speed);
      const mx = Math.sin(c.heading) * Math.sign(c.speed || 1);
      const mz = Math.cos(c.heading) * Math.sign(c.speed || 1);
      const lead = Math.min(34, v * 0.45);
      const k = Math.min(1, dt * 1.8);
      this.camLead.x += (mx * lead - this.camLead.x) * k;
      this.camLead.y += (mz * lead - this.camLead.y) * k;
      const wantH = (58 + Math.min(26, v * 0.3)) * this.topZoom;
      this.camH = this.camH === 0 ? wantH : this.camH + (wantH - this.camH) * Math.min(1, dt * 1.2);
      const H = this.camH;
      const pitch = (55 * Math.PI) / 180;
      const hx = Math.sin(this.camYaw);
      const hz = Math.cos(this.camYaw);
      const lx = c.x + this.camLead.x;
      const lz = c.z + this.camLead.y;
      const back = H / Math.tan(pitch);
      const target = new THREE.Vector3(lx - hx * back, this.carY + H, lz - hz * back);
      if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
      this.camPos.lerp(target, Math.min(1, dt * 5));
      // keep the look point rigidly tied to the camera so the view never rotates
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camPos.x + hx * back, this.camPos.y - H, this.camPos.z + hz * back);
      this.camera.fov = 45;
    } else {
      const dist = 8.5;
      const dh = wrapAngle(c.heading - this.camHeading);
      this.camHeading += dh * Math.min(1, dt * 6);
      const hx = Math.sin(this.camHeading);
      const hz = Math.cos(this.camHeading);
      const target = new THREE.Vector3(c.x - hx * dist, this.carY + 2.9, c.z - hz * dist);
      if (this.camPos.lengthSq() === 0) this.camPos.copy(target);
      this.camPos.lerp(target, Math.min(1, dt * 12));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(c.x + hx * 4, this.carY + 0.5, c.z + hz * 4);
      this.camera.fov = 60 + Math.min(14, kmh * 0.045);
    }
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
    }
    this.camera.updateProjectionMatrix();
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private emitHud() {
    const c = this.car;
    if (!c) return;
    this.cb.onHud({
      phase: this.phase,
      lights: this.lights,
      speedKmh: Math.round(Math.abs(c.speed) * 3.6),
      gear: c.gear,
      rpm: c.rpm,
      throttle: this.input.throttle,
      brake: this.input.brake,
      lap: this.lap,
      lapTime: this.phase === "running" && this.lap > 0 ? this.clock - this.lapStart : 0,
      lastLap: this.lastLap,
      bestLap: this.bestLap,
      recordLap: this.record,
      sectors: [...this.sectors],
      bestSectors: [...this.bestSectors],
      delta: this.liveDelta(),
      surface: c.surface,
      carX: c.x,
      carZ: c.z,
      heading: c.heading,
      camera: this.camMode,
      muted: this.audio.muted,
      paused: this.paused,
      message: this.message,
      camYaw: this.camYaw,
      corner: this.phase === "running" && this.track ? nextCorner(this.track, this.corners, c.idx, c.speed) : null,
    });
  }
}

export function formatTime(t: number | null | undefined): string {
  if (t === null || t === undefined || !isFinite(t)) return "--:--.---";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
