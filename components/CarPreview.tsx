"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildCar } from "@/lib/game/carModel";
import type { CarDef } from "@/lib/game/cars";

/**
 * Garage turntable. `hero`: transparent studio shot (front three-quarter view, soft shadow).
 * Drag to rotate. Loaded models stay cached, so the race start is instant afterwards.
 */
export function CarPreview({ car, hero = false }: { car: CarDef; hero?: boolean }) {
  const mount = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let alive = true;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.cursor = "grab";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = 0.9;
    const camera = new THREE.PerspectiveCamera(hero ? 26 : 32, 1, 0.1, 100);
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(3, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    const sc = key.shadow.camera;
    sc.left = -4;
    sc.right = 4;
    sc.top = 4;
    sc.bottom = -4;
    const rim = new THREE.DirectionalLight(0xff6a5a, hero ? 1.6 : 0.6);
    rim.position.set(-6, 3, -5);
    scene.add(key, rim, new THREE.HemisphereLight(0xffe2dc, 0x200505, 0.7));

    const disposables: { dispose: () => void }[] = [env];
    if (hero) {
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.45 }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.receiveShadow = true;
      scene.add(shadow);
      disposables.push(shadow.geometry, shadow.material);
    } else {
      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(4.2, 64),
        new THREE.MeshStandardMaterial({ color: 0x1a1f2b, metalness: 0.6, roughness: 0.35 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      disposables.push(floor.geometry, floor.material);
    }

    const turntable = new THREE.Group();
    turntable.rotation.y = hero ? -0.75 : 0; // start on a front three-quarter view
    scene.add(turntable);
    let disposeCar: (() => void) | null = null;
    setLoading(true);
    const hex = (s: string) => parseInt(s.slice(1), 16);
    void buildCar(car.model, hex(car.color), hex(car.accent)).then((v) => {
      if (!alive) {
        v.dispose();
        return;
      }
      v.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      turntable.add(v.root);
      disposeCar = v.dispose;
      setLoading(false);
    });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep the whole car in frame on narrow screens
      const dist = hero ? Math.max(6.6, 10 / Math.min(1.6, camera.aspect)) : 10.6;
      camera.position.set(dist * 0.68, dist * 0.3, dist * 0.68);
      // hero: aim right of the car so it sits left-of-centre, like a studio shot
      if (hero) camera.lookAt(0.9, 0.35, -0.9);
      else camera.lookAt(0, 0.45, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // drag to rotate; idle auto-rotation resumes after a moment
    let dragging = false;
    let lastX = 0;
    let idleUntil = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      turntable.rotation.y += (e.clientX - lastX) * 0.01;
      lastX = e.clientX;
      idleUntil = performance.now() + 2500;
    };
    const up = () => {
      dragging = false;
      renderer.domElement.style.cursor = "grab";
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      if (!dragging && now > idleUntil) turntable.rotation.y += dt * (hero ? 0.18 : 0.45);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      disposeCar?.();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [car, hero]);

  return (
    <div className="relative h-full w-full">
      <div ref={mount} className="absolute inset-0" />
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-xs uppercase tracking-[0.3em] text-white/70">Cargando modelo…</div>
        </div>
      )}
    </div>
  );
}
