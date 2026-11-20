"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildCar } from "@/lib/game/carModel";
import type { CarDef } from "@/lib/game/cars";

/** Garage turntable. Loaded models stay cached, so the race start is instant afterwards. */
export function CarPreview({ car }: { car: CarDef }) {
  const mount = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let alive = true;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = env;
    scene.environmentIntensity = 0.8;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(7.5, 3.2, 7.5);
    camera.lookAt(0, 0.4, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(4, 8, 3);
    key.castShadow = true;
    scene.add(key, new THREE.HemisphereLight(0xbfd4ff, 0x202020, 0.8));

    // turntable floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a1f2b, metalness: 0.6, roughness: 0.35 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.1, 4.25, 64), new THREE.MeshBasicMaterial({ color: 0xe10600 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    scene.add(ring);

    const turntable = new THREE.Group();
    scene.add(turntable);
    let dispose: (() => void) | null = null;
    setLoading(true);
    const hex = (s: string) => parseInt(s.slice(1), 16);
    void buildCar(car.model, hex(car.color), hex(car.accent)).then((v) => {
      if (!alive) {
        v.dispose();
        return;
      }
      turntable.add(v.root);
      dispose = v.dispose;
      setLoading(false);
    });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      turntable.rotation.y += ((now - last) / 1000) * 0.45;
      last = now;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      dispose?.();
      env.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (o.parent === scene || o === floor || o === ring)) m.geometry.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [car]);

  return (
    <div className="relative h-full w-full">
      <div ref={mount} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-xs uppercase tracking-[0.3em] text-white/50">Cargando modelo…</div>
        </div>
      )}
    </div>
  );
}
