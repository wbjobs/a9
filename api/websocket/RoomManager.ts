import type { WebSocket } from 'ws'
import type {
  Room,
  BroadcastStateMessage,
  ObstacleUpdateMessage,
  StateUpdateMessage,
  ViewerJoinedMessage,
  ViewerLeftMessage,
} from './types.js'

export class RoomManager {
  private rooms: Map<string, Room> = new Map()

  createRoom(hostId: string, hostWs: WebSocket): string {
    let roomId: string
    do {
      roomId = this.generateRoomId()
    } while (this.rooms.has(roomId))

    const room: Room = {
      id: roomId,
      hostId,
      hostWs,
      viewers: new Map(),
      viewerCount: 0,
      latestState: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }

    this.rooms.set(roomId, room)
    return roomId
  }

  joinRoom(roomId: string, viewerId: string, viewerWs: WebSocket): boolean {
    const room = this.rooms.get(roomId)
    if (!room) {
      return false
    }

    if (room.viewers.has(viewerId) || room.hostId === viewerId) {
      return false
    }

    room.viewers.set(viewerId, viewerWs)
    room.viewerCount = room.viewers.size
    room.lastActiveAt = Date.now()

    return true
  }

  leaveRoom(roomId: string, viewerId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }

    room.viewers.delete(viewerId)
    room.viewerCount = room.viewers.size
    room.lastActiveAt = Date.now()
  }

  closeRoom(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }

    for (const [, ws] of room.viewers) {
      if (ws.readyState === ws.OPEN) {
        ws.close()
      }
    }

    if (room.hostWs && room.hostWs.readyState === room.hostWs.OPEN) {
      room.hostWs.close()
    }

    this.rooms.delete(roomId)
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  broadcastState(roomId: string, state: BroadcastStateMessage): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }

    room.latestState = state
    room.lastActiveAt = Date.now()

    const stateUpdate: StateUpdateMessage = {
      type: 'state_update',
      frame: state.frame,
      particleCount: state.particleCount,
      heightFieldData: state.heightFieldData,
      obstacleData: state.obstacleData,
      stats: state.stats,
      timestamp: Date.now(),
    }

    const message = JSON.stringify(stateUpdate)

    for (const [, ws] of room.viewers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(message)
      }
    }
  }

  broadcastObstacles(roomId: string, obstacles: ObstacleUpdateMessage): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }

    room.lastActiveAt = Date.now()
    const message = JSON.stringify(obstacles)

    for (const [, ws] of room.viewers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(message)
      }
    }
  }

  broadcastViewerJoined(roomId: string, viewerId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }

    const message: ViewerJoinedMessage = {
      type: 'viewer_joined',
      viewerId,
      viewerCount: room.viewerCount,
      timestamp: Date.now(),
    }

    const messageStr = JSON.stringify(message)

    if (room.hostWs && room.hostWs.readyState === room.hostWs.OPEN) {
      room.hostWs.send(messageStr)
    }

    for (const [id, ws] of room.viewers) {
      if (id !== viewerId && ws.readyState === ws.OPEN) {
        ws.send(messageStr)
      }
    }
  }

  broadcastViewerLeft(roomId: string, viewerId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }

    const message: ViewerLeftMessage = {
      type: 'viewer_left',
      viewerId,
      viewerCount: room.viewerCount,
      timestamp: Date.now(),
    }

    const messageStr = JSON.stringify(message)

    if (room.hostWs && room.hostWs.readyState === room.hostWs.OPEN) {
      room.hostWs.send(messageStr)
    }

    for (const [id, ws] of room.viewers) {
      if (id !== viewerId && ws.readyState === ws.OPEN) {
        ws.send(messageStr)
      }
    }
  }

  getViewerCount(roomId: string): number {
    const room = this.rooms.get(roomId)
    return room ? room.viewerCount : 0
  }

  findRoomByHost(hostId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.hostId === hostId) {
        return room
      }
    }
    return undefined
  }

  findRoomByViewer(viewerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.viewers.has(viewerId)) {
        return room
      }
    }
    return undefined
  }

  private generateRoomId(): string {
    const chars = '0123456789'
    let result = ''
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
}
