# Nexus Spatial // 3D Digital Twin & P2P Collaboration Canvas

A high-performance, real-time 3D spatial collaboration workspace designed for low-latency multi-user interaction. Built with **Three.js** running off-main-thread via **Web Workers** and **OffscreenCanvas**, synchronized across devices using low-latency **WebRTC DataChannels**.

---

## ⚡ Architectural Highlights

* **Off-Main-Thread Rendering:** Complete WebGL rendering pipeline runs inside a dedicated Web Worker using `OffscreenCanvas`, ensuring 60+ FPS UI responsiveness without main-thread blocking.
* **Sub-10ms P2P Synchronization:** Real-time spatial cursor positioning and orientation synchronized over unordered, zero-retransmission WebRTC UDP DataChannels.
* **Cross-Device URL-Based Sessions:** Dynamic room generation via URL parameters (`?room=ROOM_ID`) enabling direct Laptop-to-Laptop, Phone-to-Phone, and Laptop-to-Phone synchronization across varying networks.
* **Encapsulated UI:** Built using standard Web Components (Custom Elements & Shadow DOM) with a glassmorphism HUD panel tracking coordinates, room status, and network RTT ping.
* **Studio-Grade Visual Pipeline:** Configured with `ACESFilmicToneMapping`, physical materials (`MeshPhysicalMaterial`), dual rim lighting, and responsive aspect-ratio projection.

---

## 🛠️ Tech Stack

* **Core:** TypeScript, HTML5 Custom Elements (Web Components)
* **Graphics & Shaders:** Three.js, WebGL2, OffscreenCanvas, Web Workers
* **Networking & Real-Time Sync:** WebRTC DataChannel, PeerJS, STUN Servers
* **Bundler & Tooling:** Vite

---

## 📂 Project Structure

```
nexus-spatial/
├── src/
│   ├── components/
│   │   └── nexus-spatial.ts    # Web Component Shadow DOM UI, events & worker orchestrator
│   ├── engine/
│   │   └── engine.worker.ts    # Three.js WebGL scene, lighting & rendering loop in Web Worker
│   ├── network/
│   │   └── webrtc-sync.ts      # WebRTC PeerJS DataChannel setup, heartbeat & binary sync
│   └── main.ts                 # Application bootstrap
├── index.html                  # Shell HTML & typography definitions
├── package.json
├── tsconfig.json
└── vite.config.ts

```

---

## 🚀 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (version 18+ recommended)
* `npm` or `pnpm`

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/nexus-spatial.git
cd nexus-spatial

# Install dependencies
npm install

```

### Development Server

Run the local development server with network hosting enabled:

```bash
npm run dev -- --host

```

Open `http://localhost:5173` in your browser.

---

## 🌐 Cross-Device Collaboration Workflow

1. Open the application on your primary device (e.g., Laptop). A unique room ID will automatically be appended to the URL (e.g., `?room=MQE6S`).
2. Click **"Copy Link"** in the HUD panel and open that URL on a secondary device (e.g., Mobile Phone or another browser window).
3. Click **"Join P2P Canvas"** on both devices.
4. Move your mouse or drag your touch input on either device to observe real-time synchronized 3D spatial cursor rings with live latency tracking.

---

## 📦 Production Build & Deployment

```bash
# Type check and build optimized bundle
npm run build

# Preview the production build locally
npm run preview

```

Deploy the generated `dist/` directory directly to platforms like **Vercel**, **Cloudflare Pages**, or **Netlify**.

---

## 📄 License

MIT License. Free for personal and commercial usage.
