import { Canvas, useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import reliefUrl from '../../../shared/mars/jezero-relief.png';
import type { SimMap, Vec } from '../sim/types';
import {
  HAZARD_AMBER,
  MARS_FOG,
  MARS_SKY,
  PLOT_BLUE,
  buildTerrainGeometry,
  cellMetersOf,
  mappedRocks,
  pathPoints,
  nearPebbles,
  sandCells,
  worldFromGrid,
} from './terrain';

export interface RoverPose {
  x: number;
  y: number;
  heading: number;
}

interface RoverViewProps {
  map: SimMap;
  pose: RoverPose;
  path: readonly Vec[];
  boulders: readonly Vec[];
}

/** Perseverance mast-cam height, metres. */
const MAST = 2.05;
/** Look this many metres along the remaining plan. */
const LOOK_AHEAD = 12;

function lookAlongPath(map: SimMap, pose: RoverPose, _path: readonly Vec[]): THREE.Vector3 {
  const m = cellMetersOf(map);
  const sin = Math.sin(pose.heading);
  const cos = Math.cos(pose.heading);
  const gx = pose.x + sin * (LOOK_AHEAD / m);
  const gy = pose.y - cos * (LOOK_AHEAD / m);
  const w = worldFromGrid(map, gx, gy);
  return new THREE.Vector3(w.x, w.y + 0.08, w.z);
}

function makeDustTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c9a16c';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const n = Math.random();
    ctx.fillStyle = `rgba(${150 + n * 70},${100 + n * 50},${55 + n * 30},${0.28 + n * 0.25})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + n * 2.2, 1 + n * 2.2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Terrain({ map }: { map: SimMap }) {
  const geo = useMemo(() => buildTerrainGeometry(map), [map]);
  const dust = useMemo(() => makeDustTexture(), []);
  const [relief, setRelief] = useState<THREE.Texture | null>(null);
  const jezero = map.source?.id === 'DTEEC_048842_1985_048908_1985_U01';
  useLayoutEffect(() => {
    if (!jezero) return;
    const loader = new THREE.TextureLoader();
    loader.load(reliefUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      setRelief(tex);
    });
  }, [jezero]);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial
        vertexColors
        map={dust}
        bumpMap={relief ?? undefined}
        bumpScale={2.4}
        roughness={0.97}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Sand({ map }: { map: SimMap }) {
  const cells = useMemo(() => sandCells(map), [map]);
  const m = cellMetersOf(map);
  return (
    <group>
      {cells.map((c) => {
        const w = worldFromGrid(map, c.x + 0.5, c.y + 0.5);
        return (
          <mesh key={`${c.x},${c.y}`} position={[w.x, w.y + 0.06, w.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[m * 0.92, m * 0.92]} />
            <meshStandardMaterial color={HAZARD_AMBER} transparent opacity={0.38} roughness={1} />
          </mesh>
        );
      })}
    </group>
  );
}

function Pebbles({ map, pose }: { map: SimMap; pose: RoverPose }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const cellX = Math.floor(pose.x);
  const cellY = Math.floor(pose.y);
  const layout = useMemo(() => nearPebbles(map, cellX, cellY), [map, cellX, cellY]);
  useLayoutEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    const dummy = new THREE.Object3D();
    layout.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, 0.1);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
  }, [layout]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, layout.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#8d6b48" roughness={0.96} flatShading />
    </instancedMesh>
  );
}

function Rocks({ map, extras }: { map: SimMap; extras: readonly Vec[] }) {
  const cells = useMemo(() => {
    const seen = new Set<string>();
    const all: Vec[] = [];
    for (const p of [...mappedRocks(map), ...extras]) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(p);
    }
    return all;
  }, [map, extras]);
  return (
    <group>
      {cells.map((c) => {
        const w = worldFromGrid(map, c.x + 0.5, c.y + 0.5);
        const s = 0.85 + ((c.x * 13 + c.y * 7) % 5) * 0.22;
        return (
          <mesh key={`${c.x},${c.y}`} position={[w.x, w.y + s * 0.38, w.z]} rotation={[c.x * 0.3, c.y * 0.5, 0.15]} castShadow>
            <icosahedronGeometry args={[s, 1]} />
            <meshStandardMaterial color="#6a5340" roughness={0.92} flatShading />
          </mesh>
        );
      })}
    </group>
  );
}

function Route({ map, path, from }: { map: SimMap; path: readonly Vec[]; from: RoverPose }) {
  const object = useMemo(() => {
    const pts = pathPoints(map, path, from);
    if (pts.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), 0.28, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: PLOT_BLUE, transparent: true, opacity: 0.55 });
    return new THREE.Mesh(geo, mat);
  }, [map, path, from]);
  if (!object) return null;
  return <primitive object={object} />;
}

function MastCam({ map, pose, path }: { map: SimMap; pose: RoverPose; path: readonly Vec[] }) {
  const eye = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  useFrame(({ camera }) => {
    const w = worldFromGrid(map, pose.x, pose.y);
    eye.current.set(w.x, w.y + MAST, w.z);
    look.current.copy(lookAlongPath(map, pose, path));
    camera.position.lerp(eye.current, 0.22);
    camera.lookAt(look.current);
  });
  return null;
}

function Scene({ map, pose, path, boulders }: RoverViewProps) {
  return (
    <>
      <color attach="background" args={[MARS_SKY]} />
      <fog attach="fog" args={[MARS_FOG, 28, 220]} />
      <hemisphereLight args={['#fff1dc', '#7a5a3a', 0.85]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        position={[-80, 42, 30]}
        intensity={1.9}
        color="#ffc48a"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Terrain map={map} />
      <Sand map={map} />
      <Pebbles map={map} pose={pose} />
      <Rocks map={map} extras={boulders} />
      <Route map={map} path={path} from={pose} />
      <MastCam map={map} pose={pose} path={path} />
    </>
  );
}

export function RoverView({ map, pose, path, boulders }: RoverViewProps) {
  const start = worldFromGrid(map, pose.x, pose.y);
  return (
    <Canvas
      shadows
      camera={{ fov: 62, near: 0.12, far: 700, position: [start.x, start.y + MAST, start.z] }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Scene map={map} pose={pose} path={path} boulders={boulders} />
    </Canvas>
  );
}
