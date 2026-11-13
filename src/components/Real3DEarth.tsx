import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Real3DEarthProps {
  groupName: string;
  shiftType: string;
  isNight: boolean;
  isLight: boolean;
  members: string;
  remainText: string;
  progressFrac: number;
}

interface Star {
  nx: number;
  ny: number;
  radius: number;
  baseAlpha: number;
  phase: number;
  speed: number;
  color: string;
}

// Module-level cached NASA high-resolution seamless equirectangular textures
const textureLoader = new THREE.TextureLoader();
let cachedDayTexture: THREE.Texture | null = null;
let cachedNightTexture: THREE.Texture | null = null;
let cachedBumpTexture: THREE.Texture | null = null;
let cachedCloudTexture: THREE.Texture | null = null;

function configureSeamlessTexture(tex: THREE.Texture, isColorMap: boolean): THREE.Texture {
  if (isColorMap) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function getEarthTextures() {
  if (!cachedDayTexture) {
    cachedDayTexture = configureSeamlessTexture(
      textureLoader.load('/textures/earth-day.jpg'),
      true
    );
  }
  if (!cachedNightTexture) {
    cachedNightTexture = configureSeamlessTexture(
      textureLoader.load('/textures/earth-night.jpg'),
      true
    );
  }
  if (!cachedBumpTexture) {
    cachedBumpTexture = configureSeamlessTexture(
      textureLoader.load('/textures/earth-bump.png'),
      false
    );
  }
  if (!cachedCloudTexture) {
    cachedCloudTexture = configureSeamlessTexture(
      textureLoader.load('/textures/earth-clouds.png'),
      true
    );
  }
  return {
    dayTexture: cachedDayTexture,
    nightTexture: cachedNightTexture,
    bumpTexture: cachedBumpTexture,
    cloudTexture: cachedCloudTexture,
  };
}

let cachedMoonSprite: HTMLCanvasElement | null = null;
let moonLoadingTriggered = false;

function ensureMoonSpriteLoaded(onReady?: () => void) {
  if (cachedMoonSprite) {
    return cachedMoonSprite;
  }
  if (moonLoadingTriggered) return null;
  moonLoadingTriggered = true;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const srcW = img.width || 1024;
    const srcH = img.height || 512;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return;
    srcCtx.drawImage(img, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

    const size = 96;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = size;
    outCanvas.height = size;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return;

    const outImg = outCtx.createImageData(size, size);
    const outData = outImg.data;
    const rMax = size / 2 - 2;

    const lx = -0.28;
    const ly = -0.22;
    const lz = 0.934;

    for (let py = 0; py < size; py++) {
      const ny = (py - size / 2) / rMax;
      for (let px = 0; px < size; px++) {
        const nx = (px - size / 2) / rMax;
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;

        const nz = Math.sqrt(1 - r2);
        const lon = Math.atan2(nx, nz);
        const lat = Math.asin(ny);
        const u = ((0.5 + lon / (2 * Math.PI)) % 1 + 1) % 1;
        const v = Math.max(0, Math.min(1, 0.5 + lat / Math.PI));

        const tx = Math.min(srcW - 1, Math.floor(u * srcW));
        const ty = Math.min(srcH - 1, Math.floor(v * srcH));
        const sIdx = (ty * srcW + tx) * 4;
        const texLum = srcData[sIdx] / 255;

        const ndotl = Math.max(0.15, nx * lx + ny * ly + nz * lz);
        const lommel = ndotl / (ndotl + nz * 0.55);
        const contrastLum = Math.pow(texLum, 1.15) * 1.08;
        const shade = Math.min(1, contrastLum * (0.48 + 0.72 * lommel));

        const r = Math.min(255, Math.round(shade * 255));
        const g = Math.min(255, Math.round(shade * 251));
        const b = Math.min(255, Math.round(shade * 240));

        const dist = Math.sqrt(r2);
        const edgeAlpha = dist > 0.95 ? Math.max(0, (1 - dist) / 0.05) : 1;

        const oIdx = (py * size + px) * 4;
        outData[oIdx] = r;
        outData[oIdx + 1] = g;
        outData[oIdx + 2] = b;
        outData[oIdx + 3] = Math.round(edgeAlpha * 255);
      }
    }

    outCtx.putImageData(outImg, 0, 0);
    cachedMoonSprite = outCanvas;
    if (onReady) onReady();
  };
  img.src = '/textures/moon.jpg';
  return null;
}

export const Real3DEarth: React.FC<Real3DEarthProps> = ({
  groupName,
  shiftType,
  isLight,
  members,
  remainText,
  progressFrac,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const earthStageRef = useRef<HTMLDivElement | null>(null);
  const skyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const prevMouseXRef = useRef<number>(0);
  const dragVelocityRef = useRef<number>(0);

  // Dark mode = Gece görüntüsü (Stars + Moon + Night Earth)
  // Light mode = Gündüz görüntüsü (Sun + Blue Sky Atmosphere + Day Earth)
  const isDarkTheme = !isLight;

  // 1. Full-Upper-Screen Sky Canvas (starts right above the 5 group boxes and extends all the way to y=0 at the top of the screen)
  useEffect(() => {
    const skyCanvas = skyCanvasRef.current;
    const wrapper = wrapperRef.current;
    if (!skyCanvas || !wrapper) return;
    const ctx = skyCanvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 430;
    let height = 400;
    let earthCenterY = 220;

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      // Distance from the very top of the viewport (y=0) to the top of wrapper
      const topGap = Math.max(0, Math.round(rect.top));
      // Extend 21px below wrapper so it meets the top border of the 5 group boxes
      const bottomExtend = 21;
      const totalH = Math.max(320, Math.round(rect.height + topGap + bottomExtend));
      const totalW = Math.max(360, Math.round(rect.width + 56));

      skyCanvas.style.top = `-${topGap}px`;
      skyCanvas.style.height = `${totalH}px`;

      width = totalW;
      height = totalH;
      earthCenterY = topGap + rect.height * 0.5;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      skyCanvas.width = width * dpr;
      skyCanvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateSize();
    ensureMoonSpriteLoaded();

    // Sparse, simple, realistic stars distributed from the very top of the screen (ny=0.03)
    // down to just above the 5 group boxes (ny=0.92)
    const starSeeds: Array<[number, number, number, number, string]> = [
      // Top sky band right near the top edge of the screen
      [0.08, 0.04, 1.05, 0.78, '#FFFFFF'],
      [0.22, 0.03, 0.85, 0.62, '#E0F2FE'],
      [0.37, 0.05, 1.30, 0.90, '#FFFFFF'],
      [0.52, 0.03, 0.80, 0.58, '#FEF3C7'],
      [0.67, 0.04, 1.15, 0.82, '#E0F2FE'],
      [0.83, 0.05, 0.90, 0.65, '#FFFFFF'],
      [0.94, 0.04, 1.10, 0.76, '#FFFFFF'],
      // Upper-mid sky band
      [0.06, 0.13, 0.90, 0.64, '#FEF3C7'],
      [0.16, 0.11, 1.35, 0.92, '#E0F2FE'],
      [0.29, 0.12, 0.80, 0.56, '#FFFFFF'],
      [0.45, 0.10, 0.95, 0.68, '#FFFFFF'],
      [0.60, 0.11, 0.85, 0.60, '#E0F2FE'],
      [0.74, 0.12, 1.10, 0.75, '#FFFFFF'],
      [0.93, 0.14, 1.25, 0.86, '#E0F2FE'],
      // Left sky column down to the top of the 5 group boxes
      [0.09, 0.25, 1.15, 0.80, '#FFFFFF'],
      [0.18, 0.29, 0.80, 0.55, '#E0F2FE'],
      [0.06, 0.39, 0.95, 0.68, '#FEF3C7'],
      [0.12, 0.51, 0.85, 0.60, '#FFFFFF'],
      [0.05, 0.63, 1.30, 0.88, '#E0F2FE'],
      [0.11, 0.75, 0.90, 0.64, '#FFFFFF'],
      [0.06, 0.86, 1.10, 0.76, '#FEF3C7'],
      [0.15, 0.91, 0.85, 0.60, '#FFFFFF'],
      // Right sky column down to the top of the 5 group boxes
      [0.93, 0.27, 0.90, 0.64, '#FFFFFF'],
      [0.88, 0.38, 1.15, 0.80, '#FEF3C7'],
      [0.94, 0.50, 1.25, 0.85, '#FFFFFF'],
      [0.89, 0.62, 0.85, 0.58, '#E0F2FE'],
      [0.94, 0.74, 1.05, 0.74, '#FFFFFF'],
      [0.86, 0.85, 1.30, 0.88, '#FEF3C7'],
      [0.93, 0.91, 0.90, 0.62, '#E0F2FE'],
    ];

    const stars: Star[] = starSeeds.map(([nx, ny, radius, baseAlpha, color], idx) => ({
      nx,
      ny,
      radius,
      baseAlpha,
      phase: idx * 1.37,
      speed: 0.009 + (idx % 5) * 0.003,
      color,
    }));

    // Smoothly fade only in the bottom 10% right above the 5 group boxes
    const getBottomSkyFade = (y: number) => {
      const ny = y / Math.max(1, height);
      if (ny <= 0.88) return 1;
      const t = Math.max(0, 1 - (ny - 0.88) / 0.12);
      return t * t * (3 - 2 * t);
    };

    const renderSky = () => {
      ctx.clearRect(0, 0, width, height);
      const earthCenterX = width * 0.5;
      const earthRadius = 148;

      if (isDarkTheme) {
        // NIGHT VIEW: Deep cosmic night gradient from y=0 (very top of screen) down to the group boxes
        const nightSkyGrad = ctx.createLinearGradient(0, 0, 0, height);
        nightSkyGrad.addColorStop(0, 'rgba(15, 23, 58, 0.88)');
        nightSkyGrad.addColorStop(0.45, 'rgba(17, 24, 52, 0.55)');
        nightSkyGrad.addColorStop(0.85, 'rgba(12, 18, 36, 0.25)');
        nightSkyGrad.addColorStop(1, 'rgba(9, 13, 22, 0)');
        ctx.fillStyle = nightSkyGrad;
        ctx.fillRect(0, 0, width, height);

        // Subtle cosmic zenith glow near the top of the screen
        const zenithGlow = ctx.createRadialGradient(
          width * 0.5,
          height * 0.12,
          10,
          width * 0.5,
          height * 0.12,
          width * 0.65
        );
        zenithGlow.addColorStop(0, 'rgba(59, 130, 246, 0.14)');
        zenithGlow.addColorStop(0.6, 'rgba(79, 70, 229, 0.06)');
        zenithGlow.addColorStop(1, 'rgba(9, 13, 22, 0)');
        ctx.fillStyle = zenithGlow;
        ctx.fillRect(0, 0, width, height);

        // Sparse, realistic stars around and above the Earth
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          s.phase += s.speed;
          let sx = s.nx * width;
          let sy = s.ny * height;

          // Ensure no star is hidden behind the 3D Earth sphere
          const dx = sx - earthCenterX;
          const dy = sy - earthCenterY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < earthRadius + 8 && dist > 0.1) {
            const push = (earthRadius + 14) / dist;
            sx = earthCenterX + dx * push;
            sy = earthCenterY + dy * push;
          }

          const fade = getBottomSkyFade(sy);
          if (fade <= 0.02) continue;

          const twinkle = 0.78 + 0.22 * Math.sin(s.phase);
          const alpha = s.baseAlpha * twinkle * fade;

          // Natural atmospheric halo on brighter stars
          if (s.radius >= 1.1) {
            const starGlow = ctx.createRadialGradient(sx, sy, 0, sx, sy, s.radius * 4.2);
            starGlow.addColorStop(0, `rgba(224, 242, 254, ${alpha * 0.38})`);
            starGlow.addColorStop(1, 'rgba(224, 242, 254, 0)');
            ctx.fillStyle = starGlow;
            ctx.beginPath();
            ctx.arc(sx, sy, s.radius * 4.2, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.globalAlpha = alpha;
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(sx, sy, s.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Calm realistic Moon in upper-right sky
        const moonX = width * 0.83;
        const moonY = Math.max(38, earthCenterY - 122);
        const moonR = 16;

        const lunarHalo = ctx.createRadialGradient(
          moonX,
          moonY,
          moonR * 0.7,
          moonX,
          moonY,
          moonR * 3.5
        );
        lunarHalo.addColorStop(0, 'rgba(255, 251, 235, 0.28)');
        lunarHalo.addColorStop(0.5, 'rgba(203, 213, 225, 0.09)');
        lunarHalo.addColorStop(1, 'rgba(9, 13, 22, 0)');
        ctx.fillStyle = lunarHalo;
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonR * 3.5, 0, Math.PI * 2);
        ctx.fill();

        if (cachedMoonSprite) {
          ctx.save();
          ctx.globalAlpha = 0.94;
          ctx.drawImage(
            cachedMoonSprite,
            moonX - moonR,
            moonY - moonR,
            moonR * 2,
            moonR * 2
          );
          ctx.restore();
        }
      } else {
        // DAY VIEW: Realistic Blue Sky Atmosphere & Sun from y=0 (very top of screen) down to the group boxes
        const daySkyGrad = ctx.createLinearGradient(0, 0, 0, height);
        daySkyGrad.addColorStop(0, 'rgba(56, 189, 248, 0.52)');
        daySkyGrad.addColorStop(0.38, 'rgba(125, 211, 252, 0.34)');
        daySkyGrad.addColorStop(0.75, 'rgba(186, 230, 253, 0.16)');
        daySkyGrad.addColorStop(0.92, 'rgba(224, 242, 254, 0.06)');
        daySkyGrad.addColorStop(1, 'rgba(248, 250, 252, 0)');
        ctx.fillStyle = daySkyGrad;
        ctx.fillRect(0, 0, width, height);

        // Realistic Sun in the upper-left sky
        const sunX = width * 0.17;
        const sunY = Math.max(40, earthCenterY - 120);
        const sunR = 16;

        // Wide warm atmospheric sunlight scatter
        const outerSolarScatter = ctx.createRadialGradient(
          sunX,
          sunY,
          sunR * 0.5,
          sunX,
          sunY,
          sunR * 11
        );
        outerSolarScatter.addColorStop(0, 'rgba(254, 240, 138, 0.68)');
        outerSolarScatter.addColorStop(0.32, 'rgba(251, 191, 36, 0.28)');
        outerSolarScatter.addColorStop(0.68, 'rgba(125, 211, 252, 0.14)');
        outerSolarScatter.addColorStop(1, 'rgba(248, 250, 252, 0)');
        ctx.fillStyle = outerSolarScatter;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * 11, 0, Math.PI * 2);
        ctx.fill();

        // Mid solar corona
        const midCorona = ctx.createRadialGradient(
          sunX,
          sunY,
          sunR * 0.2,
          sunX,
          sunY,
          sunR * 3.6
        );
        midCorona.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
        midCorona.addColorStop(0.35, 'rgba(254, 240, 138, 0.72)');
        midCorona.addColorStop(0.7, 'rgba(251, 191, 36, 0.24)');
        midCorona.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = midCorona;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * 3.6, 0, Math.PI * 2);
        ctx.fill();

        // Crisp bright solar disc
        const sunDisc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
        sunDisc.addColorStop(0, '#FFFFFF');
        sunDisc.addColorStop(0.65, '#FEF08A');
        sunDisc.addColorStop(1, 'rgba(250, 204, 21, 0.9)');
        ctx.fillStyle = sunDisc;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(renderSky);
    };

    animId = requestAnimationFrame(renderSky);

    const ro = new ResizeObserver(updateSize);
    ro.observe(wrapper);
    window.addEventListener('resize', updateSize);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [isDarkTheme]);

  // 2. Three.js 3D Earth (Real NASA Seamless Textures with Feathered Atmosphere)
  useEffect(() => {
    const container = earthStageRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const scene = new THREE.Scene();
    const width = container.clientWidth || 332;
    const height = container.clientHeight || 332;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 2.82);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.outline = 'none';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.position = 'relative';
    renderer.domElement.style.zIndex = '5';
    renderer.domElement.className =
      'cursor-grab active:cursor-grabbing select-none transition-all block w-full h-full';
    container.appendChild(renderer.domElement);

    const { dayTexture, nightTexture, bumpTexture, cloudTexture } = getEarthTextures();
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    dayTexture.anisotropy = maxAnisotropy;
    nightTexture.anisotropy = maxAnisotropy;
    cloudTexture.anisotropy = maxAnisotropy;

    const ambientLight = new THREE.AmbientLight(
      isDarkTheme ? 0xe2e8f0 : 0xffffff,
      isDarkTheme ? 0.9 : 1.25
    );
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(
      isDarkTheme ? 0xfef9c3 : 0xfff7ed,
      isDarkTheme ? 1.5 : 2.1
    );
    sunLight.position.set(isDarkTheme ? 2.5 : -2.5, 1.8, 2.8);
    scene.add(sunLight);

    // At Z=2.82, FOV=45 in a 332x332 stage (half-size = 166px):
    // earthRadius=0.99 projects to r=150.2px (300.4px diameter)
    // SVG rim & progress arc sit at r=153px (306px diameter, hugging the outside of the globe)
    // atmosphereRadius=1.054 projects to r=161.5px (< 166px canvas edge, zero top/bottom clipping)
    const earthRadius = 0.99;
    const earthGeometry = new THREE.SphereGeometry(earthRadius, 64, 64);
    const earthMaterial = new THREE.MeshStandardMaterial({
      map: isDarkTheme ? nightTexture : dayTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.022,
      roughness: isDarkTheme ? 0.72 : 0.58,
      metalness: 0.08,
      emissive: isDarkTheme ? new THREE.Color(0xffdfa3) : new THREE.Color(0x000000),
      emissiveMap: isDarkTheme ? nightTexture : null,
      emissiveIntensity: isDarkTheme ? 0.92 : 0,
    });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    earthMesh.rotation.y = -2.1;
    earthMesh.rotation.x = 0.18;
    scene.add(earthMesh);

    const cloudGeometry = new THREE.SphereGeometry(earthRadius * 1.012, 64, 64);
    const cloudMaterial = new THREE.MeshStandardMaterial({
      map: cloudTexture,
      transparent: true,
      opacity: isDarkTheme ? 0.2 : 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloudMesh.rotation.y = -2.1;
    cloudMesh.rotation.x = 0.18;
    scene.add(cloudMesh);

    // Feathered Outer Atmosphere Glow (fades smoothly to 0 before the 166px canvas border)
    const atmosphereRadius = earthRadius * 1.065;
    const atmosphereGeometry = new THREE.SphereGeometry(atmosphereRadius, 64, 64);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        uniform vec3 uColor;
        uniform vec3 uRimColor;
        uniform float uMaxAlpha;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float viewDot = max(0.0, -dot(vNormal, viewDir));
          float outerFade = smoothstep(0.10, 0.65, viewDot);
          float softCurve = pow(outerFade, 2.7);
          vec3 atmosphereColor = mix(uColor, uRimColor, softCurve);
          float alpha = softCurve * uMaxAlpha;
          gl_FragColor = vec4(atmosphereColor, alpha);
        }
      `,
      uniforms: {
        uColor: { value: new THREE.Color(isDarkTheme ? 0x6366f1 : 0x38bdf8) },
        uRimColor: { value: new THREE.Color(isDarkTheme ? 0xe0e7ff : 0xfef9c3) },
        uMaxAlpha: { value: isDarkTheme ? 0.22 : 0.24 },
      },
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    scene.add(atmosphereMesh);

    let animationFrameId: number;

    const animate = () => {
      if (!isDraggingRef.current) {
        earthMesh.rotation.y += 0.0009 + dragVelocityRef.current;
        cloudMesh.rotation.y += 0.0012 + dragVelocityRef.current;
        dragVelocityRef.current *= 0.94;
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 332;
      const h = container.clientHeight || 332;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    const onPointerDown = (e: PointerEvent) => {
      isDraggingRef.current = true;
      prevMouseXRef.current = e.clientX;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - prevMouseXRef.current;
      prevMouseXRef.current = e.clientX;
      const spinDelta = deltaX * 0.009;
      earthMesh.rotation.y += spinDelta;
      cloudMesh.rotation.y += spinDelta * 1.1;
      dragVelocityRef.current = spinDelta;
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
    };

    const domElement = renderer.domElement;
    domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      earthGeometry.dispose();
      earthMaterial.dispose();
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      atmosphereGeometry.dispose();
      atmosphereMaterial.dispose();
      renderer.dispose();
      if (domElement.parentElement) {
        domElement.parentElement.removeChild(domElement);
      }
    };
  }, [isDarkTheme, isLight]);

  const progressPct = Math.min(100, Math.max(0, Math.round(progressFrac * 100)));

  // In the 332x332 SVG viewBox (center 166,166), Earth surface is at r=150.2px.
  // Placing the rim circle & bottom progress arc at r=153 hugs the outer edge of the globe!
  const arcRadius = 153;
  const arcLength = 267.04;
  const arcOffset = arcLength * (1 - Math.min(1, Math.max(0, progressFrac)));

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-[304px] sm:h-[312px] -translate-y-[10px] mx-auto flex items-center justify-center select-none touch-none"
    >
      {/* Full-Upper-Screen Sky Canvas (dynamically anchored from y=0 at the very top of the screen down to right above the 5 group boxes) */}
      <canvas
        ref={skyCanvasRef}
        className="absolute -inset-x-7 w-[calc(100%+3.5rem)] pointer-events-none z-0"
        aria-hidden="true"
      />

      {/* Centered 332x332 Square WebGL Earth Stage */}
      <div
        ref={earthStageRef}
        className="relative w-[324px] h-[324px] sm:w-[332px] sm:h-[332px] shrink-0 flex items-center justify-center z-5"
      />

      {/* Matching 332x332 Outer Rim & Bottom Curved Progress Arc hugging the outside of the globe */}
      <svg
        className="absolute w-[324px] h-[324px] sm:w-[332px] sm:h-[332px] pointer-events-none z-10"
        viewBox="0 0 332 332"
      >
        {/* Faint full circle rim right outside the globe surface */}
        <circle
          cx="166"
          cy="166"
          r={arcRadius}
          fill="none"
          stroke={isDarkTheme ? 'rgba(99, 102, 241, 0.22)' : 'rgba(14, 165, 233, 0.26)'}
          strokeWidth="1.5"
        />
        {/* Bottom Progress Track (from bottom-left 140° to bottom-right 40° along r=153) */}
        <path
          d="M 48.8 264.4 A 153 153 0 0 0 283.2 264.4"
          fill="none"
          stroke={!isLight ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.14)'}
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Active Progress Arc */}
        {progressFrac > 0 && (
          <path
            d="M 48.8 264.4 A 153 153 0 0 0 283.2 264.4"
            fill="none"
            stroke="#f43f5e"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={arcOffset}
          />
        )}
      </svg>

      {/* Centered Overlay on the Globe */}
      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center px-5 pointer-events-none">
        {/* 1. Eyebrow Status Capsule */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-950/65 backdrop-blur-md border border-white/20 shadow-md">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
          <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white leading-normal">
            ŞU AN NÖBETTE
          </span>
        </div>

        {/* 2. Hero Group Title (solid white + textShadow, no bg-clip-text or overflow clipping) */}
        <h2
          className="font-display mt-2 py-0.5 text-[44px] sm:text-[48px] font-black tracking-tight text-white leading-none"
          style={{ textShadow: '0 4px 18px rgba(0,0,0,0.92), 0 2px 5px rgba(0,0,0,0.98)' }}
        >
          {groupName}
        </h2>

        {/* 3. Personnel Names (scaled down and aligned within the width of the group title) */}
        {members && (
          <p
            className="mt-1 text-[10.5px] sm:text-[11px] font-medium tracking-tight text-slate-100/95 max-w-[168px] sm:max-w-[182px] mx-auto text-center leading-tight"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.95)' }}
          >
            {members}
          </p>
        )}

        {/* 4. Shift Type Pill */}
        <div
          className={`mt-2.5 inline-flex items-center gap-1.5 px-4 py-1 rounded-full backdrop-blur-md border shadow-md ${
            shiftType.includes('Gündüz')
              ? 'bg-amber-950/65 border-amber-300/40 text-amber-50'
              : 'bg-indigo-950/65 border-indigo-300/40 text-indigo-50'
          }`}
        >
          <span className="text-xs leading-normal">
            {shiftType.includes('Gündüz') ? '☀️' : '🌙'}
          </span>
          <span className="text-xs font-bold tracking-wide text-white leading-normal">
            {shiftType}
          </span>
        </div>

        {/* 5. Progress % & Remaining Time */}
        {remainText && (
          <div
            className="mt-2 inline-flex items-center gap-1.5 text-xs tracking-wide tabular-nums leading-normal"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.95)' }}
          >
            <span className="font-extrabold text-rose-300">%{progressPct}</span>
            <span className="text-white/60">•</span>
            <span className="font-bold text-white">{remainText}</span>
          </div>
        )}
      </div>
    </div>
  );
};
