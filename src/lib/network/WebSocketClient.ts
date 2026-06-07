import type {
  BroadcastStateMessage,
  ObstacleData,
  WebSocketMessage,
  RoomCreatedMessage,
  StateUpdateMessage,
  ViewerJoinedMessage,
  ViewerLeftMessage,
  ErrorMessage,
} from '../../../shared/types';

type EventHandler = (...args: unknown[]) => void;

type WebSocketEvent = 'state_update' | 'viewer_joined' | 'viewer_left' | 'room_created' | 'error';

export class WebSocketClient {
  private serverUrl: string;
  private ws: WebSocket | null = null;
  private eventHandlers: Map<WebSocketEvent | string, Set<EventHandler>> = new Map();
  private connectPromise: Promise<void> | null = null;
  private clientId: string = crypto.randomUUID();

  public isConnected: boolean = false;
  public roomId: string | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          resolve();
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.connectPromise = null;
        };

        this.ws.onerror = (error) => {
          this.emit('error', error);
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
      }
    });

    return this.connectPromise;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.roomId = null;
      this.connectPromise = null;
    }
  }

  createRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.isConnected) {
        reject(new Error('Not connected'));
        return;
      }

      const handler = (message: RoomCreatedMessage) => {
        this.roomId = message.roomId;
        this.off('room_created', handler as unknown as EventHandler);
        resolve(message.roomId);
      };

      this.on('room_created', handler as unknown as EventHandler);

      const message: WebSocketMessage = {
        type: 'create_room',
        timestamp: Date.now(),
        hostId: this.clientId,
      };

      this.ws.send(JSON.stringify(message));
    });
  }

  joinRoom(roomId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.isConnected) {
        reject(new Error('Not connected'));
        return;
      }

      const errorHandler = (error: ErrorMessage) => {
        this.off('error', errorHandler as unknown as EventHandler);
        this.off('state_update', stateHandler as unknown as EventHandler);
        reject(new Error(error.message));
      };

      const stateHandler = () => {
        this.roomId = roomId;
        this.off('error', errorHandler as unknown as EventHandler);
        this.off('state_update', stateHandler as unknown as EventHandler);
        resolve(true);
      };

      this.on('error', errorHandler as unknown as EventHandler);
      this.on('state_update', stateHandler as unknown as EventHandler);

      const message: WebSocketMessage = {
        type: 'join_room',
        timestamp: Date.now(),
        roomId,
        viewerId: this.clientId,
      };

      this.ws.send(JSON.stringify(message));
    });
  }

  leaveRoom(): void {
    this.roomId = null;
  }

  broadcastState(state: Omit<BroadcastStateMessage, 'type' | 'timestamp'>): void {
    if (!this.ws || !this.isConnected || !this.roomId) {
      return;
    }

    const message: BroadcastStateMessage = {
      type: 'broadcast_state',
      timestamp: Date.now(),
      ...state,
    };

    this.ws.send(JSON.stringify(message));
  }

  broadcastObstacles(obstacles: ObstacleData[]): void {
    if (!this.ws || !this.isConnected || !this.roomId) {
      return;
    }

    const message: WebSocketMessage = {
      type: 'obstacle_update',
      timestamp: Date.now(),
      roomId: this.roomId,
      obstacles,
    };

    this.ws.send(JSON.stringify(message));
  }

  on(event: WebSocketEvent, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: WebSocketEvent, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }

  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      switch (message.type) {
        case 'room_created':
          this.emit('room_created', message as RoomCreatedMessage);
          break;
        case 'state_update':
          this.emit('state_update', message as StateUpdateMessage);
          break;
        case 'viewer_joined':
          this.emit('viewer_joined', message as ViewerJoinedMessage);
          break;
        case 'viewer_left':
          this.emit('viewer_left', message as ViewerLeftMessage);
          break;
        case 'error':
          this.emit('error', message as ErrorMessage);
          break;
      }
    } catch (error) {
      this.emit('error', error);
    }
  }
}
