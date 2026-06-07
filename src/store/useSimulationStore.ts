import { create } from 'zustand';
import type {
  SimulationParams,
  ObstacleData,
  PerformanceStats,
  MultiplayerState,
  MultiplayerMode,
} from '../../shared/types';

interface SimulationState {
  params: SimulationParams;
  obstacles: ObstacleData[];
  stats: PerformanceStats;
  isPaused: boolean;
  showParticles: boolean;
  showHeightField: boolean;
  isDrawingObstacle: boolean;
  obstacleType: 'circle' | 'line' | 'rect';
  obstacleRadius: number;
  multiplayer: MultiplayerState;
  setParams: (params: Partial<SimulationParams>) => void;
  addObstacle: (obstacle: ObstacleData) => void;
  removeObstacle: (id: string) => void;
  clearObstacles: () => void;
  setObstacles: (obstacles: ObstacleData[]) => void;
  updateStats: (stats: Partial<PerformanceStats>) => void;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  setShowParticles: (show: boolean) => void;
  setShowHeightField: (show: boolean) => void;
  setIsDrawingObstacle: (drawing: boolean) => void;
  setObstacleType: (type: 'circle' | 'line' | 'rect') => void;
  setObstacleRadius: (radius: number) => void;
  setMultiplayerMode: (mode: MultiplayerMode) => void;
  setRoomId: (roomId: string | null) => void;
  setViewerCount: (count: number) => void;
  setConnected: (connected: boolean) => void;
  setMultiplayerError: (error: string | null) => void;
  resetMultiplayer: () => void;
  reset: () => void;
}

const defaultParams: SimulationParams = {
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

const defaultStats: PerformanceStats = {
  fps: 0,
  particleCount: 0,
  computeTime: 0,
  renderTime: 0,
  totalTime: 0,
};

const defaultMultiplayer: MultiplayerState = {
  mode: 'solo',
  roomId: null,
  viewerCount: 0,
  connected: false,
  error: null,
};

export const useSimulationStore = create<SimulationState>((set, get) => ({
  params: defaultParams,
  obstacles: [],
  stats: defaultStats,
  isPaused: false,
  showParticles: true,
  showHeightField: true,
  isDrawingObstacle: false,
  obstacleType: 'circle',
  obstacleRadius: 30,
  multiplayer: defaultMultiplayer,

  setParams: (newParams) =>
    set((state) => ({
      params: { ...state.params, ...newParams },
    })),

  addObstacle: (obstacle) =>
    set((state) => ({
      obstacles: [...state.obstacles, obstacle],
    })),

  removeObstacle: (id) =>
    set((state) => ({
      obstacles: state.obstacles.filter((o) => o.id !== id),
    })),

  clearObstacles: () => set({ obstacles: [] }),

  setObstacles: (obstacles) => set({ obstacles }),

  updateStats: (newStats) =>
    set((state) => ({
      stats: { ...state.stats, ...newStats },
    })),

  setPaused: (paused) => set({ isPaused: paused }),

  togglePaused: () => set((state) => ({ isPaused: !state.isPaused })),

  setShowParticles: (show) => set({ showParticles: show }),

  setShowHeightField: (show) => set({ showHeightField: show }),

  setIsDrawingObstacle: (drawing) => set({ isDrawingObstacle: drawing }),

  setObstacleType: (type) => set({ obstacleType: type }),

  setObstacleRadius: (radius) => set({ obstacleRadius: radius }),

  setMultiplayerMode: (mode) =>
    set((state) => ({
      multiplayer: { ...state.multiplayer, mode },
    })),

  setRoomId: (roomId) =>
    set((state) => ({
      multiplayer: { ...state.multiplayer, roomId },
    })),

  setViewerCount: (count) =>
    set((state) => ({
      multiplayer: { ...state.multiplayer, viewerCount: count },
    })),

  setConnected: (connected) =>
    set((state) => ({
      multiplayer: { ...state.multiplayer, connected },
    })),

  setMultiplayerError: (error) =>
    set((state) => ({
      multiplayer: { ...state.multiplayer, error },
    })),

  resetMultiplayer: () => set({ multiplayer: defaultMultiplayer }),

  reset: () =>
    set({
      params: defaultParams,
      obstacles: [],
      isPaused: false,
    }),
}));
