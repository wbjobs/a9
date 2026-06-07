import type { WebSocket } from 'ws'
import type {
  WebSocketMessage,
  CreateRoomMessage,
  JoinRoomMessage,
  BroadcastStateMessage,
  ObstacleUpdateMessage,
  ErrorMessage,
  RoomCreatedMessage,
} from './types.js'
import { RoomManager } from './RoomManager.js'

interface ConnectionInfo {
  ws: WebSocket
  userId: string | null
  roomId: string | null
  role: 'host' | 'viewer' | null
}

const roomManager = new RoomManager()
const connections = new Map<WebSocket, ConnectionInfo>()

export function handleConnection(ws: WebSocket): void {
  const connectionInfo: ConnectionInfo = {
    ws,
    userId: null,
    roomId: null,
    role: null,
  }
  connections.set(ws, connectionInfo)

  ws.on('message', (data: Buffer) => {
    handleMessage(ws, data.toString())
  })

  ws.on('close', () => {
    handleDisconnect(ws)
  })

  ws.on('error', (error) => {
    console.error('WebSocket error:', error)
    handleDisconnect(ws)
  })
}

function handleMessage(ws: WebSocket, data: string): void {
  try {
    const message: WebSocketMessage = JSON.parse(data)
    const connectionInfo = connections.get(ws)
    if (!connectionInfo) {
      sendError(ws, 'Connection not found')
      return
    }

    switch (message.type) {
      case 'create_room':
        handleCreateRoom(ws, message as CreateRoomMessage, connectionInfo)
        break
      case 'join_room':
        handleJoinRoom(ws, message as JoinRoomMessage, connectionInfo)
        break
      case 'broadcast_state':
        handleBroadcastState(ws, message as BroadcastStateMessage, connectionInfo)
        break
      case 'obstacle_update':
        handleObstacleUpdate(ws, message as ObstacleUpdateMessage, connectionInfo)
        break
      default:
        sendError(ws, `Unknown message type: ${message.type}`)
    }
  } catch (error) {
    console.error('Error parsing message:', error)
    sendError(ws, 'Invalid message format')
  }
}

function handleCreateRoom(
  ws: WebSocket,
  message: CreateRoomMessage,
  connectionInfo: ConnectionInfo
): void {
  const { hostId } = message

  if (!hostId) {
    sendError(ws, 'hostId is required')
    return
  }

  const existingRoom = roomManager.findRoomByHost(hostId)
  if (existingRoom) {
    sendError(ws, 'Host already has an active room')
    return
  }

  const roomId = roomManager.createRoom(hostId, ws)

  connectionInfo.userId = hostId
  connectionInfo.roomId = roomId
  connectionInfo.role = 'host'

  const response: RoomCreatedMessage = {
    type: 'room_created',
    roomId,
    hostId,
    timestamp: Date.now(),
  }

  ws.send(JSON.stringify(response))
  console.log(`Room created: ${roomId} by host: ${hostId}`)
}

function handleJoinRoom(
  ws: WebSocket,
  message: JoinRoomMessage,
  connectionInfo: ConnectionInfo
): void {
  const { roomId, viewerId } = message

  if (!roomId || !viewerId) {
    sendError(ws, 'roomId and viewerId are required')
    return
  }

  const room = roomManager.getRoom(roomId)
  if (!room) {
    sendError(ws, `Room ${roomId} does not exist`)
    return
  }

  const success = roomManager.joinRoom(roomId, viewerId, ws)
  if (!success) {
    sendError(ws, `Failed to join room ${roomId}. Already in room or invalid.`)
    return
  }

  connectionInfo.userId = viewerId
  connectionInfo.roomId = roomId
  connectionInfo.role = 'viewer'

  if (room.latestState) {
    ws.send(JSON.stringify(room.latestState))
  }

  roomManager.broadcastViewerJoined(roomId, viewerId)
  console.log(`Viewer ${viewerId} joined room ${roomId}`)
}

function handleBroadcastState(
  ws: WebSocket,
  message: BroadcastStateMessage,
  connectionInfo: ConnectionInfo
): void {
  const { roomId } = message

  if (connectionInfo.role !== 'host') {
    sendError(ws, 'Only hosts can broadcast state')
    return
  }

  if (!roomId || !roomManager.getRoom(roomId)) {
    sendError(ws, `Room ${roomId} does not exist`)
    return
  }

  if (connectionInfo.roomId !== roomId) {
    sendError(ws, 'You are not the host of this room')
    return
  }

  roomManager.broadcastState(roomId, message)
}

function handleObstacleUpdate(
  ws: WebSocket,
  message: ObstacleUpdateMessage,
  connectionInfo: ConnectionInfo
): void {
  const { roomId } = message

  if (connectionInfo.role !== 'host') {
    sendError(ws, 'Only hosts can update obstacles')
    return
  }

  if (!roomId || !roomManager.getRoom(roomId)) {
    sendError(ws, `Room ${roomId} does not exist`)
    return
  }

  if (connectionInfo.roomId !== roomId) {
    sendError(ws, 'You are not the host of this room')
    return
  }

  roomManager.broadcastObstacles(roomId, message)
}

function handleDisconnect(ws: WebSocket): void {
  const connectionInfo = connections.get(ws)
  if (!connectionInfo) {
    return
  }

  const { userId, roomId, role } = connectionInfo

  if (roomId && userId) {
    if (role === 'host') {
      roomManager.closeRoom(roomId)
      console.log(`Host ${userId} disconnected, room ${roomId} closed`)
    } else if (role === 'viewer') {
      roomManager.leaveRoom(roomId, userId)
      roomManager.broadcastViewerLeft(roomId, userId)
      console.log(`Viewer ${userId} left room ${roomId}`)
    }
  }

  connections.delete(ws)
}

function sendError(ws: WebSocket, message: string): void {
  const error: ErrorMessage = {
    type: 'error',
    message,
    timestamp: Date.now(),
  }
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(error))
  }
}

export { roomManager }
