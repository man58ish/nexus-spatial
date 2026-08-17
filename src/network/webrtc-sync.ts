// src/network/webrtc-sync.ts
export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export class WebRTCSync {
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private eventSource: EventSource | null = null;
  
  private isInitiator = false;
  private state: ConnectionState = 'DISCONNECTED';
  private roomId: string;
  private peerId: string;

  private onData: (data: Float32Array) => void;
  private onStateChange: (state: ConnectionState) => void;
  private onPing: (ping: number) => void;
  private pingInterval: number | null = null;
  
  // ICE candidate queue to prevent mobile network drop
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

    // Multi-Region Global STUN cluster for Mobile NAT Traversal
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    });

    this.setupPeerEvents();
  }

  public init() {
    this.updateState('CONNECTING');
    this.connectUniversalSignaling();
  }

  private updateState(newState: ConnectionState) {
    if (this.state === 'CONNECTED' && newState === 'CONNECTING') return;
    this.state = newState;
    this.onStateChange(this.state);
  }

  // 100% Reliable HTTPS Signaling (Never blocked by mobile carriers)
  private connectUniversalSignaling() {
    const topic = `nexus_spatial_${this.roomId}`;
    const sseUrl = `https://ntfy.sh/${topic}/sse`;

    try {
      this.eventSource = new EventSource(sseUrl);

      this.eventSource.onopen = () => {
        // Announce presence across devices
        this.sendSignal({ type: 'JOIN', sender: this.peerId });
      };

      this.eventSource.onmessage = async (event) => {
        try {
          if (!event.data) return;
          const parsed = JSON.parse(event.data);
          
          // ntfy.sh wraps messages inside 'message' property
          const rawMessage = parsed.message ? JSON.parse(parsed.message) : parsed;
          if (!rawMessage || rawMessage.sender === this.peerId) return;

          await this.handleIncomingSignal(rawMessage);
        } catch {}
      };

      this.eventSource.onerror = () => {
        // Auto-reconnect managed by EventSource
      };
    } catch (e) {
      console.error('Signaling init error:', e);
    }
  }

  private async sendSignal(data: object) {
    const topic = `nexus_spatial_${this.roomId}`;
    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, sender: this.peerId })
      });
    } catch {}
  }

  private async handleIncomingSignal(msg: any) {
    if (this.state === 'CONNECTED') return;

    if (msg.type === 'JOIN') {
      if (!this.isInitiator && !this.dataChannel) {
        this.isInitiator = true;
        this.createDataChannel();
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        await this.sendSignal({ type: 'OFFER', sdp: offer });
      }
    } 
    else if (msg.type === 'OFFER') {
      if (this.isInitiator && this.peerId < msg.sender) return;
      this.isInitiator = false;
      
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      await this.flushPendingCandidates();
      
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      await this.sendSignal({ type: 'ANSWER', sdp: answer });
    } 
    else if (msg.type === 'ANSWER' && this.isInitiator) {
      if (!this.peerConnection.currentRemoteDescription) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        await this.flushPendingCandidates();
      }
    } 
    else if (msg.type === 'ICE' && msg.candidate) {
      if (this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
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
      
      // Close signaling stream once direct P2P data channel is running
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
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