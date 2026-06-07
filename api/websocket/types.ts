import type { WebSocket } from 'ws'
import type {
  ObstacleData,
  PerformanceStats,
  BroadcastStateMessage,
  ObstacleUpdateMessage,
  CreateRoomMessage,
  JoinRoomMessage,
  RoomCreatedMessage,
  StateUpdateMessage,
  ViewerJoinedMessage,
  ViewerLeftMessage,
  ErrorMessage,
  WebSocketMessage,
} from '../../shared/types.js'

export type {
  ObstacleData,
  PerformanceStats,
  BroadcastStateMessage,
  ObstacleUpdateMessage,
  CreateRoomMessage,
  JoinRoomMessage,
  RoomCreatedMessage,
  StateUpdateMessage,
  ViewerJoinedMessage,
  ViewerLeftMessage,
  ErrorMessage,
  WebSocketMessage,
}

export interface Room {
  id: string
  hostId: string
  hostWs: WebSocket | null
  viewers: Map<string, WebSocket>
  viewerCount: number
  latestState: BroadcastStateMessage | null
  createdAt: number
  lastActiveAt: number
}
