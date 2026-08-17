import { WebRTCSync, type ConnectionState } from '../network/webrtc-sync';

export class NexusSpatial extends HTMLElement {
  private worker: Worker | null = null;
  private webrtc: WebRTCSync | null = null;
  private localCursor = { x: 0, y: 0, z: 0 };
  private roomId: string = '';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    // Generate or get Room ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    let room = urlParams.get('room');
    if (!room) {
      room = Math.random().toString(36).substring(2, 7).toUpperCase();
      window.history.replaceState({}, '', `?room=${room}`);
    }
    this.roomId = room;

    this.renderUI();
    this.setupLogic();
  }

  private renderUI() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        :host { display: block; width: 100vw; height: 100vh; background: #0f1115; color: #e5e7eb; font-family: 'Inter', sans-serif; overflow: hidden; user-select: none; }
        canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }

        .toolbar { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(20, 24, 33, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 10px 20px; z-index: 10; display: flex; align-items: center; gap: 20px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35); }
        .tool-title { font-weight: 600; font-size: 14px; color: #fff; letter-spacing: 0.5px; }
        .divider { width: 1px; height: 20px; background: rgba(255, 255, 255, 0.1); }
        .status-indicator { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; }
        .dot.connected { background: #34d399; box-shadow: 0 0 10px rgba(52, 211, 153, 0.5); }

        .properties-panel { position: absolute; right: 20px; top: 20px; width: 280px; background: rgba(20, 24, 33, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 20px; z-index: 10; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35); }
        .panel-header { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #9ca3af; margin-bottom: 15px; letter-spacing: 1px; }
        
        .prop-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 13px; align-items: center; }
        .prop-label { color: #9ca3af; }
        .prop-value { color: #fff; font-family: monospace; }
        
        .room-box { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 8px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .room-code { font-family: monospace; color: #3b82f6; font-weight: bold; letter-spacing: 1px; }
        .copy-btn { background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 11px; text-decoration: underline; }
        .copy-btn:hover { color: #fff; }

        .btn-primary { width: 100%; padding: 10px; margin-top: 10px; background: #3b82f6; color: #fff; border: none; border-radius: 6px; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
        .btn-primary:hover { background: #2563eb; }
        .btn-primary:disabled { background: #374151; cursor: not-allowed; color: #9ca3af; }
      </style>

      <canvas id="gl-canvas"></canvas>

      <div class="toolbar">
        <div class="tool-title">Nexus Spatial // Studio</div>
        <div class="divider"></div>
        <div class="status-indicator">
          <div class="dot" id="status-dot"></div>
          <span id="status-txt">Offline</span>
        </div>
      </div>

      <div class="properties-panel">
        <div class="panel-header">Session Room</div>
        <div class="room-box">
          <span class="room-code">ID: ${this.roomId}</span>
          <button class="copy-btn" id="copy-btn">Copy Link</button>
        </div>

        <div class="panel-header">Spatial Coordinates</div>
        <div class="prop-row"><span class="prop-label">Local X</span><span class="prop-value" id="loc-x">0.000</span></div>
        <div class="prop-row"><span class="prop-label">Local Y</span><span class="prop-value" id="loc-y">0.000</span></div>
        <div class="divider" style="width: 100%; height: 1px; margin: 15px 0;"></div>
        <div class="prop-row"><span class="prop-label">Sync Latency</span><span class="prop-value" id="ping-val">-- ms</span></div>

        <button class="btn-primary" id="connect-btn">Join P2P Canvas</button>
      </div>
    `;
  }

  private setupLogic() {
    this.initEngine();
    
    // Copy URL functionality
    this.shadowRoot?.getElementById('copy-btn')?.addEventListener('click', (e) => {
      navigator.clipboard.writeText(window.location.href);
      const btn = e.target as HTMLButtonElement;
      btn.innerText = "Copied!";
      setTimeout(() => btn.innerText = "Copy Link", 2000);
    });
    
    this.shadowRoot?.getElementById('connect-btn')?.addEventListener('click', (e) => {
      const btn = e.target as HTMLButtonElement;
      btn.disabled = true;
      btn.innerText = 'Connecting...';
      this.initNetwork();
    });

    const updateCoords = (clientX: number, clientY: number) => {
      this.localCursor.x = (clientX / window.innerWidth) * 2 - 1;
      this.localCursor.y = -(clientY / window.innerHeight) * 2 + 1;
      
      const xTxt = this.shadowRoot?.getElementById('loc-x');
      const yTxt = this.shadowRoot?.getElementById('loc-y');
      if (xTxt) xTxt.innerText = this.localCursor.x.toFixed(3);
      if (yTxt) yTxt.innerText = this.localCursor.y.toFixed(3);

      this.worker?.postMessage({ type: 'LOCAL_CURSOR', x: this.localCursor.x, y: this.localCursor.y });
      this.webrtc?.sendPosition(this.localCursor.x, this.localCursor.y, 0);
    };

    window.addEventListener('mousemove', (e) => updateCoords(e.clientX, e.clientY));
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) updateCoords(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  }

  private initEngine() {
    const canvas = this.shadowRoot?.getElementById('gl-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const offscreen = canvas.transferControlToOffscreen();
    
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);

    this.worker = new Worker(new URL('../engine/engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.postMessage({ type: 'INIT', payload: { canvas: offscreen, width, height, pixelRatio: window.devicePixelRatio } }, [offscreen]);

    window.addEventListener('resize', () => {
      this.worker?.postMessage({ type: 'RESIZE', payload: { width: Math.max(window.innerWidth, 1), height: Math.max(window.innerHeight, 1) } });
    });
  }

  private initNetwork() {
    const statusDot = this.shadowRoot?.getElementById('status-dot');
    const statusTxt = this.shadowRoot?.getElementById('status-txt');
    const pingVal = this.shadowRoot?.getElementById('ping-val');
    const btn = this.shadowRoot?.getElementById('connect-btn') as HTMLButtonElement;

    this.webrtc = new WebRTCSync(
      this.roomId,
      (data: Float32Array) => {
        this.worker?.postMessage({ type: 'REMOTE_CURSOR', x: data[1], y: data[2] });
      },
      (state: ConnectionState) => {
        if (statusTxt) statusTxt.innerText = state;
        if (state === 'CONNECTED') {
          statusDot?.classList.add('connected');
          if (btn) { btn.innerText = 'Canvas Synchronized'; btn.style.background = '#059669'; }
        } else {
          statusDot?.classList.remove('connected');
        }
      },
      (ping: number) => {
        if (pingVal) pingVal.innerText = `${ping} ms`;
      }
    );
    this.webrtc.init();
  }
}

customElements.define('nexus-spatial', NexusSpatial);