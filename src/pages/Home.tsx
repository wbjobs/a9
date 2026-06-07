import { useRef, useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useSimulationStore } from '@/store/useSimulationStore';
import { SPHSimulator } from '@/lib/webgpu/SPHSimulator';
import { WebSocketClient } from '@/lib/network/WebSocketClient';
import { FluidScene } from '@/lib/render/FluidScene';
import PerformancePanel from '@/components/PerformancePanel';
import ControlPanel from '@/components/ControlPanel';
import MultiplayerBar from '@/components/MultiplayerBar';
import ObstacleCanvas from '@/components/ObstacleCanvas';
import type {
  ObstacleData,
  HeightField,
  BroadcastStateMessage,
  ViewerJoinedMessage,
  ViewerLeftMessage,
  ErrorMessage,
} from '../../shared/types';

const SIM_WIDTH = 1200;
const SIM_HEIGHT = 800;
const MAX_RENDER_PARTICLES = 10000;
const SUBSTEPS_PER_FRAME = 2;
const BROADCAST_FPS = 30;
const POSITION_READ_INTERVAL = 2;

type WebGPUStatus = 'checking' | 'unsupported' | 'initializing' | 'ready' | 'error';

type PresetScene = 'dam' | 'calm' | 'stir';

export default function Home() {
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);
  const simulatorRef = useRef<SPHSimulator | null>(null);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const fpsHistoryRef = useRef<number[]>([]);
  const frameCountRef = useRef<number>(0);
  const broadcastFrameCountRef = useRef<number>(0);
  const lastBroadcastTimeRef = useRef<number>(0);

  const [webgpuStatus, setWebgpuStatus] = useState<WebGPUStatus>('checking');
  const [webgpuError, setWebgpuError] = useState<string | null>(null);
  const [initProgress, setInitProgress] = useState<number>(0);

  const [particlePositions, setParticlePositions] = useState<Float32Array | null>(null);
  const [heightFieldData, setHeightFieldData] = useState<Float32Array | null>(null);
  const [heightFieldNormals, setHeightFieldNormals] = useState<Float32Array | null>(null);

  const {
    params,
    obstacles,
    isPaused,
    showParticles,
    showHeightField,
    multiplayer,
    updateStats,
    setViewerCount,
    setConnected,
    setMultiplayerError,
    setRoomId,
    setMultiplayerMode,
    resetMultiplayer,
  } = useSimulationStore();

  const checkWebGPUSupport = useCallback((): boolean => {
    if (!navigator.gpu) {
      setWebgpuStatus('unsupported');
      setWebgpuError('您的浏览器不支持 WebGPU。请使用最新版本的 Chrome、Edge 或 Safari 浏览器。');
      return false;
    }
    return true;
  }, []);

  const initSimulator = useCallback(async () => {
    if (!checkWebGPUSupport()) return;
    if (!hiddenCanvasRef.current) return;

    setWebgpuStatus('initializing');
    setInitProgress(10);

    try {
      const simulator = new SPHSimulator(hiddenCanvasRef.current);
      setInitProgress(30);

      await simulator.init(params);
      setInitProgress(70);

      simulatorRef.current = simulator;
      simulator.updateObstacles(obstacles);
      setInitProgress(100);

      setWebgpuStatus('ready');
    } catch (error) {
      console.error('Failed to initialize simulator:', error);
      setWebgpuStatus('error');
      setWebgpuError(error instanceof Error ? error.message : 'WebGPU 初始化失败');
    }
  }, [checkWebGPUSupport, params, obstacles]);

  const initParticlesWithPreset = useCallback((preset: PresetScene) => {
    if (!hiddenCanvasRef.current) return;

    const canvas = document.createElement('canvas');
    const simulator = new SPHSimulator(canvas);

    const initParticleData = (sim: SPHSimulator, scenePreset: PresetScene) => {
      const particleCount = params.particleCount;
      const positions = new Float32Array(particleCount * 2);
      const velocities = new Float32Array(particleCount * 2);

      const margin = 50;

      switch (scenePreset) {
        case 'dam': {
          const damWidth = (SIM_WIDTH - margin * 2) * 0.3;
          const damHeight = (SIM_HEIGHT - margin * 2) * 0.8;
          const particlesPerRow = Math.ceil(Math.sqrt(particleCount * (damWidth / damHeight)));
          const particlesPerCol = Math.ceil(particleCount / particlesPerRow);
          const spacingX = damWidth / particlesPerRow;
          const spacingY = damHeight / particlesPerCol;

          let idx = 0;
          for (let row = 0; row < particlesPerRow && idx < particleCount; row++) {
            for (let col = 0; col < particlesPerCol && idx < particleCount; col++) {
              positions[idx * 2] = margin + row * spacingX + (Math.random() - 0.5) * 2;
              positions[idx * 2 + 1] = margin + col * spacingY + (Math.random() - 0.5) * 2;
              velocities[idx * 2] = 0;
              velocities[idx * 2 + 1] = 0;
              idx++;
            }
          }
          break;
        }
        case 'calm': {
          const width = SIM_WIDTH - margin * 2;
          const height = (SIM_HEIGHT - margin * 2) * 0.6;
          const particlesPerRow = Math.ceil(Math.sqrt(particleCount * (width / height)));
          const particlesPerCol = Math.ceil(particleCount / particlesPerRow);
          const spacingX = width / particlesPerRow;
          const spacingY = height / particlesPerCol;

          let idx = 0;
          for (let row = 0; row < particlesPerRow && idx < particleCount; row++) {
            for (let col = 0; col < particlesPerCol && idx < particleCount; col++) {
              positions[idx * 2] = margin + row * spacingX + (Math.random() - 0.5) * 1;
              positions[idx * 2 + 1] = margin + col * spacingY + (Math.random() - 0.5) * 1;
              velocities[idx * 2] = (Math.random() - 0.5) * 5;
              velocities[idx * 2 + 1] = (Math.random() - 0.5) * 5;
              idx++;
            }
          }
          break;
        }
        case 'stir': {
          const centerX = SIM_WIDTH / 2;
          const centerY = SIM_HEIGHT / 2;
          const maxRadius = Math.min(SIM_WIDTH, SIM_HEIGHT) * 0.4;

          for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.sqrt(Math.random()) * maxRadius;

            positions[i * 2] = centerX + Math.cos(angle) * radius;
            positions[i * 2 + 1] = centerY + Math.sin(angle) * radius;

            const tangentAngle = angle + Math.PI / 2;
            const speed = radius * 2;
            velocities[i * 2] = Math.cos(tangentAngle) * speed;
            velocities[i * 2 + 1] = Math.sin(tangentAngle) * speed;
          }
          break;
        }
      }

      const device = sim.getDevice();
      const buffers = (sim as unknown as { buffers: { positions: [GPUBuffer, GPUBuffer]; velocities: [GPUBuffer, GPUBuffer] } }).buffers;

      const writeBuffer = (buffer: GPUBuffer, data: Float32Array) => {
        const stagingBuffer = device.createBuffer({
          size: data.byteLength,
          usage: GPUBufferUsage.COPY_SRC,
          mappedAtCreation: true,
        });
        new Float32Array(stagingBuffer.getMappedRange()).set(data);
        stagingBuffer.unmap();

        const commandEncoder = device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(stagingBuffer, 0, buffer, 0, data.byteLength);
        device.queue.submit([commandEncoder.finish()]);
      };

      writeBuffer(buffers.positions[0], positions);
      writeBuffer(buffers.positions[1], positions);
      writeBuffer(buffers.velocities[0], velocities);
      writeBuffer(buffers.velocities[1], velocities);
    };

    simulator.init(params).then(() => {
      initParticleData(simulator, preset);
      simulatorRef.current = simulator;
      simulator.updateObstacles(obstacles);
    });
  }, [params, obstacles]);

  const handleReset = useCallback((preset?: PresetScene) => {
    if (preset) {
      initParticlesWithPreset(preset);
    } else {
      initSimulator();
    }
    frameCountRef.current = 0;
  }, [initSimulator, initParticlesWithPreset]);

  const handleCreateRoom = useCallback(async () => {
    try {
      const wsUrl = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3001`;
      const client = new WebSocketClient(wsUrl);

      await client.connect();

      const handleViewerJoined = (message: ViewerJoinedMessage) => {
        setViewerCount(message.viewerCount);
      };

      const handleViewerLeft = (message: ViewerLeftMessage) => {
        setViewerCount(message.viewerCount);
      };

      const handleError = (message: ErrorMessage) => {
        setMultiplayerError(message.message);
      };

      client.on('viewer_joined', handleViewerJoined as unknown as (...args: unknown[]) => void);
      client.on('viewer_left', handleViewerLeft as unknown as (...args: unknown[]) => void);
      client.on('error', handleError as unknown as (...args: unknown[]) => void);

      const roomId = await client.createRoom();

      wsClientRef.current = client;
      setMultiplayerMode('host');
      setRoomId(roomId);
      setConnected(true);
      setViewerCount(0);
    } catch (error) {
      console.error('Failed to create room:', error);
      setMultiplayerError(error instanceof Error ? error.message : '创建房间失败');
      resetMultiplayer();
    }
  }, [setMultiplayerMode, setRoomId, setConnected, setViewerCount, setMultiplayerError, resetMultiplayer]);

  const handleLeaveRoom = useCallback(() => {
    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }
    resetMultiplayer();
  }, [resetMultiplayer]);

  const broadcastState = useCallback((state: Omit<BroadcastStateMessage, 'type' | 'timestamp'>) => {
    if (wsClientRef.current && multiplayer.mode === 'host') {
      wsClientRef.current.broadcastState(state);
    }
  }, [multiplayer.mode]);

  const broadcastObstacles = useCallback((obs: ObstacleData[]) => {
    if (wsClientRef.current && multiplayer.mode === 'host') {
      wsClientRef.current.broadcastObstacles(obs);
    }
  }, [multiplayer.mode]);

  const simulationLoop = useCallback(async (timestamp: number) => {
    if (!simulatorRef.current || webgpuStatus !== 'ready') {
      animationFrameRef.current = requestAnimationFrame(simulationLoop);
      return;
    }

    const deltaTime = timestamp - lastFrameTimeRef.current;
    lastFrameTimeRef.current = timestamp;

    if (deltaTime > 0) {
      const instantFps = 1000 / deltaTime;
      fpsHistoryRef.current.push(instantFps);
      if (fpsHistoryRef.current.length > 30) {
        fpsHistoryRef.current.shift();
      }
      const avgFps = fpsHistoryRef.current.reduce((a, b) => a + b, 0) / fpsHistoryRef.current.length;

      const startTime = performance.now();
      let computeTime = 0;
      let renderTime = 0;

      if (!isPaused) {
        const computeStart = performance.now();
        for (let i = 0; i < SUBSTEPS_PER_FRAME; i++) {
          await simulatorRef.current.step();
        }
        computeTime = (performance.now() - computeStart) / SUBSTEPS_PER_FRAME;

        frameCountRef.current++;

        if (frameCountRef.current % POSITION_READ_INTERVAL === 0) {
          const readStart = performance.now();
          const positions = await simulatorRef.current.getPositions();
          const displayCount = Math.min(positions.length / 2, MAX_RENDER_PARTICLES);
          const displayPositions = new Float32Array(displayCount * 2);
          const step = Math.floor(positions.length / 2 / displayCount);

          for (let i = 0; i < displayCount; i++) {
            const srcIdx = i * step * 2;
            displayPositions[i * 2] = positions[srcIdx];
            displayPositions[i * 2 + 1] = positions[srcIdx + 1];
          }
          setParticlePositions(displayPositions);
          computeTime += (performance.now() - readStart) / 2;
        }

        const heightFieldStart = performance.now();
        const heightField: HeightField = await simulatorRef.current.getHeightField();
        setHeightFieldData(heightField.data);
        setHeightFieldNormals(heightField.normals);
        renderTime = performance.now() - heightFieldStart;
      }

      const totalTime = performance.now() - startTime;

      updateStats({
        fps: avgFps,
        particleCount: params.particleCount,
        computeTime,
        renderTime,
        totalTime,
      });

      if (multiplayer.mode === 'host' && heightFieldData) {
        const broadcastInterval = 1000 / BROADCAST_FPS;
        if (timestamp - lastBroadcastTimeRef.current >= broadcastInterval) {
          broadcastFrameCountRef.current++;

          const hfData = Array.from(heightFieldData);
          broadcastState({
            roomId: multiplayer.roomId!,
            frame: broadcastFrameCountRef.current,
            particleCount: params.particleCount,
            heightFieldData: hfData,
            obstacleData: obstacles,
            stats: {
              fps: avgFps,
              particleCount: params.particleCount,
              computeTime,
              renderTime,
              totalTime,
            },
          });

          lastBroadcastTimeRef.current = timestamp;
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(simulationLoop);
  }, [webgpuStatus, isPaused, params.particleCount, multiplayer, heightFieldData, obstacles, updateStats, broadcastState]);

  useEffect(() => {
    checkWebGPUSupport();
  }, [checkWebGPUSupport]);

  useEffect(() => {
    if (webgpuStatus === 'checking' && navigator.gpu) {
      initSimulator();
    }
  }, [webgpuStatus, initSimulator]);

  useEffect(() => {
    if (webgpuStatus === 'ready') {
      lastFrameTimeRef.current = performance.now();
      animationFrameRef.current = requestAnimationFrame(simulationLoop);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [webgpuStatus, simulationLoop]);

  useEffect(() => {
    if (simulatorRef.current && webgpuStatus === 'ready') {
      simulatorRef.current.updateParams(params);
    }
  }, [params, webgpuStatus]);

  useEffect(() => {
    if (simulatorRef.current && webgpuStatus === 'ready') {
      simulatorRef.current.updateObstacles(obstacles);
      broadcastObstacles(obstacles);
    }
  }, [obstacles, webgpuStatus, broadcastObstacles]);

  useEffect(() => {
    const handleMultiplayerChange = () => {
      const state = useSimulationStore.getState();
      if (state.multiplayer.mode === 'host' && !state.multiplayer.connected) {
        handleCreateRoom();
      } else if (state.multiplayer.mode === 'solo' && state.multiplayer.connected) {
        handleLeaveRoom();
      }
    };

    const unsubscribe = useSimulationStore.subscribe(handleMultiplayerChange);
    return unsubscribe;
  }, [handleCreateRoom, handleLeaveRoom]);

  const prevStateRef = useRef({
    params: { ...params },
    obstaclesLength: obstacles.length,
    isPaused: isPaused,
  });

  useEffect(() => {
    const defaultParams = {
      particleCount: 100000,
      smoothingRadius: 25,
      restDensity: 1000,
      viscosity: 0.01,
      pressureStiffness: 200,
      gravityX: 0,
      gravityY: 980,
      damping: 0.998,
      timeStep: 0.0008,
    };

    const checkReset = () => {
      const state = useSimulationStore.getState();
      const prev = prevStateRef.current;

      const isParticleCountChanged = state.params.particleCount !== prev.params.particleCount;
      const isSmoothingRadiusChanged = state.params.smoothingRadius !== prev.params.smoothingRadius;

      if (isParticleCountChanged || isSmoothingRadiusChanged) {
        handleReset();
        prevStateRef.current = {
          params: { ...state.params },
          obstaclesLength: state.obstacles.length,
          isPaused: state.isPaused,
        };
        return;
      }

      const isAllParamsDefault = Object.entries(defaultParams).every(
        ([key, value]) => state.params[key as keyof typeof state.params] === value
      );
      const wasParamsNotDefault = !Object.entries(defaultParams).every(
        ([key, value]) => prev.params[key as keyof typeof prev.params] === value
      );
      const isObstaclesCleared = state.obstacles.length === 0 && prev.obstaclesLength > 0;
      const isPausedChangedToFalse = state.isPaused === false && prev.isPaused === true;

      if (isAllParamsDefault && wasParamsNotDefault && isObstaclesCleared && isPausedChangedToFalse) {
        handleReset();
      }

      prevStateRef.current = {
        params: { ...state.params },
        obstaclesLength: state.obstacles.length,
        isPaused: state.isPaused,
      };
    };

    const unsubscribe = useSimulationStore.subscribe(checkReset);
    return unsubscribe;
  }, [handleReset]);

  if (webgpuStatus === 'unsupported' || webgpuStatus === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
        <div className="glass-panel rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">
            {webgpuStatus === 'unsupported' ? 'WebGPU 不支持' : '初始化失败'}
          </h2>
          <p className="text-white/70 mb-6">{webgpuError}</p>
          <div className="space-y-3 text-left bg-white/5 rounded-lg p-4 mb-6">
            <p className="text-sm text-white/60">请尝试以下解决方案：</p>
            <ul className="text-sm text-white/50 space-y-1 list-disc list-inside">
              <li>使用 Chrome 113+ 或 Edge 113+ 浏览器</li>
              <li>在 chrome://flags 中启用 WebGPU</li>
              <li>确保您的显卡支持 Vulkan/Metal/D3D12</li>
              <li>更新显卡驱动程序</li>
            </ul>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full px-6 py-3 bg-fluid-cyan/20 text-fluid-cyan border border-fluid-cyan/30 rounded-lg hover:bg-fluid-cyan/30 transition-colors"
          >
            重新尝试
          </button>
        </div>
      </div>
    );
  }

  if (webgpuStatus === 'checking' || webgpuStatus === 'initializing') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
        <div className="glass-panel rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-fluid-cyan/20 flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-8 h-8 text-fluid-cyan animate-spin" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">
            {webgpuStatus === 'checking' ? '检测 WebGPU 支持' : '初始化仿真引擎'}
          </h2>
          <p className="text-white/70 mb-6">
            {webgpuStatus === 'checking'
              ? '正在检查浏览器 WebGPU 支持...'
              : '正在加载 SPH 流体仿真器，请稍候...'}
          </p>
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-fluid-cyan to-fluid-purple transition-all duration-300"
              style={{ width: `${initProgress}%` }}
            />
          </div>
          <p className="text-sm text-white/50">{initProgress}%</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <canvas
          ref={hiddenCanvasRef}
          width={SIM_WIDTH}
          height={SIM_HEIGHT}
          className="hidden"
        />

        <div className="absolute inset-0">
          <FluidScene
            particlePositions={particlePositions}
            heightFieldData={heightFieldData}
            heightFieldNormals={heightFieldNormals}
            showParticles={showParticles}
            showHeightField={showHeightField}
            isViewerMode={false}
          />
        </div>

        <ObstacleCanvas />

        <PerformancePanel />
        <ControlPanel />
        <MultiplayerBar />

        {isPaused && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="glass-panel rounded-xl px-8 py-4 text-center">
              <p className="text-2xl font-bold text-white/90">已暂停</p>
              <p className="text-sm text-white/50 mt-1">点击播放按钮继续</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
