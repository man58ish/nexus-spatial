// src/network/webrtc-sync.ts
import { Peer, type DataConnection } from 'peerjs';

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export class WebRTCSync {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private roomId: string;
  
  private onData: (data: Float32Array) => void;
  private onStateChange: (state: ConnectionState) => void;
  private onPing: (ping: number) => void;
  private pingInterval: number | null = null;

  constructor(
    roomId: string,
    onData: (data: Float32Array) => void,
    onStateChange: (state: ConnectionState) => void,
    onPing: (ping: number) => void
  ) {
    this.roomId = roomId.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    this.onData = onData;
    this.onStateChange = onStateChange;
    this.onPing = onPing;
  }

  public init() {
    this.updateState('CONNECTING');
    this.setupPeerSession();
  }

  private updateState(newState: ConnectionState) {
    if (this.state === newState) return;
    this.state = newState;
    this.onStateChange(this.state);
  }

  private setupPeerSession() {
    const hostId = `nexus-cad-${this.roomId}`;
    
    // Attempt to claim room ownership as Host
    this.peer = new Peer(hostId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    this.peer.on('open', () => {
      this.peer?.on('connection', (conn) => {
        this.bindConnection(conn);
      });
    });

    this.peer.on('error', (err: any) => {
      // If Host ID already taken, connect as Guest
      if (err.type === 'unavailable-id') {
        this.peer?.destroy();
        this.connectAsGuest(hostId);
      } else {
        console.warn('Peer session warning:', err);
      }
    });
  }

  private connectAsGuest(hostId: string) {
    const guestId = `nexus-guest-${this.roomId}-${Math.random().toString(36).substring(2, 7)}`;
    
    this.peer = new Peer(guestId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    this.peer.on('open', () => {
      const conn = this.peer!.connect(hostId, {
        reliable: false // Low-latency UDP transport
      });
      this.bindConnection(conn);
    });

    this.peer.on('error', () => {
      this.updateState('DISCONNECTED');
    });
  }

  private bindConnection(conn: DataConnection) {
    this.connection = conn;

    conn.on('open', () => {
      this.updateState('CONNECTED');
      this.startPingMonitor();
    });

    conn.on('data', (data: unknown) => {
      if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        const buf = data instanceof ArrayBuffer ? new Float32Array(data) : new Float32Array(data.buffer);
        this.handleIncomingBuffer(buf);
      } else if (data instanceof Float32Array) {
        this.handleIncomingBuffer(data);
      }
    });

    conn.on('close', () => {
      this.updateState('DISCONNECTED');
      if (this.pingInterval) clearInterval(this.pingInterval);
    });

    conn.on('error', () => {
      this.updateState('DISCONNECTED');
    });
  }

  private handleIncomingBuffer(buf: Float32Array) {
    if (buf[0] === -1) {
      this.sendBuffer(new Float32Array([-2, buf[1]]));
    } else if (buf[0] === -2) {
      this.onPing(Math.round(performance.now() - buf[1]));
    } else if (buf[0] === 1) {
      this.onData(buf);
    }
  }

  private startPingMonitor() {
    this.pingInterval = window.setInterval(() => {
      if (this.connection?.open) {
        this.sendBuffer(new Float32Array([-1, performance.now()]));
      }
    }, 1000);
  }

  private sendBuffer(buf: Float32Array) {
    if (this.connection?.open) {
      try {
        this.connection.send(buf);
      } catch {}
    }
  }

  public sendPosition(x: number, y: number, z: number) {
    this.sendBuffer(new Float32Array([1, x, y, z]));
  }
}