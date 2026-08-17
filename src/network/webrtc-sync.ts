// src/network/webrtc-sync.ts
export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED';

export class WebRTCSync {
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  
  private isInitiator = false;
  private state: ConnectionState = 'DISCONNECTED';
  private roomId: string;
  private peerId: string;

  private onData: (data: Float32Array) => void;
  private onStateChange: (state: ConnectionState) => void;
  private onPing: (ping: number) => void;
  private pingInterval: number | null = null;
  private heartbeatInterval: number | null = null; // ✅ Added property declaration

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
    this.connectSignaling(); // ✅ Explicitly invoked here
  }

  private updateState(newState: ConnectionState) {
    if (this.state === 'CONNECTED') return;
    this.state = newState;
    this.onStateChange(this.state);
  }

  private connectSignaling() {
    try {
      const channelId = 'nexus_' + this.roomId.toLowerCase();
      const apiKey = 'VCXCEuvhGcBDP7XNJJJUDVxNmNzXVDTB0CsjhSGp';
      this.ws = new WebSocket(`wss://demo.piesocket.com/v3/${channelId}?api_key=${apiKey}&notify_self=0`);

      this.ws.onopen = () => {
        this.sendSignal({ type: 'READY', sender: this.peerId });
        
        this.heartbeatInterval = window.setInterval(() => {
          this.sendSignal({ type: 'HEARTBEAT', sender: this.peerId });
        }, 5000);
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg || msg.sender === this.peerId) return;

          if (msg.type === 'READY' || msg.type === 'JOIN') {
            if (!this.isInitiator && !this.dataChannel) {
              this.isInitiator = true;
              this.createDataChannel();
              const offer = await this.peerConnection.createOffer();
              await this.peerConnection.setLocalDescription(offer);
              this.sendSignal({ type: 'OFFER', sdp: offer, sender: this.peerId });
            }
          } 
          else if (msg.type === 'OFFER' && this.isInitiator) {
            if (this.peerId < msg.sender) return;
            this.isInitiator = false;
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.sendSignal({ type: 'ANSWER', sdp: answer, sender: this.peerId });
          }
          else if (msg.type === 'OFFER' && !this.isInitiator) {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.sendSignal({ type: 'ANSWER', sdp: answer, sender: this.peerId });
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
          console.warn('Signaling parse error:', err);
        }
      };

      this.ws.onerror = (e) => console.warn('WebSocket error:', e);
    } catch (e) {
      console.error('Failed signaling:', e);
    }
  }

  private sendSignal(data: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private setupPeerEvents() {
    this.peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({ type: 'ICE', candidate: e.candidate.toJSON(), sender: this.peerId });
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
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
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
      if (this.ws) {
        this.ws.close();
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
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