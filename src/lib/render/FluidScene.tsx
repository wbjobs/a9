import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

interface FluidSceneProps {
  particlePositions: Float32Array | null;
  heightFieldData: Float32Array | null;
  heightFieldNormals: Float32Array | null;
  showParticles: boolean;
  showHeightField: boolean;
  isViewerMode: boolean;
}

const SIM_WIDTH = 1200;
const SIM_HEIGHT = 800;
const SCENE_WIDTH = 12;
const SCENE_HEIGHT = 8;

function ParticleSystem({
  positions,
  show,
}: {
  positions: Float32Array | null;
  show: boolean;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const prevPositions = useRef<Float32Array | null>(null);

  const geometry = useMemo(() => {
    const maxParticles = 5000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(maxParticles), 1));
    return geo;
  }, []);

  useFrame(() => {
    if (!pointsRef.current || !positions) return;

    const posAttr = pointsRef.current.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    const colorAttr = pointsRef.current.geometry.getAttribute(
      'color'
    ) as THREE.BufferAttribute;
    const sizeAttr = pointsRef.current.geometry.getAttribute(
      'size'
    ) as THREE.BufferAttribute;

    const posArray = posAttr.array as Float32Array;
    const colorArray = colorAttr.array as Float32Array;
    const sizeArray = sizeAttr.array as Float32Array;

    const particleCount = Math.floor(positions.length / 2);

    for (let i = 0; i < particleCount; i++) {
      const simX = positions[i * 2];
      const simY = positions[i * 2 + 1];

      const x = (simX / SIM_WIDTH) * SCENE_WIDTH - SCENE_WIDTH / 2;
      const z = (simY / SIM_HEIGHT) * SCENE_HEIGHT - SCENE_HEIGHT / 2;
      const y = 0.1;

      posArray[i * 3] = x;
      posArray[i * 3 + 1] = y;
      posArray[i * 3 + 2] = z;

      let speed = 0;
      if (prevPositions.current && i * 2 + 1 < prevPositions.current.length) {
        const dx = simX - prevPositions.current[i * 2];
        const dy = simY - prevPositions.current[i * 2 + 1];
        speed = Math.sqrt(dx * dx + dy * dy);
      }

      const t = Math.min(speed / 10, 1);
      colorArray[i * 3] = 0 + t * 0.2;
      colorArray[i * 3 + 1] = 0.8 + t * 0.2;
      colorArray[i * 3 + 2] = 1 - t * 0.5;

      sizeArray[i] = 0.08 + t * 0.15;
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    pointsRef.current.geometry.setDrawRange(0, particleCount);

    prevPositions.current = new Float32Array(positions);
  });

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
      },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          vec2 center = gl_PointCoord - 0.5;
          float dist = length(center);
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
          gl_FragColor = vec4(vColor, alpha * 0.9);
        }
      `,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  if (!show) return null;
  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

function HeightFieldMesh({
  heightData,
  normalsData,
  show,
}: {
  heightData: Float32Array | null;
  normalsData: Float32Array | null;
  show: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    if (!heightData) return new THREE.PlaneGeometry(SCENE_WIDTH, SCENE_HEIGHT, 1, 1);
    const resolution = Math.sqrt(heightData.length);
    const res = Math.floor(resolution) - 1;
    const geo = new THREE.PlaneGeometry(SCENE_WIDTH, SCENE_HEIGHT, res, res);
    geo.rotateX(-Math.PI / 2);
    return geo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightData?.length]);

  useEffect(() => {
    if (!meshRef.current || !heightData) return;

    const positions = meshRef.current.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    const posArray = positions.array as Float32Array;

    const colors = new Float32Array(posArray.length);
    const colorAttr = new THREE.BufferAttribute(colors, 3);
    meshRef.current.geometry.setAttribute('color', colorAttr);

    for (let i = 0; i < heightData.length; i++) {
      const zIdx = i * 3 + 2;
      if (zIdx < posArray.length) {
        posArray[zIdx] = heightData[i] * 2;

        const t = Math.min(heightData[i] / 50, 1);
        colors[i * 3] = 0.1 + t * 0.3;
        colors[i * 3 + 1] = 0.3 + t * 0.4;
        colors[i * 3 + 2] = 0.6 + t * 0.4;
      }
    }

    positions.needsUpdate = true;
    colorAttr.needsUpdate = true;
    meshRef.current.geometry.computeVertexNormals();

    if (normalsData) {
      const normalAttr = meshRef.current.geometry.getAttribute(
        'normal'
      ) as THREE.BufferAttribute;
      const normalArray = normalAttr.array as Float32Array;
      for (let i = 0; i < normalsData.length && i < normalArray.length; i++) {
        normalArray[i] = normalsData[i];
      }
      normalAttr.needsUpdate = true;
    }
  }, [heightData, normalsData]);

  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      wireframe: true,
      transparent: true,
      opacity: 0.6,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
  }, []);

  if (!show || !heightData) return null;
  return <mesh ref={meshRef} geometry={geometry} material={material} receiveShadow />;
}

function SceneContent({
  particlePositions,
  heightFieldData,
  heightFieldNormals,
  showParticles,
  showHeightField,
}: Omit<FluidSceneProps, 'isViewerMode'>) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[10, 20, 10]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[20, 15]} />
        <meshStandardMaterial color="#0a1628" />
      </mesh>
      <gridHelper args={[20, 20, '#1a3658', '#0f2840']} position={[0, 0.01, 0]} />
      <ParticleSystem positions={particlePositions} show={showParticles} />
      <HeightFieldMesh
        heightData={heightFieldData}
        normalsData={heightFieldNormals}
        show={showHeightField}
      />
      <EffectComposer>
        <Bloom intensity={0.8} luminanceThreshold={0.2} mipmapBlur />
        <Vignette offset={0.3} darkness={0.6} />
      </EffectComposer>
    </>
  );
}

function CameraSetup({ isViewerMode }: { isViewerMode: boolean }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 15, 15);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.05}
      minDistance={5}
      maxDistance={40}
      maxPolarAngle={Math.PI / 2.1}
      enabled={isViewerMode}
    />
  );
}

export function FluidScene({
  particlePositions,
  heightFieldData,
  heightFieldNormals,
  showParticles,
  showHeightField,
  isViewerMode,
}: FluidSceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 15, 15], fov: 50 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#0a1628' }}
    >
      <CameraSetup isViewerMode={isViewerMode} />
      <SceneContent
        particlePositions={particlePositions}
        heightFieldData={heightFieldData}
        heightFieldNormals={heightFieldNormals}
        showParticles={showParticles}
        showHeightField={showHeightField}
      />
    </Canvas>
  );
}
