import * as THREE from 'three';

let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;

// Interactive Entities
let centralObject: THREE.Mesh;
let localCursorObj: THREE.Mesh;
let remoteCursorObj: THREE.Mesh;

let screenW = 0, screenH = 0;

// Cursor Targets for smooth lerping
const localTarget = new THREE.Vector2(0, 0);
const remoteTarget = new THREE.Vector2(0, 0);

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;
  if (type === 'INIT') { 
    initEngine(payload.canvas, payload.width, payload.height, payload.pixelRatio); 
  }
  else if (type === 'RESIZE') { 
    handleResize(payload.width, payload.height); 
  }
  else if (type === 'LOCAL_CURSOR') {
    localTarget.set(e.data.x, e.data.y);
  }
  else if (type === 'REMOTE_CURSOR') {
    remoteTarget.set(e.data.x, e.data.y);
  }
};

function initEngine(canvas: OffscreenCanvas, w: number, h: number, pr: number) {
  screenW = Math.max(w, 1);
  screenH = Math.max(h, 1);

  const contextAttributes: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
    preserveDrawingBuffer: false
  };

  // Valid OffscreenCanvas WebGL context IDs
  const gl = 
    canvas.getContext('webgl2', contextAttributes) || 
    canvas.getContext('webgl', contextAttributes);

  if (!gl) {
    console.error('CRITICAL: WebGL is unsupported or disabled on this GPU.');
    return;
  }

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl as WebGLRenderingContext,
      antialias: false,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    console.error('THREE.WebGLRenderer Initialization Failed:', err);
    return;
  }

  renderer.setPixelRatio(Math.min(pr || 1, 2)); 
  renderer.setSize(screenW, screenH, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1115);
  scene.fog = new THREE.Fog(0x0f1115, 10, 50);

  camera = new THREE.PerspectiveCamera(45, screenW / screenH, 0.1, 100);
  camera.position.set(0, 5, 15);
  camera.lookAt(0, 0, 0);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.8);
  hemiLight.position.set(0, 10, 0);
  scene.add(hemiLight);
  
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
  mainLight.position.set(10, 20, 15);
  scene.add(mainLight);

  const rimLight = new THREE.DirectionalLight(0x3b82f6, 2.0);
  rimLight.position.set(-15, -5, -15);
  scene.add(rimLight);

  const grid = new THREE.GridHelper(40, 40, 0x333344, 0x1a1a24);
  grid.position.y = -3;
  scene.add(grid);

  const geometry = new THREE.TorusKnotGeometry(2, 0.6, 128, 32);
  const material = new THREE.MeshPhysicalMaterial({ 
    color: 0xf8fafc,
    metalness: 0.1,
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.2
  });
  centralObject = new THREE.Mesh(geometry, material);
  scene.add(centralObject);

  const cursorGeo = new THREE.RingGeometry(0.2, 0.35, 32);
  const localMat = new THREE.MeshBasicMaterial({ color: 0x34d399, side: THREE.DoubleSide }); 
  const remoteMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide }); 
  
  localCursorObj = new THREE.Mesh(cursorGeo, localMat);
  remoteCursorObj = new THREE.Mesh(cursorGeo, remoteMat);
  
  scene.add(localCursorObj);
  scene.add(remoteCursorObj);

  requestAnimationFrame(animate);
}

function handleResize(w: number, h: number) {
  screenW = Math.max(w, 1);
  screenH = Math.max(h, 1);
  if (renderer && camera) {
    camera.aspect = screenW / screenH;
    camera.updateProjectionMatrix();
    renderer.setSize(screenW, screenH, false);
  }
}

function updateCursorPosition(mesh: THREE.Mesh, targetX: number, targetY: number) {
  const planeZ = 5; 
  const targetVec = new THREE.Vector3(targetX * 8, targetY * 5, planeZ);
  mesh.position.lerp(targetVec, 0.15);
  mesh.lookAt(camera.position);
}

function animate(time: number) {
  requestAnimationFrame(animate);

  if (centralObject) {
    centralObject.rotation.y = time * 0.0005;
    centralObject.rotation.x = time * 0.0002;
  }

  if (localCursorObj) updateCursorPosition(localCursorObj, localTarget.x, localTarget.y);
  if (remoteCursorObj) updateCursorPosition(remoteCursorObj, remoteTarget.x, remoteTarget.y);

  renderer.render(scene, camera);
}