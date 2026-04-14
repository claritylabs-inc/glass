"use client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { Canvas, useFrame, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";

type VectorPoint = {
  x: number;
  y: number;
  z: number;
  chunkType: string;
  policyId: string;
  carrier: string;
  policyNumber: string;
  text: string;
};

const CHUNK_COLORS: Record<string, string> = {
  carrier_info: "#3b82f6",
  named_insured: "#10b981",
  coverage: "#a855f7",
  endorsement: "#f59e0b",
  exclusion: "#f87171",
  condition: "#fb923c",
  section: "#94a3b8",
  declaration: "#14b8a6",
  loss_history: "#fb7185",
  premium: "#6366f1",
  supplementary: "#06b6d4",
};

const CHUNK_LABELS: Record<string, string> = {
  carrier_info: "Carrier Info",
  named_insured: "Named Insured",
  coverage: "Coverage",
  endorsement: "Endorsement",
  exclusion: "Exclusion",
  condition: "Condition",
  section: "Section",
  declaration: "Declaration",
  loss_history: "Loss History",
  premium: "Premium",
  supplementary: "Additional Details",
};

/** Instanced point cloud — uses meshBasicMaterial so colors are always visible */
function PointCloud({
  points,
  hoveredIndex,
  selectedType,
  onHover,
  onClick,
}: {
  points: VectorPoint[];
  hoveredIndex: number | null;
  selectedType: string | null;
  onHover: (index: number | null) => void;
  onClick: (index: number) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  // Initialize instance matrices and colors
  useEffect(() => {
    if (!meshRef.current) return;
    points.forEach((p, i) => {
      tempObj.position.set(p.x, p.y, p.z);
      tempObj.scale.setScalar(0.09);
      tempObj.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObj.matrix);
      tempColor.set(CHUNK_COLORS[p.chunkType] || "#94a3b8");
      meshRef.current!.setColorAt(i, tempColor);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [points, tempObj, tempColor]);

  useFrame(() => {
    if (!meshRef.current) return;
    let changed = false;
    points.forEach((p, i) => {
      const isFiltered = selectedType !== null && p.chunkType !== selectedType;
      const isHovered = hoveredIndex === i;
      const scale = isHovered ? 0.18 : isFiltered ? 0.04 : 0.09;

      tempObj.position.set(p.x, p.y, p.z);
      tempObj.scale.setScalar(scale);
      tempObj.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObj.matrix);

      tempColor.set(CHUNK_COLORS[p.chunkType] || "#94a3b8");
      if (isFiltered) {
        tempColor.multiplyScalar(0.3);
      } else if (isHovered) {
        tempColor.lerp(new THREE.Color("#ffffff"), 0.3);
      }
      meshRef.current!.setColorAt(i, tempColor);
      changed = true;
    });
    if (changed) {
      meshRef.current.instanceMatrix.needsUpdate = true;
      if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) onHover(e.instanceId);
  }, [onHover]);

  const handlePointerLeave = useCallback(() => onHover(null), [onHover]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) onClick(e.instanceId);
  }, [onClick]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, points.length]}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}

/** Build grid line positions for a single plane */
function buildGridPositions(axis1: number, axis2: number, fixed: number, count: number, size: number): Float32Array {
  const step = size / count;
  const half = size / 2;
  const segments: number[] = [];

  for (let i = 0; i <= count; i++) {
    const v = -half + i * step;
    // Line along axis2
    const a = [0, 0, 0, 0, 0, 0];
    a[axis1] = v; a[axis2] = -half; a[fixed] = 0;
    a[axis1 + 3] = v; a[axis2 + 3] = half; a[fixed + 3] = 0;
    segments.push(...a);
    // Line along axis1
    const b = [0, 0, 0, 0, 0, 0];
    b[axis1] = -half; b[axis2] = v; b[fixed] = 0;
    b[axis1 + 3] = half; b[axis2 + 3] = v; b[fixed + 3] = 0;
    segments.push(...b);
  }
  return new Float32Array(segments);
}

/** Axes with grid planes on XY, XZ, YZ */
function SceneHelpers({ dark }: { dark: boolean }) {
  const gridColor = dark ? "#ffffff" : "#000000";
  const gridOpacity = dark ? 0.04 : 0.06;
  const axisOpacity = dark ? 0.15 : 0.2;
  const size = 10;
  const divisions = 10;

  const xyGrid = useMemo(() => buildGridPositions(0, 1, 2, divisions, size), []);
  const xzGrid = useMemo(() => buildGridPositions(0, 2, 1, divisions, size), []);
  const yzGrid = useMemo(() => buildGridPositions(1, 2, 0, divisions, size), []);

  return (
    <group>
      {/* Grid planes */}
      {[xyGrid, xzGrid, yzGrid].map((positions, idx) => (
        <lineSegments key={idx}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={gridColor} opacity={gridOpacity} transparent />
        </lineSegments>
      ))}
      {/* Bold axis lines */}
      {[
        new Float32Array([-size/2,0,0, size/2,0,0]),
        new Float32Array([0,-size/2,0, 0,size/2,0]),
        new Float32Array([0,0,-size/2, 0,0,size/2]),
      ].map((positions, idx) => (
        <lineSegments key={`axis-${idx}`}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={gridColor} opacity={axisOpacity} transparent />
        </lineSegments>
      ))}
    </group>
  );
}

/** Tooltip label that follows the camera */
function HoverLabel({ point, dark }: { point: VectorPoint; dark: boolean }) {
  const { camera } = useThree();
  const textRef = useRef<any>(null);

  useFrame(() => {
    if (textRef.current) textRef.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group position={[point.x, point.y + 0.35, point.z]}>
      <Text
        ref={textRef}
        fontSize={0.15}
        color={dark ? "#999999" : "#888888"}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.02}
        outlineColor={dark ? "#000000" : "#ffffff"}
      >
        {point.carrier} · {point.policyNumber}
      </Text>
    </group>
  );
}

/** Sync scene background color with theme */
function SceneBackground({ dark }: { dark: boolean }) {
  const { scene } = useThree();
  useEffect(() => {
    scene.background = new THREE.Color(dark ? "#1a1816" : "#faf8f4");
  }, [dark, scene]);
  return null;
}

function Scene({
  points,
  hoveredIndex,
  selectedType,
  dark,
  onHover,
  onClick,
}: {
  points: VectorPoint[];
  hoveredIndex: number | null;
  selectedType: string | null;
  dark: boolean;
  onHover: (index: number | null) => void;
  onClick: (index: number) => void;
}) {
  return (
    <>
      <SceneBackground dark={dark} />
      <PointCloud
        points={points}
        hoveredIndex={hoveredIndex}
        selectedType={selectedType}
        onHover={onHover}
        onClick={onClick}
      />
      <SceneHelpers dark={dark} />
      {hoveredIndex !== null && points[hoveredIndex] && (
        <HoverLabel point={points[hoveredIndex]} dark={dark} />
      )}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        autoRotate
        autoRotateSpeed={0.3}
        minDistance={2}
        maxDistance={20}
        target={[0, 0, 0]}
      />
    </>
  );
}

export type VectorSpaceProps = {
  points: VectorPoint[];
  totalChunks: number;
};

export function VectorSpace({ points, totalChunks }: VectorSpaceProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  // Detect dark mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches || document.documentElement.classList.contains("dark"));
    const handler = () => setDark(mq.matches || document.documentElement.classList.contains("dark"));
    mq.addEventListener("change", handler);
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { mq.removeEventListener("change", handler); observer.disconnect(); };
  }, []);

  const chunkTypes = useMemo(() => {
    const types = new Map<string, number>();
    for (const p of points) {
      types.set(p.chunkType, (types.get(p.chunkType) || 0) + 1);
    }
    return [...types.entries()].sort((a, b) => b[1] - a[1]);
  }, [points]);

  const selected = selectedIndex !== null ? points[selectedIndex] : null;

  return (
    <div className="relative w-full rounded-lg border border-foreground/6 overflow-hidden bg-background" style={{ height: 520 }}>
      {/* Legend overlay */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-1.5 max-w-[80%]">
        {chunkTypes.map(([type, count]) => (
          <button
            key={type}
            type="button"
            onClick={() => setSelectedType(selectedType === type ? null : type)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all cursor-pointer backdrop-blur-sm ${
              selectedType === type
                ? dark ? "bg-white/25 text-white" : "bg-black/15 text-foreground"
                : selectedType
                  ? dark ? "bg-white/5 text-white/25" : "bg-black/[0.02] text-foreground/25"
                  : dark ? "bg-white/10 text-white/80 hover:bg-white/15" : "bg-black/[0.06] text-foreground/80 hover:bg-black/[0.1]"
            }`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: CHUNK_COLORS[type] || "#94a3b8" }}
            />
            {CHUNK_LABELS[type] || type}
            <span className={dark ? "text-white/30" : "text-foreground/30"}>{count}</span>
          </button>
        ))}
      </div>

      {/* Stats overlay */}
      <div className={`absolute top-3 right-3 z-10 text-[10px] font-mono ${dark ? "text-white/30" : "text-foreground/30"}`}>
        {totalChunks.toLocaleString()} vectors · 1536d → 3d PCA
      </div>
        <Canvas
          camera={{ position: [8, 4, 8], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          <Scene
            points={points}
            hoveredIndex={hoveredIndex}
            selectedType={selectedType}
            dark={dark}
            onHover={setHoveredIndex}
            onClick={setSelectedIndex}
          />
        </Canvas>

        {/* Selected point detail */}
        {selected && (
          <div className={`absolute bottom-4 left-4 z-10 backdrop-blur-md rounded-lg border px-4 py-3 max-w-sm ${
            dark ? "bg-black/70 border-white/10" : "bg-white/80 border-foreground/10"
          }`}>
            <div className="flex items-center gap-2.5 mb-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: CHUNK_COLORS[selected.chunkType] || "#94a3b8" }}
              />
              <span className={`text-body-sm font-medium ${dark ? "text-white" : "text-foreground"}`}>
                {CHUNK_LABELS[selected.chunkType] || selected.chunkType}
              </span>
            </div>
            <p className={`text-label-sm mb-1 ${dark ? "text-white/40" : "text-muted-foreground/50"}`}>
              {selected.carrier} · {selected.policyNumber}
            </p>
            <p className={`text-label-sm leading-relaxed line-clamp-2 ${dark ? "text-white/60" : "text-muted-foreground"}`}>
              {selected.text}
            </p>
            <button
              type="button"
              className={`absolute top-2.5 right-3 text-xs cursor-pointer ${dark ? "text-white/20 hover:text-white/50" : "text-foreground/20 hover:text-foreground/50"}`}
              onClick={() => setSelectedIndex(null)}
            >
              ✕
            </button>
          </div>
        )}
    </div>
  );
}
