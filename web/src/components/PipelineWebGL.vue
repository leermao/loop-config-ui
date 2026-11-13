<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer
} from '../vendor/three.module.js';

const props = defineProps({
  stages: { type: Array, required: true },
  activeIndex: { type: Number, default: -1 },
  selectedIndex: { type: Number, default: 0 },
  running: { type: Boolean, default: false }
});

const emit = defineEmits(['ready', 'unavailable', 'select-stage']);
const hostRef = ref(null);
const raycaster = new Raycaster();
const pointerNdc = new Vector2();

const palette = {
  ink: 0x1c2724,
  paper: 0xfff8f2,
  pendingFace: 0xd8d1c2,
  pendingEdge: 0x53615b,
  completeFace: 0x2f7565,
  completeEdge: 0x17453a,
  activeFace: 0xd65a34,
  activeEdge: 0x87351f,
  signal: 0xd65a34,
  teal: 0x2f7565,
  brass: 0xb2802d
};

let renderer = null;
let camera = null;
let scene = null;
let resizeObserver = null;
let animationFrame = 0;
let running = props.running;
let animationTime = 0;
let previousFrame = 0;
let railLength = 9;
let baseCameraDistance = 4.8;
let cameraYaw = 0;
let cameraLift = 0;
let sweepStartedAt = -1;
let disposed = false;

let stations = [];
let dataPoints = null;
let dataState = [];
let dustPoints = null;
let activeRing = null;
let activeRingInner = null;
let selectedBeacon = null;
let selectedLight = null;
let sweepGroup = null;
let sweepCore = null;

function stageState(index) {
  if (props.activeIndex < 0) return 'pending';
  if (index < props.activeIndex) return 'complete';
  if (index === props.activeIndex) return 'active';
  return 'pending';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function createDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.28, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.24)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  gradient.addColorStop(0.28, 'rgba(255, 255, 255, 0.22)');
  gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.045)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createLabelTexture(stage, index) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');

  context.clearRect(0, 0, 512, 128);
  context.strokeStyle = 'rgba(255, 255, 255, 0.34)';
  context.lineWidth = 2;
  context.strokeRect(2, 2, 508, 124);

  context.fillStyle = '#ffffff';
  context.font = '800 84px "Arial Narrow", "Helvetica Neue", sans-serif';
  context.textBaseline = 'middle';
  context.fillText(String(index + 1).padStart(2, '0'), 24, 67);

  context.font = '700 25px "SFMono-Regular", Menlo, monospace';
  context.textAlign = 'right';
  context.letterSpacing = '2px';
  context.fillText(String(stage.code || '').toUpperCase(), 486, 70);

  context.beginPath();
  context.arc(386, 67, 5, 0, Math.PI * 2);
  context.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function addLights() {
  scene.add(new AmbientLight(0xfff5e7, 1.25));

  const key = new DirectionalLight(0xfff1dc, 2.35);
  key.position.set(2.8, 5.4, 4.6);
  scene.add(key);

  const fill = new DirectionalLight(0x5d9989, 1.05);
  fill.position.set(-4.5, 2.8, 2.4);
  scene.add(fill);

  const rim = new DirectionalLight(0xd65a34, 0.75);
  rim.position.set(0, 1.7, -3.8);
  scene.add(rim);

  selectedLight = new PointLight(palette.signal, 0, 4.4, 2);
  scene.add(selectedLight);
}

function addRail() {
  const rail = new Mesh(
    new CylinderGeometry(0.018, 0.018, railLength, 8),
    new MeshStandardMaterial({
      color: palette.ink,
      roughness: 0.48,
      metalness: 0.45
    })
  );
  rail.rotation.z = Math.PI / 2;
  rail.position.y = 0.11;
  scene.add(rail);

  const energy = new Mesh(
    new BoxGeometry(railLength + 0.18, 0.01, 0.032),
    new MeshBasicMaterial({
      color: palette.signal,
      transparent: true,
      opacity: 0.72,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  energy.position.y = 0.116;
  scene.add(energy);

  const glowTexture = createGlowTexture();
  const floorGlow = new Mesh(
    new PlaneGeometry(railLength + 1.8, 3.6),
    new MeshBasicMaterial({
      map: glowTexture,
      color: palette.teal,
      transparent: true,
      opacity: 0.15,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set(0, 0.002, 0.32);
  scene.add(floorGlow);

  const grid = new GridHelper(railLength * 1.7, 34, palette.teal, palette.teal);
  grid.position.y = 0.001;
  grid.material.transparent = true;
  grid.material.opacity = 0.1;
  grid.material.depthWrite = false;
  scene.add(grid);
}

function buildStations() {
  const unitBox = new BoxGeometry(1, 1, 1);
  const unitEdges = new EdgesGeometry(unitBox);
  const pylonGeometry = new CylinderGeometry(0.018, 0.018, 0.22, 8);
  const lightGeometry = new OctahedronGeometry(0.026, 0);
  const shadowTexture = createGlowTexture();
  const stageCount = Math.max(1, props.stages.length);
  const spread = Math.min(9.4, Math.max(6.1, stageCount * 1.3));
  const spacing = stageCount > 1 ? spread / (stageCount - 1) : 0;
  const slabWidth = Math.min(0.94, Math.max(0.68, spacing * 0.66));
  const slabDepth = 0.6;
  railLength = spread + 1.1;

  for (let index = 0; index < stageCount; index += 1) {
    const stage = props.stages[index] || { code: `S${index + 1}` };
    const x = stageCount > 1
      ? -spread / 2 + spacing * index
      : 0;
    const group = new Group();
    group.position.x = x;

    const faceMaterial = new MeshStandardMaterial({
      color: palette.pendingFace,
      roughness: 0.72,
      metalness: 0.08,
      emissive: palette.ink,
      emissiveIntensity: 0
    });
    const slab = new Mesh(unitBox, faceMaterial);
    slab.position.set(0, 0.3, 0);
    slab.scale.set(slabWidth, 0.15, slabDepth);
    slab.userData.stationIndex = index;
    group.add(slab);

    const edgeMaterial = new LineBasicMaterial({
      color: palette.pendingEdge,
      transparent: true,
      opacity: 0.58
    });
    const edges = new LineSegments(unitEdges, edgeMaterial);
    edges.position.copy(slab.position);
    edges.scale.copy(slab.scale);
    group.add(edges);

    const labelTexture = createLabelTexture(stage, index);
    const labelMaterial = new MeshBasicMaterial({
      map: labelTexture,
      color: palette.pendingEdge,
      transparent: true,
      depthWrite: false,
      side: DoubleSide
    });
    const label = new Mesh(
      new PlaneGeometry(slabWidth * 0.88, 0.24),
      labelMaterial
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.379, 0.015);
    group.add(label);

    const pylon = new Mesh(
      pylonGeometry,
      new MeshStandardMaterial({
        color: palette.pendingEdge,
        roughness: 0.55,
        metalness: 0.36
      })
    );
    pylon.position.set(0, 0.18, 0.12);
    group.add(pylon);

    const stateLightMaterial = new MeshBasicMaterial({ color: palette.pendingEdge });
    const stateLight = new Mesh(lightGeometry, stateLightMaterial);
    stateLight.position.set(slabWidth * 0.34, 0.4, 0.22);
    group.add(stateLight);

    const shadow = new Mesh(
      new PlaneGeometry(slabWidth * 1.35, 0.9),
      new MeshBasicMaterial({
        map: shadowTexture,
        color: palette.ink,
        transparent: true,
        opacity: 0.16,
        depthWrite: false
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x + 0.08, 0.004, 0.12);
    scene.add(shadow);

    group.userData = { index, x, slabWidth };
    scene.add(group);
    stations.push({
      group,
      slab,
      edges,
      label,
      pylon,
      stateLight,
      faceMaterial,
      edgeMaterial,
      labelMaterial,
      stateLightMaterial,
      pylonMaterial: pylon.material,
      shadow,
      x,
      targetScale: 1,
      targetY: 0
    });
  }
}

function addDataStream() {
  const dotTexture = createDotTexture();
  const count = 74;
  const positions = new Float32Array(count * 3);
  dataState = [];

  for (let index = 0; index < count; index += 1) {
    const progress = Math.random();
    const z = (Math.random() - 0.5) * 0.24;
    const phase = Math.random() * Math.PI * 2;
    dataState.push({
      progress,
      speed: 0.035 + Math.random() * 0.075,
      z,
      phase
    });
    positions[index * 3] = -railLength / 2 + progress * railLength;
    positions[index * 3 + 1] = 0.13;
    positions[index * 3 + 2] = z;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    map: dotTexture,
    color: palette.signal,
    size: 0.075,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true
  });
  dataPoints = new Points(geometry, material);
  scene.add(dataPoints);

  const dustCount = 190;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let index = 0; index < dustCount; index += 1) {
    dustPositions[index * 3] = (Math.random() - 0.5) * (railLength + 2.2);
    dustPositions[index * 3 + 1] = 0.1 + Math.random() * 1.65;
    dustPositions[index * 3 + 2] = (Math.random() - 0.5) * 2.8;
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute('position', new Float32BufferAttribute(dustPositions, 3));
  const dustMaterial = new PointsMaterial({
    map: dotTexture,
    color: palette.teal,
    size: 0.026,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true
  });
  dustPoints = new Points(dustGeometry, dustMaterial);
  scene.add(dustPoints);
}

function addIndicators() {
  const ringMaterial = new MeshBasicMaterial({
    color: palette.signal,
    transparent: true,
    opacity: 0.62,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending
  });
  activeRing = new Mesh(new RingGeometry(0.36, 0.4, 64), ringMaterial);
  activeRing.rotation.x = -Math.PI / 2;
  activeRing.position.y = 0.014;
  scene.add(activeRing);

  activeRingInner = new Mesh(
    new RingGeometry(0.24, 0.255, 48),
    ringMaterial.clone()
  );
  activeRingInner.rotation.x = -Math.PI / 2;
  activeRingInner.position.y = 0.016;
  scene.add(activeRingInner);

  selectedBeacon = new Mesh(
    new OctahedronGeometry(0.075, 0),
    new MeshStandardMaterial({
      color: palette.signal,
      emissive: palette.signal,
      emissiveIntensity: 1.35,
      roughness: 0.28,
      metalness: 0.22
    })
  );
  scene.add(selectedBeacon);

  const sweepTexture = createGlowTexture();
  sweepGroup = new Group();
  sweepCore = new Mesh(
    new PlaneGeometry(0.075, 1.05),
    new MeshBasicMaterial({
      color: palette.signal,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide
    })
  );
  sweepCore.position.y = 0.56;
  sweepGroup.add(sweepCore);

  const sweepHalo = new Mesh(
    new PlaneGeometry(0.62, 1.15),
    new MeshBasicMaterial({
      map: sweepTexture,
      color: palette.signal,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      blending: AdditiveBlending
    })
  );
  sweepHalo.position.y = 0.56;
  sweepGroup.add(sweepHalo);
  sweepGroup.visible = false;
  scene.add(sweepGroup);
}

function updateStageMaterials() {
  stations.forEach((station, index) => {
    const state = stageState(index);
    const selected = index === props.selectedIndex;
    const active = state === 'active';
    const complete = state === 'complete';

    const face = active
      ? palette.activeFace
      : complete
        ? palette.completeFace
        : palette.pendingFace;
    const edge = selected
      ? palette.signal
      : active
        ? palette.activeEdge
        : complete
          ? palette.completeEdge
          : palette.pendingEdge;
    const label = selected || active || complete
      ? palette.paper
      : palette.ink;

    station.faceMaterial.color.setHex(face);
    station.faceMaterial.emissive.setHex(active ? palette.signal : palette.ink);
    station.faceMaterial.emissiveIntensity = active ? 0.24 : 0;
    station.edgeMaterial.color.setHex(edge);
    station.edgeMaterial.opacity = selected ? 1 : 0.58;
    station.labelMaterial.color.setHex(label);
    station.stateLightMaterial.color.setHex(edge);
    station.pylonMaterial.color.setHex(edge);
    station.pylonMaterial.emissive.setHex(active ? palette.signal : palette.ink);
    station.pylonMaterial.emissiveIntensity = active ? 0.35 : 0;
    station.targetScale = selected ? 1.055 : active ? 1.085 : 1;
    station.targetY = selected ? 0.06 : active ? 0.035 : 0;
    station.shadow.material.opacity = selected ? 0.2 : active ? 0.17 : 0.13;
  });

  const activeStation = stations[props.activeIndex] || null;
  activeRing.visible = Boolean(activeStation);
  activeRingInner.visible = Boolean(activeStation);
  if (activeStation) {
    activeRing.position.x = activeStation.x;
    activeRingInner.position.x = activeStation.x;
  }

  const selectedStation = stations[props.selectedIndex] || null;
  selectedBeacon.visible = Boolean(selectedStation);
  if (selectedStation) {
    selectedBeacon.position.set(selectedStation.x, 0.83, 0.18);
    selectedLight.position.set(selectedStation.x, 0.72, 0.22);
  }
  selectedLight.intensity = selectedStation ? 3.2 : 0;

  if (!running) {
    stations.forEach((station) => {
      station.group.position.y = station.targetY;
      station.group.scale.setScalar(station.targetScale);
    });
  }
}

function triggerSweep() {
  if (!running || props.activeIndex < 0) return;
  sweepStartedAt = animationTime;
  sweepGroup.visible = true;
}

function updateDataStream(delta) {
  const positions = dataPoints.geometry.attributes.position.array;
  const start = -railLength / 2;

  for (let index = 0; index < dataState.length; index += 1) {
    const item = dataState[index];
    item.progress = (item.progress + delta * item.speed) % 1;
    positions[index * 3] = start + item.progress * railLength;
    positions[index * 3 + 1] = 0.13 + Math.sin(animationTime * 3.8 + item.phase) * 0.012;
    positions[index * 3 + 2] = item.z + Math.cos(animationTime * 2.2 + item.phase) * 0.018;
  }
  dataPoints.geometry.attributes.position.needsUpdate = true;
  dataPoints.material.opacity = 0.78 + Math.sin(animationTime * 1.7) * 0.1;

  dustPoints.rotation.y = Math.sin(animationTime * 0.11) * 0.055;
  dustPoints.position.y = Math.sin(animationTime * 0.42) * 0.025;
}

function updateCamera(delta) {
  const amount = 1 - Math.exp(-delta * 4.8);
  const pointerX = cameraYaw;
  const pointerY = cameraLift;
  const selectedX = stations[props.selectedIndex]?.x || 0;
  const baseY = baseCameraDistance * 0.53;
  const baseZ = baseCameraDistance * 0.848;

  camera.position.x = lerp(camera.position.x, pointerX * 0.3, amount);
  camera.position.y = lerp(camera.position.y, baseY + pointerY * 0.1, amount);
  camera.position.z = lerp(camera.position.z, baseZ, amount);
  camera.lookAt(selectedX * 0.075 + pointerX * 0.12, 0.12, 0);
}

function updateIndicators() {
  if (activeRing.visible) {
    const pulse = 1 + Math.sin(animationTime * 2.8) * 0.055;
    const outerPulse = 1 + Math.sin(animationTime * 2.8 + 1.2) * 0.035;
    activeRing.scale.setScalar(pulse);
    activeRingInner.scale.setScalar(outerPulse);
    activeRing.material.opacity = 0.48 + Math.sin(animationTime * 2.8) * 0.12;
    activeRingInner.material.opacity = 0.26 + Math.sin(animationTime * 2.8 + 1.2) * 0.08;
  }

  if (selectedBeacon.visible) {
    selectedBeacon.position.y = 0.83 + Math.sin(animationTime * 3.2) * 0.035;
    selectedBeacon.rotation.y += 0.012;
    selectedBeacon.rotation.z = Math.sin(animationTime * 1.7) * 0.16;
  }

  if (sweepStartedAt >= 0) {
    const progress = clamp((animationTime - sweepStartedAt) / 0.82, 0, 1);
    sweepGroup.position.x = lerp(-railLength / 2 - 0.2, railLength / 2 + 0.2, progress);
    sweepGroup.position.z = 0.26;
    sweepGroup.visible = progress < 1;
    sweepCore.material.opacity = (1 - progress) * 0.42;
    sweepGroup.children[1].material.opacity = (1 - progress) * 0.18;
    if (progress >= 1) sweepStartedAt = -1;
  }
}

function updateStationMotion() {
  stations.forEach((station, index) => {
    const boot = easeOutCubic(clamp((animationTime - index * 0.055) / 0.58, 0, 1));
    const targetY = station.targetY - (1 - boot) * 0.22;
    const targetScale = station.targetScale * (0.94 + boot * 0.06);
    const amount = 1 - Math.exp(-0.018 * 7.5);
    station.group.position.y = lerp(station.group.position.y, targetY, amount);
    const scale = lerp(station.group.scale.x, targetScale, amount);
    station.group.scale.setScalar(scale);
  });
}

function renderFrame() {
  if (!renderer || !camera || disposed) return;
  renderer.render(scene, camera);
}

function animate(now) {
  if (!running || disposed) return;
  const delta = previousFrame ? Math.min((now - previousFrame) / 1000, 0.05) : 0;
  previousFrame = now;
  animationTime += delta;

  updateDataStream(delta);
  updateCamera(delta);
  updateIndicators();
  updateStationMotion();
  renderFrame();
  animationFrame = requestAnimationFrame(animate);
}

function startLoop() {
  if (animationFrame || disposed) return;
  previousFrame = performance.now();
  animationFrame = requestAnimationFrame(animate);
}

function stopLoop() {
  if (!animationFrame) return;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  previousFrame = 0;
}

function resize() {
  if (!renderer || !camera || !hostRef.value) return;
  const width = Math.max(1, hostRef.value.clientWidth);
  const height = Math.max(1, hostRef.value.clientHeight);
  const aspect = width / height;
  const fitWidth = railLength + 2.6;
  const verticalFov = 22 * (Math.PI / 180);
  const requiredDistance = fitWidth / (2 * aspect * Math.tan(verticalFov / 2));
  baseCameraDistance = Math.max(4.72, requiredDistance);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height, false);
  camera.aspect = aspect;
  camera.position.set(
    camera.position.x,
    baseCameraDistance * 0.53 + cameraLift * 0.1,
    baseCameraDistance * 0.848
  );
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0.12, 0);
  renderFrame();
}

function handlePointerMove(event) {
  if (!hostRef.value || !running) return;
  const rect = hostRef.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  cameraYaw = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
  cameraLift = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
}

function handleClick(event) {
  if (!camera || !hostRef.value) return;
  const rect = hostRef.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  pointerNdc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObjects(stations.map((station) => station.slab), false)[0];
  if (hit) emit('select-stage', hit.object.userData.stationIndex);
}

function resetPointer() {
  cameraYaw = 0;
  cameraLift = 0;
}

function handleContextLost(event) {
  event.preventDefault();
  stopLoop();
  emit('unavailable');
}

function createRenderer() {
  renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.className = 'webgl-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);
  hostRef.value.appendChild(renderer.domElement);
}

function initialize() {
  try {
    createRenderer();
    scene = new Scene();
    camera = new PerspectiveCamera(22, 1, 0.1, 30);
    addLights();
    buildStations();
    addRail();
    addDataStream();
    addIndicators();
    updateStageMaterials();
    resize();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(hostRef.value);
    }

    hostRef.value.addEventListener('pointermove', handlePointerMove, { passive: true });
    hostRef.value.addEventListener('pointerleave', resetPointer, { passive: true });
    hostRef.value.addEventListener('click', handleClick);

    if (running) {
      startLoop();
    } else {
      animationTime = 1;
      updateStationMotion();
      renderFrame();
    }
    emit('ready');
  } catch (error) {
    emit('unavailable', error);
  }
}

function disposeScene() {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  scene?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    objectMaterials.forEach((material) => {
      materials.add(material);
      if (material.map) textures.add(material.map);
      if (material.alphaMap) textures.add(material.alphaMap);
    });
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
  resizeObserver?.disconnect();
  hostRef.value?.removeEventListener('pointermove', handlePointerMove);
  hostRef.value?.removeEventListener('pointerleave', resetPointer);
  hostRef.value?.removeEventListener('click', handleClick);
  renderer?.domElement.removeEventListener('webglcontextlost', handleContextLost);
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer?.domElement.remove();
}

watch(() => props.selectedIndex, () => {
  updateStageMaterials();
  renderFrame();
});

watch(() => props.activeIndex, (next, previous) => {
  updateStageMaterials();
  if (next !== previous && next >= 0) triggerSweep();
  renderFrame();
});

watch(() => props.running, (next) => {
  running = next;
  if (next) {
    startLoop();
  } else {
    stopLoop();
    renderFrame();
  }
});

onMounted(initialize);

onBeforeUnmount(() => {
  disposed = true;
  stopLoop();
  disposeScene();
});
</script>

<template>
  <div ref="hostRef" class="webgl-stage" aria-hidden="true"></div>
</template>

<style scoped>
.webgl-stage {
  position: absolute;
  inset: 0;
  cursor: pointer;
  pointer-events: auto;
}

.webgl-stage :deep(.webgl-canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
