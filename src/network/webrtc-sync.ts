// src/network/webrtc-sync.ts
export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export class WebRTCSync {
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private eventSource: EventSource | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  
  private isInitiator = false;
  private state: ConnectionState = 'DISCONNECTED';
  private roomId: string;
  private peerId: string;

  private onData: (data: Float32Array) => void;
  private onStateChange: (state: ConnectionState) => void;
  private onPing: (ping: number) => void;
  private pingInterval: number | null = null;
  private discoveryInterval: number | null = null;
  
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(
    roomId: string,
    onData: (data: Float32Array) => void,
    onStateChange: (state: ConnectionState) => void,
    onPing: (ping: number) => void
  ) {
    this.roomId = roomId.toLowerCase().trim();
    this.onData = onData;
    this.onStateChange = onStateChange;
    this.onPing = onPing;
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 9);

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    });

    this.setupPeerEvents();
  }

  public init() {
    this.updateState('CONNECTING');
    this.initBroadcastChannel();
    this.initUniversalSignaling();
  }

  private updateState(newState: ConnectionState) {
    if (this.state === 'CONNECTED' && newState === 'CONNECTING') return;
    this.state = newState;
    this.onStateChange(this.state);
  }

  // Fast Local-Tab Signaling
  private initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel(`nexus_room_${this.roomId}`);
      this.broadcastChannel.onmessage = async (e) => {
        if (e.data && e.data.sender !== this.peerId) {
          await this.handleIncomingSignal(e.data);
        }
      };
    } catch {}
  }

  // Universal Cross-Device / Cross-Network HTTPS Signaling
  private initUniversalSignaling() {
    const topic = `nexus_spatial_${this.roomId}`;
    const sseUrl = `https://ntfy.sh/${topic}/sse`;

    try {
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onmessage = async (event) => {
        try {
          if (!event.data) return;
          const envelope = JSON.parse(event.data);
          if (envelope.event !== 'message' || !envelope.message) return;

          const signal = JSON.parse(envelope.message);
          if (!signal || signal.sender === this.peerId) return;

          await this.handleIncomingSignal(signal);
        } catch {}
      };

      // Periodic Discovery Broadcast until WebRTC connects
      this.discoveryInterval = window.setInterval(() => {
        if (this.state === 'CONNECTED') {
          if (this.discoveryInterval) clearInterval(this.discoveryInterval);
          return;
        }
        this.sendSignal({ type: 'DISCOVER' });
      }, 1500);

      this.sendSignal({ type: 'DISCOVER' });
    } catch (e) {
      console.error('Signaling init error:', e);
    }
  }

  private async sendSignal(data: object) {
    const payload = { ...data, sender: this.peerId };
    const rawString = JSON.stringify(payload);

    // Local Broadcast
    if (this.broadcastChannel) {
      try { this.broadcastChannel.postMessage(payload); } catch {}
    }

    // Global HTTPS POST (Plain Body without conflicting JSON header)
    const topic = `nexus_spatial_${this.roomId}`;
    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: rawString
      });
    } catch {}
  }

  private async handleIncomingSignal(msg: any) {
    if (this.state === 'CONNECTED') return;

    // Deterministic Peer Role Assignment
    if (msg.type === 'DISCOVER') {
      if (this.peerId < msg.sender) {
        if (!this.isInitiator && !this.dataChannel) {
          this.isInitiator = true;
          this.createDataChannel();
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
          await this.sendSignal({ type: 'OFFER', sdp: offer, target: msg.sender });
        }
      }
    } 
    else if (msg.type === 'OFFER') {
      if (this.isInitiator && this.peerId < msg.sender) return;
      this.isInitiator = false;

      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      await this.flushPendingCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      await this.sendSignal({ type: 'ANSWER', sdp: answer, target: msg.sender });
    } 
    else if (msg.type === 'ANSWER') {
      if (this.isInitiator && !this.peerConnection.currentRemoteDescription) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        await this.flushPendingCandidates();
      }
    } 
    else if (msg.type === 'ICE' && msg.candidate) {
      if (this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch {}
      } else {
        this.pendingCandidates.push(msg.candidate);
      }
    }
  }

  private async flushPendingCandidates() {
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {}
      }
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
      
      // Teardown signaling pipelines once pure P2P is established
      if (this.discoveryInterval) clearInterval(this.discoveryInterval);
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      if (this.broadcastChannel) {
        this.broadcastChannel.close();
        this.broadcastChannel = null;
      }
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