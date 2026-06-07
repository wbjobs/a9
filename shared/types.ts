export interface ObstacleData {
  id: string;
  type: 'circle' | 'line' | 'rect';
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface PerformanceStats {
  fps: number;
  particleCount: number;
  computeTime: number;
  renderTime: number;
  totalTime: number;
}

export interface SimulationParams {
  particleCount: number;
  smoothingRadius: number;
  restDensity: number;
  viscosity: number;
  pressureStiffness: number;
  gravityX: number;
  gravityY: number;
  damping: number;
  timeStep: number;
}

export interface Boundary {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface BaseMessage {
  type: string;
  timestamp: number;
}

export interface CreateRoomMessage extends BaseMessage {
  type: 'create_room';
  hostId: string;
}

export interface BroadcastStateMessage extends BaseMessage {
  type: 'broadcast_state';
  roomId: string;
  frame: number;
  particleCount: number;
  heightFieldData: number[];
  obstacleData: ObstacleData[];
  stats: PerformanceStats;
}

export interface ObstacleUpdateMessage extends BaseMessage {
  type: 'obstacle_update';
  roomId: string;
  obstacles: ObstacleData[];
}

export interface JoinRoomMessage extends BaseMessage {
  type: 'join_room';
  roomId: string;
  viewerId: string;
}

export interface RoomCreatedMessage extends BaseMessage {
  type: 'room_created';
  roomId: string;
  hostId: string;
}

export interface StateUpdateMessage extends BaseMessage {
  type: 'state_update';
  frame: number;
  particleCount: number;
  heightFieldData: number[];
  obstacleData: ObstacleData[];
  stats: PerformanceStats;
}

export interface ViewerJoinedMessage extends BaseMessage {
  type: 'viewer_joined';
  viewerId: string;
  viewerCount: number;
}

export interface ViewerLeftMessage extends BaseMessage {
  type: 'viewer_left';
  viewerId: string;
  viewerCount: number;
}

export interface ErrorMessage extends BaseMessage {
  type: 'error';
  message: string;
}

export type WebSocketMessage =
  | CreateRoomMessage
  | BroadcastStateMessage
  | ObstacleUpdateMessage
  | JoinRoomMessage
  | RoomCreatedMessage
  | StateUpdateMessage
  | ViewerJoinedMessage
  | ViewerLeftMessage
  | ErrorMessage;

export interface HeightField {
  width: number;
  height: number;
  data: Float32Array;
  normals: Float32Array;
}

export interface ParticleBuffers {
  position: Float32Array;
  velocity: Float32Array;
  density: Float32Array;
  pressure: Float32Array;
}

export interface Room {
  id: string;
  hostId: string;
  hostWs: WebSocket | null;
  viewers: Map<string, WebSocket>;
  viewerCount: number;
  latestState: BroadcastStateMessage | null;
  createdAt: number;
  lastActiveAt: number;
}

export type MultiplayerMode = 'solo' | 'host' | 'viewer';

export interface MultiplayerState {
  mode: MultiplayerMode;
  roomId: string | null;
  viewerCount: number;
  connected: boolean;
  error: string | null;
}
