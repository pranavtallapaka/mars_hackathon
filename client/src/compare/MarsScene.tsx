import { PerspectiveCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ReplayPose } from '../sim/replay';
import type { SimMap, Vec } from '../sim/types';
import { HAZARD_AMBER, PLOT_BLUE, cellMetersOf, mappedRocks, sandCells, worldSize } from '../view/terrain';

export const COMPARE_ASSETS = {
  plates: '/assets/mars/plates.png',
  horizon: '/assets/mars/horizon.png',
} as const;

/** Pale butterscotch from Perseverance-style stills, not the old game-sky tan. */
export const MARS_SKY = '#e4c49a';
export const MARS_FOG = '#e6c7a0';

export interface MarsTextures {
  plates: THREE.Texture | null;
  horizon: THREE.Texture | null;
}

export function useMarsTextures(): MarsTextures {
  return {
    plates: useLoadedTexture(COMPARE_ASSETS.plates, true),
    horizon: useLoadedTexture(COMPARE_ASSETS.horizon),
  };
}

function useLoadedTexture(url: string, tile = false): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useLayoutEffect(() => {
    const loader = new THREE.TextureLoader();
    let alive = true;
    loader.load(url, (next) => {
      if (!alive) return;
      next.colorSpace = THREE.SRGBColorSpace;
      if (tile) {
        next.wrapS = next.wrapT = THREE.RepeatWrapping;
        next.anisotropy = 8;
      }
      setTex(next);
    });
    return () => {
      alive = false;
    };
  }, [url, tile]);
  return tex;
}

export function flatFromGrid(map: SimMap, gx: number, gy: number): { x: number; y: number; z: number } {
  const m = cellMetersOf(map);
  return { x: gx * m, y: 0, z: gy * m };
}

export function rockCells(map: SimMap, extras: readonly Vec[]): Vec[] {
  const seen = new Set<string>();
  const all: Vec[] = [];
  for (const p of [...mappedRocks(map), ...extras]) {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    all.push(p);
  }
  return all;
}

export function linePoints(map: SimMap, cells: readonly Vec[]): THREE.Vector3[] {
  return cells.map((p) => {
    const w = flatFromGrid(map, p.x, p.y);
    return new THREE.Vector3(w.x, 0.08, w.z);
  });
}

export interface SharedMarsAssets {
  textures: MarsTextures;
  rocks: Vec[];
  hidden: Vec[];
  planned: THREE.Vector3[];
}

interface SideSceneProps {
  map: SimMap;
  assets: SharedMarsAssets;
  pose: ReplayPose;
  follow: ReplayPose;
  trail: readonly Vec[];
  cameraMode: 'chase' | 'fp';
}

export function SideScene({ map, assets, pose, follow, trail, cameraMode }: SideSceneProps) {
  const start = flatFromGrid(map, follow.x, follow.y);
  return (
    <>
      <color attach="background" args={[MARS_SKY]} />
      <fog attach="fog" args={[MARS_FOG, 70, 260]} />
      <PerspectiveCamera
        makeDefault
        fov={cameraMode === 'fp' ? 62 : 48}
        near={0.2}
        far={800}
        position={[start.x, 6, start.z + 14]}
      />
      <SkyFill />
      <Horizon tex={assets.textures.horizon} map={map} />
      <SoftLight />
      <Ground map={map} tex={assets.textures.plates} />
      <Hazards map={map} />
      <FieldRocks map={map} cells={assets.rocks} />
      <Boulders map={map} cells={assets.hidden} />
      <RouteLine points={assets.planned} color={PLOT_BLUE} opacity={0.2} width={0.16} />
      <RouteLine points={linePoints(map, trail)} color={PLOT_BLUE} opacity={0.55} width={0.22} />
      <Rover map={map} pose={pose} />
      <RoverCamera map={map} pose={follow} mode={cameraMode} />
    </>
  );
}

function SkyFill() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={ref} renderOrder={-2}>
      <sphereGeometry args={[70, 16, 12]} />
      <meshBasicMaterial color={MARS_SKY} side={THREE.BackSide} depthWrite={false} depthTest={false} fog={false} />
    </mesh>
  );
}

function Horizon({ tex, map }: { tex: THREE.Texture | null; map: SimMap }) {
  const { w, d } = worldSize(map);
  if (!tex) return null;
  return (
    <mesh position={[w / 2, 10, d / 2]}>
      <cylinderGeometry args={[200, 200, 28, 48, 1, true]} />
      <meshBasicMaterial map={tex} side={THREE.BackSide} fog depthWrite={false} />
    </mesh>
  );
}

function SoftLight() {
  return (
    <>
      <hemisphereLight args={['#f3ddc0', '#b56a3c', 1.15]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[-40, 55, 20]} intensity={0.45} color="#f0d2a8" />
    </>
  );
}

function Ground({ map, tex }: { map: SimMap; tex: THREE.Texture | null }) {
  const { w, d } = worldSize(map);
  const tiled = useMemo(() => {
    if (!tex) return null;
    const next = tex.clone();
    next.wrapS = next.wrapT = THREE.RepeatWrapping;
    next.repeat.set(w / 16, d / 16);
    next.anisotropy = 8;
    return next;
  }, [tex, w, d]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, d / 2]} receiveShadow={false}>
      <planeGeometry args={[w * 1.8, d * 1.8, 1, 1]} />
      <meshStandardMaterial
        map={tiled ?? undefined}
        color={tiled ? '#ffffff' : '#c56a3a'}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}

function Hazards({ map }: { map: SimMap }) {
  const cells = useMemo(() => sandCells(map), [map]);
  const m = cellMetersOf(map);
  return (
    <group>
      {cells.map((c) => {
        const w = flatFromGrid(map, c.x + 0.5, c.y + 0.5);
        return (
          <mesh key={`${c.x},${c.y}`} position={[w.x, 0.03, w.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[m * 0.94, m * 0.94]} />
            <meshStandardMaterial color={HAZARD_AMBER} transparent opacity={0.18} roughness={1} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function FieldRocks({ map, cells }: { map: SimMap; cells: readonly Vec[] }) {
  return (
    <group>
      {cells.map((c) => {
        const w = flatFromGrid(map, c.x + 0.5, c.y + 0.5);
        const s = 1.6 + ((c.x * 13 + c.y * 7) % 5) * 0.45;
        return (
          <mesh key={`${c.x},${c.y}`} position={[w.x, s * 0.28, w.z]} rotation={[0.2, c.y * 0.5, 0.1]} scale={[s, s * 0.45, s * 0.7]}>
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#3f3a36" roughness={0.97} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Blocking rock is cell-scale: Jezero cells are 25 m, and the rover stops two cells short. */
function Boulders({ map, cells }: { map: SimMap; cells: readonly Vec[] }) {
  const m = cellMetersOf(map);
  return (
    <group>
      {cells.map((c) => {
        const w = flatFromGrid(map, c.x + 0.5, c.y + 0.5);
        return (
          <mesh
            key={`${c.x},${c.y}`}
            position={[w.x, m * 0.16, w.z]}
            rotation={[0.12, 0.4, 0.06]}
            scale={[m * 0.42, m * 0.18, m * 0.3]}
          >
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color="#2f2c29" roughness={0.98} />
          </mesh>
        );
      })}
    </group>
  );
}

function RouteLine({
  points,
  color,
  opacity,
  width,
}: {
  points: THREE.Vector3[];
  color: number;
  opacity: number;
  width: number;
}) {
  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, Math.max(12, points.length * 3), width, 5, false);
  }, [points, width]);
  if (!geo) return null;
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function Rover({ map, pose }: { map: SimMap; pose: ReplayPose }) {
  const w = flatFromGrid(map, pose.x, pose.y);
  return (
    <group position={[w.x, 0.42, w.z]} rotation={[0, pose.heading, 0]}>
      <mesh position={[0, 0.28, 0]}>
        <boxGeometry args={[2.5, 0.55, 1.9]} />
        <meshStandardMaterial color="#b08968" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.95, -0.1]}>
        <boxGeometry args={[0.22, 0.85, 0.22]} />
        <meshStandardMaterial color="#6e5848" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.42, 0.12]}>
        <boxGeometry args={[0.45, 0.22, 0.55]} />
        <meshStandardMaterial color="#5a4a3e" roughness={0.55} />
      </mesh>
      {(
        [
          [-0.95, -0.12, 0.72],
          [0.95, -0.12, 0.72],
          [-0.95, -0.12, -0.72],
          [0.95, -0.12, -0.72],
          [0, -0.12, 0.85],
          [0, -0.12, -0.85],
        ] as const
      ).map((p, i) => (
        <mesh key={i} position={[p[0], p[1], p[2]]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.28, 0.28, 0.24, 10]} />
          <meshStandardMaterial color="#2d2824" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function RoverCamera({ map, pose, mode }: { map: SimMap; pose: ReplayPose; mode: 'chase' | 'fp' }) {
  const look = useRef(new THREE.Vector3());
  const ready = useRef(false);
  useFrame(({ camera }) => {
    const w = flatFromGrid(map, pose.x, pose.y);
    const fx = Math.sin(pose.heading);
    const fz = -Math.cos(pose.heading);
    const dest = new THREE.Vector3();
    const aim = new THREE.Vector3();
    if (mode === 'fp') {
      dest.set(w.x, 1.85, w.z);
      aim.set(w.x + fx * 40, 1.1, w.z + fz * 40);
    } else {
      dest.set(w.x - fx * 16, 5.8, w.z - fz * 16);
      aim.set(w.x + fx * 36, 1.2, w.z + fz * 36);
    }
    const a = ready.current ? 0.1 : 1;
    camera.position.lerp(dest, a);
    look.current.lerp(aim, a);
    camera.lookAt(look.current);
    ready.current = true;
  });
  return null;
}
