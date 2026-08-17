// src/network/webrtc-sync.ts
export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export class WebRTCSync {
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  
  private isInitiator = false;
  private state: ConnectionState = 'DISCONNECTED';
  private roomId: string;
  private peerId: string;

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
    this.roomId = roomId;
    this.onData = onData;
    this.onStateChange = onStateChange;
    this.onPing = onPing;
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    this.setupPeerEvents();
  }

  public init() {
    this.updateState('CONNECTING');
    this.initLocalSignaling();
    this.initGlobalSignaling();
  }

  private updateState(newState: ConnectionState) {
    if (this.state === 'CONNECTED') return;
    this.state = newState;
    this.onStateChange(this.state);
  }

  // 1. Local Signaling (Instant connection for side-by-side tabs on same PC)
  private initLocalSignaling() {
    this.broadcastChannel = new BroadcastChannel(`nexus_room_${this.roomId}`);
    
    this.broadcastChannel.onmessage = async (event) => {
      await this.handleIncomingSignal(event.data, 'local');
    };

    // Announce presence locally
    this.broadcastChannel.postMessage({ type: 'JOIN', sender: this.peerId });
  }

  // 2. Global Signaling (For Cross-Device Phone-to-Laptop connections)
  private initGlobalSignaling() {
    try {
      const clusterId = 'room_' + this.roomId.toLowerCase();
      const apiKey = 'oCdCMcMPQpbvNjUIzqtvF1d2X2okWpDQj4AwARJuAgtjhzKxVEjQU6IdCjwm';
      this.ws = new WebSocket(`wss://free.blr2.piesocket.com/v3/${clusterId}?api_key=${apiKey}&notify_self=0`);

      this.ws.onopen = () => {
        this.sendGlobalSignal({ type: 'JOIN', sender: this.peerId });
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          await this.handleIncomingSignal(msg, 'global');
        } catch (err) {}
      };
    } catch (e) {}
  }

  private sendLocalSignal(data: object) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ ...data, sender: this.peerId });
    }
  }

  private sendGlobalSignal(data: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ...data, sender: this.peerId }));
    }
  }

  private sendSignal(data: object) {
    this.sendLocalSignal(data);
    this.sendGlobalSignal(data);
  }

  private async handleIncomingSignal(msg: any, source: string) {
    if (!msg || msg.sender === this.peerId || this.state === 'CONNECTED') return;

    try {
      if (msg.type === 'JOIN') {
        if (!this.isInitiator && !this.dataChannel) {
          this.isInitiator = true;
          this.createDataChannel();
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          this.sendSignal({ type: 'OFFER', sdp: offer });
        }
      } 
      else if (msg.type === 'OFFER') {
        if (this.isInitiator && this.peerId < msg.sender) return; // Conflict resolution
        this.isInitiator = false;
        if (!this.peerConnection.currentRemoteDescription) {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);
          this.sendSignal({ type: 'ANSWER', sdp: answer });
        }
      } 
      else if (msg.type === 'ANSWER' && this.isInitiator) {
        if (!this.peerConnection.currentRemoteDescription) {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        }
      } 
      else if (msg.type === 'ICE' && msg.candidate) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
      }
    } catch (err) {
      console.warn(`Signaling error from ${source}:`, err);
    }
  }

  private setupPeerEvents() {
    this.peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({ type: 'ICE', candidate: e.candidate.toJSON() });
      }
    };

    this.peerConnection.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this.bindChannel();
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (
        this.peerConnection.connectionState === 'disconnected' ||
        this.peerConnection.connectionState === 'failed'
      ) {
        this.updateState('DISCONNECTED');
        if (this.pingInterval) clearInterval(this.pingInterval);
      }
    };
  }

  private createDataChannel() {
    this.dataChannel = this.peerConnection.createDataChannel('spatial-sync', {
      ordered: false,
      maxRetransmits: 0
    });
    this.bindChannel();
  }

  private bindChannel() {
    if (!this.dataChannel) return;
    this.dataChannel.binaryType = 'arraybuffer';
    
    this.dataChannel.onopen = () => {
      this.updateState('CONNECTED');
      this.startPingMonitor();
      
      // Cleanup signaling channels once direct P2P is established
      if (this.ws) this.ws.close();
      if (this.broadcastChannel) this.broadcastChannel.close();
    };
    
    this.dataChannel.onmessage = (e: MessageEvent) => {
      const buf = new Float32Array(e.data);
      if (buf[0] === -1) {
        this.sendBuffer(new Float32Array([-2, buf[1]])); 
      } else if (buf[0] === -2) {
        this.onPing(Math.round(performance.now() - buf[1]));
      } else if (buf[0] === 1) {
        this.onData(buf);
      }
    };
  }

  private startPingMonitor() {
    this.pingInterval = window.setInterval(() => {
      if (this.dataChannel?.readyState === 'open') {
        this.sendBuffer(new Float32Array([-1, performance.now()]));
      }
    }, 1000);
  }

  private sendBuffer(buf: Float32Array) {
    if (this.dataChannel?.readyState === 'open') {
      try {
        this.dataChannel.send(buf.buffer as ArrayBuffer);
      } catch {}
    }
  }

  public sendPosition(x: number, y: number, z: number) {
    this.sendBuffer(new Float32Array([1, x, y, z]));
  }
}