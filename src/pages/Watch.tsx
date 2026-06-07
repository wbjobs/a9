import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Eye, Loader2, AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { useSimulationStore } from '@/store/useSimulationStore';
import { WebSocketClient } from '@/lib/network/WebSocketClient';
import { FluidScene } from '@/lib/render/FluidScene';
import PerformancePanel from '@/components/PerformancePanel';
import MultiplayerBar from '@/components/MultiplayerBar';
import type {
  StateUpdateMessage,
  ObstacleData,
  PerformanceStats,
} from '../../shared/types';

const MAX_HEIGHT = 50;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;
const INTERPOLATION_FPS = 60;

interface StateFrame {
  heightFieldData: Float32Array;
  obstacleData: ObstacleData[];
  stats: PerformanceStats;
  timestamp: number;
  frame: number;
}

interface StateUpdateMessageWithParticles extends StateUpdateMessage {
  particlePositions?: number[];
  particleCount: number;
}

function decompressHeightField(compressed: number[] | Uint16Array): Float32Array {
  const data = Array.isArray(compressed)
    ? new Uint16Array(compressed)
    : compressed;
  const result = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = (data[i] / 65535.0) * MAX_HEIGHT;
  }
  return result;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateHeightField(
  prev: Float32Array,
  current: Float32Array,
  t: number
): Float32Array {
  const result = new Float32Array(prev.length);
  for (let i = 0; i < prev.length; i++) {
    result[i] = lerp(prev[i], current[i], t);
  }
  return result;
}

function computeHeightFieldNormals(heightData: Float32Array): Float32Array {
  const resolution = Math.sqrt(heightData.length);
  const res = Math.floor(resolution);
  const normals = new Float32Array(heightData.length * 3);
  const cellSize = 1200 / (res - 1);

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const idx = y * res + x;

      const hL = x > 0 ? heightData[idx - 1] : heightData[idx];
      const hR = x < res - 1 ? heightData[idx + 1] : heightData[idx];
      const hD = y > 0 ? heightData[idx - res] : heightData[idx];
      const hU = y < res - 1 ? heightData[idx + res] : heightData[idx];

      const dhdx = (hR - hL) / (2 * cellSize);
      const dhdy = (hU - hD) / (2 * cellSize);

      const nx = -dhdx;
      const ny = -dhdy;
      const nz = 1;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const nIdx = idx * 3;
      normals[nIdx] = nx / len;
      normals[nIdx + 1] = nz / len;
      normals[nIdx + 2] = ny / len;
    }
  }

  return normals;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'room_not_found';

export default function Watch() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const wsClientRef = useRef<WebSocketClient | null>(null);
  const prevStateRef = useRef<StateFrame | null>(null);
  const currentStateRef = useRef<StateFrame | null>(null);
  const interpolatedDataRef = useRef<{
    heightField: Float32Array | null;
    normals: Float32Array | null;
  }>({ heightField: null, normals: null });
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionStatusRef = useRef<ConnectionStatus>('connecting');

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  const { updateStats, setMultiplayerMode, setRoomId, setViewerCount, setConnected, setMultiplayerError, resetMultiplayer } =
    useSimulationStore();

  const showParticles = useSimulationStore((state) => state.showParticles);
  const showHeightField = useSimulationStore((state) => state.showHeightField);

  const setConnectionStatusWithRef = useCallback((status: ConnectionStatus) => {
    connectionStatusRef.current = status;
    setConnectionStatus(status);
  }, []);

  const connectAndJoin = useCallback(async () => {
    if (!roomId) {
      setConnectionStatusWithRef('error');
      setErrorMessage('房间ID不能为空');
      return;
    }

    setConnectionStatusWithRef('connecting');
    setErrorMessage(null);

    try {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
      }

      const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
      const client = new WebSocketClient(wsUrl);
      wsClientRef.current = client;

      client.on('state_update', (message: StateUpdateMessage) => {
        const msg = message as StateUpdateMessageWithParticles;
        const heightField = decompressHeightField(message.heightFieldData);

        const newFrame: StateFrame = {
          heightFieldData: heightField,
          obstacleData: message.obstacleData,
          stats: message.stats,
          timestamp: Date.now(),
          frame: message.frame,
        };

        prevStateRef.current = currentStateRef.current;
        currentStateRef.current = newFrame;

        updateStats(message.stats);

        if (msg.particlePositions && msg.particleCount > 0) {
          console.debug('Received particle positions:', msg.particleCount);
        }

        if (connectionStatusRef.current !== 'connected') {
          setConnectionStatusWithRef('connected');
          setConnected(true);
          retryCountRef.current = 0;
        }
      });

      client.on('viewer_joined', (data: { viewerCount: number }) => {
        setViewerCount(data.viewerCount);
      });

      client.on('viewer_left', (data: { viewerCount: number }) => {
        setViewerCount(data.viewerCount);
      });

      client.on('error', (error: { message?: string } | Error) => {
        const message = error instanceof Error ? error.message : error.message || '未知错误';
        if (message.includes('房间不存在') || message.includes('room not found')) {
          setConnectionStatusWithRef('room_not_found');
          setErrorMessage('房间不存在或已关闭');
        } else {
          handleConnectionError(message);
        }
      });

      await client.connect();
      await client.joinRoom(roomId);

      setMultiplayerMode('viewer');
      setRoomId(roomId);
      setMultiplayerError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接失败';
      handleConnectionError(message);
    }
  }, [roomId, updateStats, setMultiplayerMode, setRoomId, setViewerCount, setConnected, setMultiplayerError, setConnectionStatusWithRef]);

  const handleConnectionError = useCallback((message: string) => {
    setErrorMessage(message);
    setMultiplayerError(message);

    if (retryCountRef.current < MAX_RETRY_ATTEMPTS) {
      retryCountRef.current++;
      setConnectionStatusWithRef('connecting');
      retryTimeoutRef.current = setTimeout(() => {
        connectAndJoin();
      }, RETRY_DELAY);
    } else {
      setConnectionStatusWithRef('error');
      setConnected(false);
    }
  }, [connectAndJoin, setConnected, setMultiplayerError, setConnectionStatusWithRef]);

  const handleRetry = useCallback(() => {
    retryCountRef.current = 0;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    connectAndJoin();
  }, [connectAndJoin]);

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const interpolationLoop = useCallback(() => {
    const current = currentStateRef.current;
    const prev = prevStateRef.current;

    if (current && prev) {
      const now = Date.now();
      const frameDuration = current.timestamp - prev.timestamp;
      let t = frameDuration > 0 ? (now - current.timestamp) / frameDuration + 1 : 1;
      t = Math.max(0, Math.min(1, t));

      const interpolatedHeight = interpolateHeightField(
        prev.heightFieldData,
        current.heightFieldData,
        t
      );
      const normals = computeHeightFieldNormals(interpolatedHeight);

      interpolatedDataRef.current = {
        heightField: interpolatedHeight,
        normals,
      };

      forceUpdate((n) => n + 1);
    } else if (current) {
      interpolatedDataRef.current = {
        heightField: current.heightFieldData,
        normals: computeHeightFieldNormals(current.heightFieldData),
      };
      forceUpdate((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    setMultiplayerMode('viewer');

    return () => {
      resetMultiplayer();
    };
  }, [setMultiplayerMode, resetMultiplayer]);

  useEffect(() => {
    connectAndJoin();

    return () => {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [connectAndJoin]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      interpolationLoop();
    }, 1000 / INTERPOLATION_FPS);

    return () => {
      clearInterval(intervalId);
    };
  }, [interpolationLoop]);

  const sceneData = useMemo(() => {
    return {
      heightFieldData: interpolatedDataRef.current.heightField,
      heightFieldNormals: interpolatedDataRef.current.normals,
      particlePositions: null,
    };
  }, [interpolatedDataRef.current.heightField, interpolatedDataRef.current.normals]);

  const renderLoading = () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0a1628] z-50">
      <div className="text-center">
        <Loader2 className="w-16 h-16 text-fluid-cyan animate-spin mx-auto mb-6" />
        <h2 className="text-2xl font-bold text-white mb-2">连接中...</h2>
        <p className="text-white/60 mb-4">正在加入房间 {roomId}</p>
        {retryCountRef.current > 0 && (
          <p className="text-yellow-400 text-sm">
            重试中 ({retryCountRef.current}/{MAX_RETRY_ATTEMPTS})
          </p>
        )}
      </div>
    </div>
  );

  const renderError = () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0a1628] z-50">
      <div className="glass-panel rounded-2xl p-8 max-w-md w-full mx-4 text-center">
        {connectionStatus === 'room_not_found' ? (
          <>
            <AlertTriangle className="w-16 h-16 text-yellow-400 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-white mb-2">房间不存在</h2>
            <p className="text-white/60 mb-6">
              房间 {roomId} 不存在或已关闭，请检查房间ID是否正确。
            </p>
          </>
        ) : (
          <>
            <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-white mb-2">连接失败</h2>
            <p className="text-white/60 mb-6">{errorMessage || '无法连接到服务器，请检查网络连接。'}</p>
          </>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
            返回首页
          </button>
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-fluid-cyan/20 text-fluid-cyan hover:bg-fluid-cyan/30 transition-all"
          >
            <RefreshCw className="w-5 h-5" />
            重新连接
          </button>
        </div>
      </div>
    </div>
  );

  const renderViewerBanner = () => (
    <div className="absolute top-0 left-0 right-0 z-20">
      <div className="bg-fluid-cyan/10 backdrop-blur-md border-b border-fluid-cyan/30 py-3 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-3">
          <Eye className="w-5 h-5 text-fluid-cyan" />
          <span className="text-fluid-cyan font-medium">观看模式</span>
          <span className="text-white/60 text-sm">当前只能观看，不能进行交互操作</span>
        </div>
      </div>
    </div>
  );

  if (connectionStatus === 'connecting') {
    return renderLoading();
  }

  if (connectionStatus === 'error' || connectionStatus === 'room_not_found') {
    return renderError();
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#0a1628]">
      {renderViewerBanner()}

      <div className="absolute inset-0 pt-12">
        <FluidScene
          particlePositions={sceneData.particlePositions}
          heightFieldData={sceneData.heightFieldData}
          heightFieldNormals={sceneData.heightFieldNormals}
          showParticles={showParticles}
          showHeightField={showHeightField}
          isViewerMode={true}
        />
      </div>

      <div className="absolute top-16 left-0 right-0 z-10 pointer-events-none">
        <div className="pointer-events-auto">
          <PerformancePanel />
        </div>
      </div>

      <MultiplayerBar />

      <button
        onClick={handleBack}
        className="absolute top-16 right-4 z-20 glass-panel rounded-lg px-4 py-2 text-white/70 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">返回</span>
      </button>
    </div>
  );
}
