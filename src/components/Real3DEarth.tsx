import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AppThemeId } from '../types';
import { getThemePreset } from '../themes';

interface Real3DEarthProps {
  groupName: string;
  shiftType: string;
  isNight: boolean;
  isLight: boolean;
  themeId?: AppThemeId;
  members: string;
  remainText: string;
  progressFrac: number;
  isPaused?: boolean;
  compact?: boolean;
  cityName?: string;
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
  if (!cachedCloudTexture) {
    cachedCloudTexture = configureSeamlessTexture(
      textureLoader.load('/textures/earth-clouds.png'),
      true
    );
  }
  return {
    dayTexture: cachedDayTexture,
    nightTexture: cachedNightTexture,
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
  themeId,
  members,
  remainText,
  progressFrac,
  isPaused = false,
  compact = false,
  cityName,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const earthStageRef = useRef<HTMLDivElement | null>(null);
  const skyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const prevMouseXRef = useRef<number>(0);
  const dragVelocityRef = useRef<number>(0);
  const isPausedRef = useRef<boolean>(isPaused);
  isPausedRef.current = isPaused;

  const activeThemeId: AppThemeId = themeId || (isLight ? 'light' : 'dark');
  const themePreset = getThemePreset(activeThemeId);
  const isDarkTheme = !themePreset.isLight;

  // ============================================================================
  // 1. THEME-SPECIFIC UPPER-SCREEN SKY CANVAS & CELESTIAL ARTIFACTS
  // ============================================================================
  useEffect(() => {
    if (compact) return;
    const skyCanvas = skyCanvasRef.current;
    const wrapper = wrapperRef.current;
    if (!skyCanvas || !wrapper) return;
    const ctx = skyCanvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 430;
    let height = 400;
    let earthCenterY = 220;
    let timeTick = 0;

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      const topGap = Math.max(0, Math.round(rect.top));
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

    // Theme-specific star palette
    const themeStarPalette: Record<AppThemeId, [string, string, string]> = {
      dark: ['#FFFFFF', '#E0F2FE', '#FEF3C7'],
      light: ['#FFFFFF', '#E0F2FE', '#FEF08A'],
      emerald: ['#ECFDF5', '#6EE7B7', '#A7F3D0'],
      ocean: ['#F0F9FF', '#7DD3FC', '#38BDF8'],
      sunset: ['#FFF7ED', '#FDE68A', '#FDBA74'],
      amethyst: ['#FAF5FF', '#E9D5FF', '#F5D0FE'],
      amoled: ['#FFFFFF', '#F43F5E', '#E2E8F0'],
      sand: ['#FEF3C7', '#FDE68A', '#F59E0B'],
    };
    const [c1, c2, c3] = themeStarPalette[activeThemeId] || themeStarPalette.dark;

    const starSeeds: Array<[number, number, number, number, string]> = [
      [0.08, 0.04, 1.05, 0.78, c1],
      [0.22, 0.03, 0.85, 0.62, c2],
      [0.37, 0.05, 1.30, 0.90, c1],
      [0.52, 0.03, 0.80, 0.58, c3],
      [0.67, 0.04, 1.15, 0.82, c2],
      [0.83, 0.05, 0.90, 0.65, c1],
      [0.94, 0.04, 1.10, 0.76, c1],
      [0.06, 0.13, 0.90, 0.64, c3],
      [0.16, 0.11, 1.35, 0.92, c2],
      [0.29, 0.12, 0.80, 0.56, c1],
      [0.45, 0.10, 0.95, 0.68, c1],
      [0.60, 0.11, 0.85, 0.60, c2],
      [0.74, 0.12, 1.10, 0.75, c1],
      [0.93, 0.14, 1.25, 0.86, c2],
      [0.09, 0.25, 1.15, 0.80, c1],
      [0.18, 0.29, 0.80, 0.55, c2],
      [0.06, 0.39, 0.95, 0.68, c3],
      [0.12, 0.51, 0.85, 0.60, c1],
      [0.05, 0.63, 1.30, 0.88, c2],
      [0.11, 0.75, 0.90, 0.64, c1],
      [0.06, 0.86, 1.10, 0.76, c3],
      [0.15, 0.91, 0.85, 0.60, c1],
      [0.93, 0.27, 0.90, 0.64, c1],
      [0.88, 0.38, 1.15, 0.80, c3],
      [0.94, 0.50, 1.25, 0.85, c1],
      [0.89, 0.62, 0.85, 0.58, c2],
      [0.94, 0.74, 1.05, 0.74, c1],
      [0.86, 0.85, 1.30, 0.88, c3],
      [0.93, 0.91, 0.90, 0.62, c2],
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

    const getBottomSkyFade = (y: number) => {
      const ny = y / Math.max(1, height);
      if (ny <= 0.88) return 1;
      const t = Math.max(0, 1 - (ny - 0.88) / 0.12);
      return t * t * (3 - 2 * t);
    };

    const drawCrescentMoon = (
      cx: number,
      cy: number,
      r: number,
      bodyColor: string,
      glowRgba: string,
      shadowBgHex: string
    ) => {
      const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 3.2);
      halo.addColorStop(0, glowRgba);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = shadowBgHex;
      ctx.beginPath();
      ctx.arc(cx - r * 0.38, cy - r * 0.18, r * 0.86, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    let lastSkyDrawTs = 0;

    const renderSky = (nowTs: number) => {
      animId = requestAnimationFrame(renderSky);
      if (document.hidden || isPausedRef.current) return;
      // Throttle decorative 2D sky canvas to ~30fps to save mobile CPU & battery
      if (lastSkyDrawTs !== 0 && nowTs - lastSkyDrawTs < 32) return;
      lastSkyDrawTs = nowTs;

      timeTick += 0.032;
      ctx.clearRect(0, 0, width, height);
      const earthCenterX = width * 0.5;
      const earthRadius = 148;

      if (isDarkTheme) {
        // Base Sky Gradient
        const nightSkyGrad = ctx.createLinearGradient(0, 0, 0, height);
        nightSkyGrad.addColorStop(0, themePreset.skyTopRgba);
        nightSkyGrad.addColorStop(0.45, themePreset.skyMidRgba);
        nightSkyGrad.addColorStop(0.85, 'rgba(12, 18, 36, 0.18)');
        nightSkyGrad.addColorStop(1, 'rgba(9, 13, 22, 0)');
        ctx.fillStyle = nightSkyGrad;
        ctx.fillRect(0, 0, width, height);

        // Zenith Glow
        const zenithGlow = ctx.createRadialGradient(
          width * 0.5,
          height * 0.12,
          10,
          width * 0.5,
          height * 0.12,
          width * 0.65
        );
        zenithGlow.addColorStop(0, themePreset.skyZenithRgba);
        zenithGlow.addColorStop(0.6, themePreset.skyMidRgba);
        zenithGlow.addColorStop(1, 'rgba(9, 13, 22, 0)');
        ctx.fillStyle = zenithGlow;
        ctx.fillRect(0, 0, width, height);

        // -------------------------------------------------------------------
        // THEME-SPECIFIC SKY BACKGROUND ARTIFACTS (BEFORE STARS)
        // -------------------------------------------------------------------
        if (activeThemeId === 'emerald') {
          // 🚑 112 ZÜMRÜT: Waving Aurora Borealis (Kuzey Işıkları) ribbons across upper sky
          ctx.save();
          for (let band = 0; band < 2; band++) {
            ctx.beginPath();
            const baseY = 34 + band * 22;
            ctx.moveTo(0, baseY);
            for (let x = 0; x <= width; x += 12) {
              const wave =
                Math.sin(x * 0.018 + timeTick * (1.1 + band * 0.3) + band * 2) * 14 +
                Math.cos(x * 0.032 - timeTick * 0.7) * 6;
              ctx.lineTo(x, baseY + wave);
            }
            ctx.lineTo(width, 0);
            ctx.lineTo(0, 0);
            ctx.closePath();
            const aurGrad = ctx.createLinearGradient(0, 0, width, baseY + 30);
            aurGrad.addColorStop(0, 'rgba(16, 185, 129, 0)');
            aurGrad.addColorStop(0.25, band === 0 ? 'rgba(16, 185, 129, 0.24)' : 'rgba(45, 212, 191, 0.18)');
            aurGrad.addColorStop(0.55, band === 0 ? 'rgba(52, 211, 153, 0.30)' : 'rgba(16, 185, 129, 0.22)');
            aurGrad.addColorStop(0.85, 'rgba(20, 184, 166, 0.18)');
            aurGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
            ctx.fillStyle = aurGrad;
            ctx.fill();
          }
          ctx.restore();
        } else if (activeThemeId === 'ocean') {
          // 🌊 OKYANUS MAVİSİ: Deep Abyssal Caustic Wave Ripples & Rising Bioluminescent Motes
          ctx.save();
          for (let w = 0; w < 3; w++) {
            ctx.beginPath();
            const y0 = 24 + w * 18;
            for (let x = 0; x <= width; x += 10) {
              const y = y0 + Math.sin(x * 0.022 + timeTick * 1.3 + w) * 6;
              if (x === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = `rgba(56, 189, 248, ${0.14 - w * 0.03})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          // Bioluminescent floating water motes on left/right flanks
          for (let b = 0; b < 10; b++) {
            const side = b % 2 === 0 ? 0.08 + (b * 0.015) : 0.84 + ((b % 5) * 0.022);
            const bx = side * width + Math.sin(timeTick + b) * 6;
            const by = ((height * 0.85 - ((timeTick * 14 + b * 37) % (height * 0.8))));
            const br = 1.6 + (b % 3) * 0.8;
            const bGlow = ctx.createRadialGradient(bx, by, 0, bx, by, br * 4);
            bGlow.addColorStop(0, 'rgba(34, 211, 238, 0.65)');
            bGlow.addColorStop(1, 'rgba(34, 211, 238, 0)');
            ctx.fillStyle = bGlow;
            ctx.beginPath();
            ctx.arc(bx, by, br * 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else if (activeThemeId === 'amethyst') {
          // 🔮 KOZMİK MOR: Spiral Nebula / Galaxy in upper-left sky
          const galX = width * 0.18;
          const galY = Math.max(42, earthCenterY - 118);
          ctx.save();
          ctx.translate(galX, galY);
          ctx.rotate(-0.35);
          const nebGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
          nebGlow.addColorStop(0, 'rgba(245, 208, 254, 0.75)');
          nebGlow.addColorStop(0.35, 'rgba(192, 132, 252, 0.38)');
          nebGlow.addColorStop(0.7, 'rgba(126, 34, 206, 0.14)');
          nebGlow.addColorStop(1, 'rgba(13, 8, 24, 0)');
          ctx.scale(1.6, 0.65);
          ctx.fillStyle = nebGlow;
          ctx.beginPath();
          ctx.arc(0, 0, 46, 0, Math.PI * 2);
          ctx.fill();

          // Spiral arms
          ctx.strokeStyle = 'rgba(233, 213, 255, 0.42)';
          ctx.lineWidth = 1.4;
          for (let arm = 0; arm < 2; arm++) {
            ctx.beginPath();
            for (let t = 0; t < 3.6; t += 0.15) {
              const r = t * 7.5;
              const ang = t + arm * Math.PI + timeTick * 0.25;
              const px = Math.cos(ang) * r;
              const py = Math.sin(ang) * r;
              if (t === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
          ctx.restore();
        } else if (activeThemeId === 'sunset') {
          // 🌅 KIZIL ŞAFAK: Warm Twilight Horizon Orb in upper-left + floating solar embers
          const dawnX = width * 0.17;
          const dawnY = Math.max(44, earthCenterY - 116);
          const dawnGlow = ctx.createRadialGradient(dawnX, dawnY, 4, dawnX, dawnY, 64);
          dawnGlow.addColorStop(0, 'rgba(254, 215, 170, 0.75)');
          dawnGlow.addColorStop(0.35, 'rgba(249, 115, 22, 0.36)');
          dawnGlow.addColorStop(0.7, 'rgba(225, 29, 72, 0.14)');
          dawnGlow.addColorStop(1, 'rgba(19, 11, 9, 0)');
          ctx.fillStyle = dawnGlow;
          ctx.beginPath();
          ctx.arc(dawnX, dawnY, 64, 0, Math.PI * 2);
          ctx.fill();

          // Sunset striped solar disc
          ctx.save();
          ctx.beginPath();
          ctx.arc(dawnX, dawnY, 15, 0, Math.PI * 2);
          ctx.clip();
          const sunGrad = ctx.createLinearGradient(dawnX, dawnY - 15, dawnX, dawnY + 15);
          sunGrad.addColorStop(0, '#FEF08A');
          sunGrad.addColorStop(0.55, '#F97316');
          sunGrad.addColorStop(1, '#E11D48');
          ctx.fillStyle = sunGrad;
          ctx.fillRect(dawnX - 16, dawnY - 16, 32, 32);
          ctx.fillStyle = 'rgba(19, 11, 9, 0.55)';
          ctx.fillRect(dawnX - 16, dawnY + 4, 32, 2);
          ctx.fillRect(dawnX - 16, dawnY + 9, 32, 2.5);
          ctx.restore();
        }

        // -------------------------------------------------------------------
        // STARS AROUND AND ABOVE THE 3D GLOBE
        // -------------------------------------------------------------------
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          s.phase += s.speed;
          let sx = s.nx * width;
          let sy = s.ny * height;

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

          if (s.radius >= 1.1) {
            const starGlow = ctx.createRadialGradient(sx, sy, 0, sx, sy, s.radius * 4.2);
            starGlow.addColorStop(0, `rgba(224, 242, 254, ${alpha * 0.36})`);
            starGlow.addColorStop(1, 'rgba(224, 242, 254, 0)');
            ctx.fillStyle = starGlow;
            ctx.beginPath();
            ctx.arc(sx, sy, s.radius * 4.2, 0, Math.PI * 2);
            ctx.fill();

            // 4-point diamond star cross on Amethyst & Emerald themes
            if (activeThemeId === 'amethyst' || activeThemeId === 'emerald') {
              ctx.save();
              ctx.strokeStyle = s.color;
              ctx.globalAlpha = alpha * 0.65;
              ctx.lineWidth = 0.8;
              const armLen = s.radius * 3.6;
              ctx.beginPath();
              ctx.moveTo(sx - armLen, sy);
              ctx.lineTo(sx + armLen, sy);
              ctx.moveTo(sx, sy - armLen);
              ctx.lineTo(sx, sy + armLen);
              ctx.stroke();
              ctx.restore();
            }
          }

          ctx.globalAlpha = alpha;
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(sx, sy, s.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // -------------------------------------------------------------------
        // UPPER-RIGHT CELESTIAL ARTIFACT PER DARK THEME
        // -------------------------------------------------------------------
        const moonX = width * 0.83;
        const moonY = Math.max(38, earthCenterY - 122);
        const moonR = 16;

        if (activeThemeId === 'amoled') {
          // 🖤 OLED TAM SİYAH: Total Solar Eclipse (Tam Tutulma & Elmas Halka Koronası)
          const corona = ctx.createRadialGradient(moonX, moonY, moonR * 0.85, moonX, moonY, moonR * 3.6);
          corona.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
          corona.addColorStop(0.22, 'rgba(244, 63, 94, 0.45)');
          corona.addColorStop(0.55, 'rgba(255, 255, 255, 0.12)');
          corona.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = corona;
          ctx.beginPath();
          ctx.arc(moonX, moonY, moonR * 3.6, 0, Math.PI * 2);
          ctx.fill();

          // Pitch-black eclipsing disc
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(moonX, moonY, moonR * 0.95, 0, Math.PI * 2);
          ctx.fill();

          // Razor-thin glowing rim
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(moonX, moonY, moonR * 0.96, 0, Math.PI * 2);
          ctx.stroke();

          // Diamond ring flare on the upper-left edge of the eclipse
          const flareAngle = -Math.PI * 0.72 + Math.sin(timeTick * 0.6) * 0.08;
          const fx = moonX + Math.cos(flareAngle) * (moonR * 0.96);
          const fy = moonY + Math.sin(flareAngle) * (moonR * 0.96);
          const dFlare = ctx.createRadialGradient(fx, fy, 0, fx, fy, 14);
          dFlare.addColorStop(0, '#FFFFFF');
          dFlare.addColorStop(0.4, 'rgba(254, 205, 211, 0.75)');
          dFlare.addColorStop(1, 'rgba(244, 63, 94, 0)');
          ctx.fillStyle = dFlare;
          ctx.beginPath();
          ctx.arc(fx, fy, 14, 0, Math.PI * 2);
          ctx.fill();
        } else if (activeThemeId === 'emerald') {
          // 🚑 112 ZÜMRÜT: Glowing Emerald Crescent Moon
          drawCrescentMoon(
            moonX,
            moonY,
            moonR,
            '#A7F3D0',
            'rgba(16, 185, 129, 0.35)',
            '#07221B'
          );
        } else if (activeThemeId === 'ocean') {
          // 🌊 OKYANUS MAVİSİ: Ice-Blue Moon with Double Atmospheric Halo Ring
          const halo = ctx.createRadialGradient(moonX, moonY, moonR * 0.7, moonX, moonY, moonR * 3.8);
          halo.addColorStop(0, 'rgba(186, 230, 253, 0.42)');
          halo.addColorStop(0.5, 'rgba(56, 189, 248, 0.16)');
          halo.addColorStop(1, 'rgba(6, 16, 30, 0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(moonX, moonY, moonR * 3.8, 0, Math.PI * 2);
          ctx.fill();

          // Outer ice halo ring
          ctx.strokeStyle = 'rgba(125, 211, 252, 0.26)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(moonX, moonY, moonR * 2.15, 0, Math.PI * 2);
          ctx.stroke();

          if (cachedMoonSprite) {
            ctx.save();
            ctx.globalAlpha = 0.95;
            ctx.drawImage(cachedMoonSprite, moonX - moonR, moonY - moonR, moonR * 2, moonR * 2);
            ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
            ctx.beginPath();
            ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        } else if (activeThemeId === 'amethyst') {
          // 🔮 KOZMİK MOR: Mystic Twin Moons (Large Violet Moon + Small Silver Crescent)
          drawCrescentMoon(
            moonX,
            moonY,
            moonR * 0.95,
            '#E9D5FF',
            'rgba(168, 85, 247, 0.38)',
            '#180C2E'
          );
          drawCrescentMoon(
            moonX - 24,
            moonY + 14,
            7,
            '#F5D0FE',
            'rgba(217, 70, 239, 0.32)',
            '#180C2E'
          );
        } else if (activeThemeId === 'sunset') {
          // 🌅 KIZIL ŞAFAK: Warm Amber Crescent Moon in upper-right
          drawCrescentMoon(
            moonX,
            moonY,
            13,
            '#FDE68A',
            'rgba(245, 158, 11, 0.34)',
            '#24110C'
          );
        } else {
          // 🌙 GECE UZAY (Default Dark): Classic Realistic Lunar Moon + Shooting Star
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

          // Periodic subtle Shooting Star in upper-left sky
          const shootCycle = timeTick % 7.5;
          if (shootCycle < 1.1) {
            const p = shootCycle / 1.1;
            const sx = width * 0.14 + p * 95;
            const sy = 22 + p * 42;
            const tailGrad = ctx.createLinearGradient(sx, sy, sx - 38, sy - 17);
            tailGrad.addColorStop(0, `rgba(255, 255, 255, ${(1 - p) * 0.9})`);
            tailGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.strokeStyle = tailGrad;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - 38, sy - 17);
            ctx.stroke();
          }
        }
      } else {
        // ===================================================================
        // LIGHT THEMES ('light' & 'sand'): DAY SKY & SUN ARTIFACTS
        // ===================================================================
        const daySkyGrad = ctx.createLinearGradient(0, 0, 0, height);
        daySkyGrad.addColorStop(0, themePreset.skyTopRgba);
        daySkyGrad.addColorStop(0.38, themePreset.skyMidRgba);
        daySkyGrad.addColorStop(
          0.75,
          activeThemeId === 'sand' ? 'rgba(254, 243, 199, 0.16)' : 'rgba(186, 230, 253, 0.14)'
        );
        daySkyGrad.addColorStop(1, 'rgba(248, 250, 252, 0)');
        ctx.fillStyle = daySkyGrad;
        ctx.fillRect(0, 0, width, height);

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
        outerSolarScatter.addColorStop(
          0,
          activeThemeId === 'sand' ? 'rgba(251, 191, 36, 0.65)' : 'rgba(254, 240, 138, 0.68)'
        );
        outerSolarScatter.addColorStop(
          0.32,
          activeThemeId === 'sand' ? 'rgba(234, 88, 12, 0.24)' : 'rgba(251, 191, 36, 0.28)'
        );
        outerSolarScatter.addColorStop(
          0.68,
          activeThemeId === 'sand' ? 'rgba(253, 230, 138, 0.12)' : 'rgba(125, 211, 252, 0.14)'
        );
        outerSolarScatter.addColorStop(1, 'rgba(248, 250, 252, 0)');
        ctx.fillStyle = outerSolarScatter;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * 11, 0, Math.PI * 2);
        ctx.fill();

        if (activeThemeId === 'sand') {
          // 🏜️ SICAK KUM: Ornate Compass Rose / Astrolabe Sunburst Rays around the Desert Sun
          ctx.save();
          ctx.translate(sunX, sunY);
          ctx.rotate(timeTick * 0.15);
          ctx.strokeStyle = 'rgba(217, 119, 6, 0.35)';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(0, 0, sunR * 1.65, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, sunR * 2.35, 0, Math.PI * 2);
          ctx.stroke();

          for (let rIdx = 0; rIdx < 12; rIdx++) {
            const ang = (rIdx * Math.PI) / 6;
            const inner = sunR * 1.25;
            const outer = rIdx % 3 === 0 ? sunR * 2.85 : sunR * 2.15;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
            ctx.lineTo(Math.cos(ang) * outer, Math.sin(ang) * outer);
            ctx.stroke();
          }
          ctx.restore();

          // Warm golden desert breeze waves in upper-right sky
          ctx.save();
          ctx.strokeStyle = 'rgba(217, 119, 6, 0.18)';
          ctx.lineWidth = 1.5;
          for (let d = 0; d < 2; d++) {
            ctx.beginPath();
            const startX = width * 0.68;
            const baseY = 36 + d * 14;
            for (let x = 0; x <= 90; x += 6) {
              const y = baseY + Math.sin(x * 0.08 - timeTick * 1.5 + d) * 3.5;
              if (x === 0) ctx.moveTo(startX + x, y);
              else ctx.lineTo(startX + x, y);
            }
            ctx.stroke();
          }
          ctx.restore();
        } else {
          // ☀️ GÜNDÜZ AÇIK: Soft drifting cumulus clouds in upper-right sky
          const drawSoftCloud = (cx: number, cy: number, scale: number, alpha: number) => {
            ctx.save();
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(cx, cy, 12 * scale, 0, Math.PI * 2);
            ctx.arc(cx + 10 * scale, cy - 3 * scale, 14 * scale, 0, Math.PI * 2);
            ctx.arc(cx + 22 * scale, cy + 1 * scale, 11 * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          };
          const drift = Math.sin(timeTick * 0.35) * 8;
          drawSoftCloud(width * 0.76 + drift, Math.max(36, earthCenterY - 124), 0.95, 0.72);
          drawSoftCloud(width * 0.85 - drift * 0.6, Math.max(58, earthCenterY - 96), 0.7, 0.52);
        }

        // Mid solar corona
        const midCorona = ctx.createRadialGradient(
          sunX,
          sunY,
          sunR * 0.2,
          sunX,
          sunY,
          sunR * 3.4
        );
        midCorona.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
        midCorona.addColorStop(0.35, 'rgba(254, 240, 138, 0.72)');
        midCorona.addColorStop(0.7, 'rgba(251, 191, 36, 0.24)');
        midCorona.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = midCorona;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR * 3.4, 0, Math.PI * 2);
        ctx.fill();

        // Crisp bright solar disc
        const sunDisc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
        sunDisc.addColorStop(0, '#FFFFFF');
        sunDisc.addColorStop(0.65, activeThemeId === 'sand' ? '#FDE68A' : '#FEF08A');
        sunDisc.addColorStop(1, activeThemeId === 'sand' ? '#F59E0B' : 'rgba(250, 204, 21, 0.9)');
        ctx.fillStyle = sunDisc;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        ctx.fill();
      }
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
  }, [isDarkTheme, activeThemeId, themePreset, compact]);

  // ============================================================================
  // 2. THREE.JS 3D GLOBE & THEME-SPECIFIC 3D ORBITAL ARTIFACTS
  // ============================================================================
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
    const initialSize = compact ? 84 : 332;
    const width = container.clientWidth || initialSize;
    const height = container.clientHeight || initialSize;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 2.82);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isSoftwareGl,
      powerPreference: 'default',
      preserveDrawingBuffer: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.outline = 'none';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.position = 'relative';
    renderer.domElement.style.zIndex = '5';
    renderer.domElement.className =
      'cursor-grab active:cursor-grabbing select-none transition-all block w-full h-full';
    container.appendChild(renderer.domElement);

    // Studio Environment Reflection (used only by metallic 3D orbital artifacts, never by the Earth or clouds)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const { dayTexture, nightTexture, cloudTexture } = getEarthTextures();
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    dayTexture.anisotropy = maxAnisotropy;
    nightTexture.anisotropy = maxAnisotropy;
    cloudTexture.anisotropy = maxAnisotropy;

    // Clean Neutral Lighting Rig (no colored wash or specular glare on the Earth)
    const ambientLight = new THREE.AmbientLight(0xffffff, isDarkTheme ? 1.05 : 1.15);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, isDarkTheme ? 1.55 : 2.15);
    sunLight.position.set(isDarkTheme ? 2.5 : -2.5, 1.8, 2.8);
    scene.add(sunLight);

    // Pure Natural Earth Surface (no tint, no emissive wash, no specular/atmosphere coating)
    const earthRadius = 0.99;
    const earthGeometry = new THREE.SphereGeometry(earthRadius, 64, 64);
    const globeBaseMap = isDarkTheme ? nightTexture : dayTexture;

    const earthMaterial = new THREE.MeshLambertMaterial({
      map: globeBaseMap,
      color: 0xffffff,
    });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    earthMesh.rotation.y = -2.1;
    earthMesh.rotation.x = 0.18;
    scene.add(earthMesh);

    // Pure Natural Clouds Only (AdditiveBlending on MeshBasicMaterial: black = 100% transparent, white = crisp clouds)
    const cloudGeometry = new THREE.SphereGeometry(earthRadius * 1.012, 64, 64);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      map: cloudTexture,
      color: 0xffffff,
      transparent: true,
      opacity: isDarkTheme ? 0.26 : 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cloudMesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloudMesh.rotation.y = -2.1;
    cloudMesh.rotation.x = 0.18;
    scene.add(cloudMesh);

    // =========================================================================
    // 3. BUILD THEME-SPECIFIC 3D ORBITAL / PLANETARY ARTIFACTS (`artifactGroup`)
    // =========================================================================
    const artifactGroup = new THREE.Group();
    scene.add(artifactGroup);

    const disposableGeometries: THREE.BufferGeometry[] = [];
    const disposableMaterials: THREE.Material[] = [];
    const registerGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      disposableGeometries.push(g);
      return g;
    };
    const registerMat = <T extends THREE.Material>(m: T): T => {
      disposableMaterials.push(m);
      return m;
    };

    let customUpdateArtifact: ((elapsed: number) => void) | null = null;

    if (activeThemeId === 'dark' || activeThemeId === 'light') {
      // 🛰️ COMPOSITE 3D ORBITING SATELLITE & INCLINED TELEMETRY RING
      const orbitPivot = new THREE.Group();
      orbitPivot.rotation.z = activeThemeId === 'dark' ? 0.42 : -0.36;
      orbitPivot.rotation.x = 0.28;
      artifactGroup.add(orbitPivot);

      // Thin orbital trajectory ring hugging the globe (r=1.032)
      const trackMat = registerMat(
        new THREE.MeshBasicMaterial({
          color: activeThemeId === 'dark' ? 0x818cf8 : 0x38bdf8,
          transparent: true,
          opacity: 0.28,
        })
      );
      const trackMesh = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.032, 0.003, 12, 96)),
        trackMat
      );
      trackMesh.rotation.x = Math.PI / 2;
      orbitPivot.add(trackMesh);

      // Composite 6-part 3D Satellite Group
      const satGroup = new THREE.Group();
      const bodyMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: activeThemeId === 'dark' ? 0xfbbf24 : 0xf8fafc,
          metalness: 0.85,
          roughness: 0.22,
        })
      );
      const panelMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: activeThemeId === 'dark' ? 0x1d4ed8 : 0x0284c7,
          metalness: 0.65,
          roughness: 0.25,
          emissive: 0x0ea5e9,
          emissiveIntensity: 0.25,
        })
      );
      const dishMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0xe2e8f0,
          metalness: 0.9,
          roughness: 0.18,
        })
      );

      // 1. Hexagonal satellite bus
      const bus = new THREE.Mesh(
        registerGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.048, 6)),
        bodyMat
      );
      bus.rotation.z = Math.PI / 2;
      satGroup.add(bus);

      // 2 & 3. Left & Right Solar Wing Panels
      const wingGeo = registerGeo(new THREE.BoxGeometry(0.004, 0.085, 0.028));
      const leftWing = new THREE.Mesh(wingGeo, panelMat);
      leftWing.position.y = 0.056;
      satGroup.add(leftWing);

      const rightWing = new THREE.Mesh(wingGeo, panelMat);
      rightWing.position.y = -0.056;
      satGroup.add(rightWing);

      // 4. Parabolic dish facing Earth
      const dish = new THREE.Mesh(
        registerGeo(new THREE.ConeGeometry(0.018, 0.014, 16, 1, true)),
        dishMat
      );
      dish.position.x = -0.028;
      dish.rotation.z = -Math.PI / 2;
      satGroup.add(dish);

      // 5. Beacon light
      const beaconMat = registerMat(
        new THREE.MeshBasicMaterial({
          color: activeThemeId === 'dark' ? 0xf43f5e : 0x10b981,
        })
      );
      const beacon = new THREE.Mesh(
        registerGeo(new THREE.SphereGeometry(0.008, 8, 8)),
        beaconMat
      );
      beacon.position.x = 0.028;
      satGroup.add(beacon);

      orbitPivot.add(satGroup);

      customUpdateArtifact = (elapsed) => {
        const angle = elapsed * 0.55;
        const r = 1.032;
        satGroup.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        satGroup.lookAt(0, 0, 0);
      };
    } else if (activeThemeId === 'emerald') {
      // 🌌 112 ZÜMRÜT: 3D Polar Aurora Borealis Crowns + Emergency Pulse Ring
      const auroraShaderMat = registerMat(
        new THREE.ShaderMaterial({
          vertexShader: `
            varying vec2 vUv;
            uniform float uTime;
            void main() {
              vUv = uv;
              vec3 pos = position;
              float wave = sin(uv.x * 18.0 + uTime * 2.2) * 0.014;
              pos.x += normal.x * wave;
              pos.z += normal.z * wave;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
          `,
          fragmentShader: `
            varying vec2 vUv;
            uniform float uTime;
            void main() {
              float verticalFade = sin(vUv.y * 3.14159);
              float curtains = 0.55 + 0.45 * sin(vUv.x * 28.0 + uTime * 1.8) * cos(vUv.x * 12.0 - uTime);
              vec3 col1 = vec3(0.06, 0.72, 0.50);
              vec3 col2 = vec3(0.20, 0.83, 0.60);
              vec3 col = mix(col1, col2, vUv.y);
              float alpha = verticalFade * curtains * 0.52;
              gl_FragColor = vec4(col, alpha);
            }
          `,
          uniforms: {
            uTime: { value: 0 },
          },
          transparent: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );

      // North & South Polar Aurora Curtains attached to the globe's tilt
      const northAurora = new THREE.Mesh(
        registerGeo(new THREE.CylinderGeometry(0.54, 0.68, 0.16, 48, 1, true)),
        auroraShaderMat
      );
      northAurora.position.y = 0.84;
      earthMesh.add(northAurora);

      const southAurora = new THREE.Mesh(
        registerGeo(new THREE.CylinderGeometry(0.68, 0.54, 0.15, 48, 1, true)),
        auroraShaderMat
      );
      southAurora.position.y = -0.84;
      earthMesh.add(southAurora);

      // Inclined 112 Emerald Rescue Beacon Ring
      const pulsePivot = new THREE.Group();
      pulsePivot.rotation.z = -0.32;
      pulsePivot.rotation.x = 0.25;
      artifactGroup.add(pulsePivot);

      const ringMat = registerMat(
        new THREE.MeshBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.34,
        })
      );
      const ringMesh = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.03, 0.004, 12, 96)),
        ringMat
      );
      ringMesh.rotation.x = Math.PI / 2;
      pulsePivot.add(ringMesh);

      const nodeGeo = registerGeo(new THREE.OctahedronGeometry(0.02, 0));
      const nodeMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0x6ee7b7,
          emissive: 0x10b981,
          emissiveIntensity: 0.9,
          roughness: 0.15,
          metalness: 0.8,
        })
      );
      for (let i = 0; i < 4; i++) {
        const node = new THREE.Mesh(nodeGeo, nodeMat);
        const ang = (i * Math.PI) / 2;
        node.position.set(Math.cos(ang) * 1.03, 0, Math.sin(ang) * 1.03);
        pulsePivot.add(node);
      }

      customUpdateArtifact = (elapsed) => {
        auroraShaderMat.uniforms.uTime.value = elapsed;
        pulsePivot.rotation.y = elapsed * 0.38;
      };
    } else if (activeThemeId === 'ocean') {
      // 🌊 OKYANUS MAVİSİ: Counter-Rotating Bioluminescent Hydro Rings & 3 Aqua Probes
      const ring1Pivot = new THREE.Group();
      ring1Pivot.rotation.z = 0.35;
      ring1Pivot.rotation.x = 0.22;
      artifactGroup.add(ring1Pivot);

      const ring2Pivot = new THREE.Group();
      ring2Pivot.rotation.z = -0.38;
      ring2Pivot.rotation.x = 0.28;
      artifactGroup.add(ring2Pivot);

      const cyanRingMat = registerMat(
        new THREE.MeshBasicMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: 0.36,
        })
      );
      const skyRingMat = registerMat(
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.26,
        })
      );

      const r1 = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.028, 0.0045, 12, 96)),
        cyanRingMat
      );
      r1.rotation.x = Math.PI / 2;
      ring1Pivot.add(r1);

      const r2 = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.036, 0.003, 12, 96)),
        skyRingMat
      );
      r2.rotation.x = Math.PI / 2;
      ring2Pivot.add(r2);

      const probeGeo = registerGeo(new THREE.SphereGeometry(0.018, 16, 16));
      const probeMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0xe0f2fe,
          emissive: 0x06b6d4,
          emissiveIntensity: 1.1,
          roughness: 0.1,
          metalness: 0.5,
        })
      );
      for (let i = 0; i < 3; i++) {
        const probe = new THREE.Mesh(probeGeo, probeMat);
        const ang = (i * Math.PI * 2) / 3;
        probe.position.set(Math.cos(ang) * 1.028, 0, Math.sin(ang) * 1.028);
        ring1Pivot.add(probe);
      }

      customUpdateArtifact = (elapsed) => {
        ring1Pivot.rotation.y = elapsed * 0.45;
        ring2Pivot.rotation.y = -elapsed * 0.32;
      };
    } else if (activeThemeId === 'sunset') {
      // 🪐 KIZIL ŞAFAK: Saturn-Style Multi-Band Golden Planetary Rings & 2 Orbiting Moons
      const saturnPivot = new THREE.Group();
      saturnPivot.rotation.x = 1.18;
      saturnPivot.rotation.y = 0.28;
      artifactGroup.add(saturnPivot);

      const ringSpecs: Array<[number, number, number, number]> = [
        [1.015, 1.026, 0xfde68a, 0.52],
        [1.029, 1.041, 0xf59e0b, 0.42],
        [1.043, 1.049, 0xfb7185, 0.32],
      ];

      for (const [innerR, outerR, hex, alpha] of ringSpecs) {
        const rMat = registerMat(
          new THREE.MeshBasicMaterial({
            color: hex,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: alpha,
          })
        );
        const rMesh = new THREE.Mesh(
          registerGeo(new THREE.RingGeometry(innerR, outerR, 96)),
          rMat
        );
        saturnPivot.add(rMesh);
      }

      // 2 Orbiting Rocky Moons (Phobos & Deimos)
      const moonMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0xfed7aa,
          roughness: 0.78,
          metalness: 0.1,
        })
      );
      const phobos = new THREE.Mesh(
        registerGeo(new THREE.SphereGeometry(0.026, 16, 16)),
        moonMat
      );
      const deimos = new THREE.Mesh(
        registerGeo(new THREE.SphereGeometry(0.017, 16, 16)),
        moonMat
      );
      artifactGroup.add(phobos);
      artifactGroup.add(deimos);

      customUpdateArtifact = (elapsed) => {
        saturnPivot.rotation.z = elapsed * 0.2;
        const a1 = elapsed * 0.55;
        phobos.position.set(
          Math.cos(a1) * 1.035,
          Math.sin(a1) * 0.32,
          Math.sin(a1) * 0.98
        );
        const a2 = -elapsed * 0.38 + 2.1;
        deimos.position.set(
          Math.cos(a2) * 1.04,
          -Math.sin(a2) * 0.28,
          Math.sin(a2) * 0.98
        );
      };
    } else if (activeThemeId === 'amethyst') {
      // 🔮 KOZMİK MOR: Dual Intersecting Gyroscopic Astrolabe Rings + 6 Floating Amethyst Crystals
      const gyroA = new THREE.Group();
      gyroA.rotation.z = 0.52;
      artifactGroup.add(gyroA);

      const gyroB = new THREE.Group();
      gyroB.rotation.z = -0.52;
      artifactGroup.add(gyroB);

      const ringMatA = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0xe9d5ff,
          emissive: 0xa855f7,
          emissiveIntensity: 0.75,
          roughness: 0.2,
          metalness: 0.85,
        })
      );
      const ringMatB = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0xf5d0fe,
          emissive: 0xd946ef,
          emissiveIntensity: 0.65,
          roughness: 0.2,
          metalness: 0.85,
        })
      );

      const torusA = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.03, 0.004, 12, 96)),
        ringMatA
      );
      torusA.rotation.x = Math.PI / 2;
      gyroA.add(torusA);

      const torusB = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.036, 0.0035, 12, 96)),
        ringMatB
      );
      torusB.rotation.x = Math.PI / 2;
      gyroB.add(torusB);

      // 6 Floating Crystal Octahedrons
      const crystalGeo = registerGeo(new THREE.OctahedronGeometry(0.022, 0));
      const crystalMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0xf3e8ff,
          emissive: 0xc084fc,
          emissiveIntensity: 0.95,
          roughness: 0.1,
          metalness: 0.9,
        })
      );
      const crystals: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(crystalGeo, crystalMat);
        const ang = (i * Math.PI) / 3;
        c.position.set(Math.cos(ang) * 1.03, 0, Math.sin(ang) * 1.03);
        gyroA.add(c);
        crystals.push(c);
      }

      customUpdateArtifact = (elapsed) => {
        gyroA.rotation.y = elapsed * 0.42;
        gyroB.rotation.y = -elapsed * 0.34;
        gyroB.rotation.x = Math.sin(elapsed * 0.4) * 0.25;
        for (const c of crystals) {
          c.rotation.x = elapsed * 1.5;
          c.rotation.y = elapsed * 1.2;
        }
      };
    } else if (activeThemeId === 'amoled') {
      // 🖤 OLED TAM SİYAH: Crimson Radar Sweep Ring (no wireframe coating over the Earth surface)
      const radarPivot = new THREE.Group();
      radarPivot.rotation.z = 0.38;
      radarPivot.rotation.x = 0.24;
      artifactGroup.add(radarPivot);

      const radarRingMat = registerMat(
        new THREE.MeshBasicMaterial({
          color: 0xf43f5e,
          transparent: true,
          opacity: 0.45,
        })
      );
      const radarRing = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.032, 0.0035, 12, 96)),
        radarRingMat
      );
      radarRing.rotation.x = Math.PI / 2;
      radarPivot.add(radarRing);

      const targetDot = new THREE.Mesh(
        registerGeo(new THREE.SphereGeometry(0.016, 12, 12)),
        registerMat(new THREE.MeshBasicMaterial({ color: 0xffffff }))
      );
      targetDot.position.set(1.032, 0, 0);
      radarPivot.add(targetDot);

      customUpdateArtifact = (elapsed) => {
        radarPivot.rotation.y = elapsed * 0.65;
      };
    } else if (activeThemeId === 'sand') {
      // 🏜️ SICAK KUM: Antique Brass Armillary Sphere / Compass Meridian & Equatorial Rings
      const armillaryGroup = new THREE.Group();
      armillaryGroup.rotation.z = 0.28;
      armillaryGroup.rotation.x = 0.18;
      artifactGroup.add(armillaryGroup);

      const brassMat = registerMat(
        new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          metalness: 0.88,
          roughness: 0.22,
          emissive: 0xd97706,
          emissiveIntensity: 0.2,
        })
      );

      // Equatorial Brass Ring
      const eqRing = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.032, 0.005, 12, 96)),
        brassMat
      );
      eqRing.rotation.x = Math.PI / 2;
      armillaryGroup.add(eqRing);

      // Meridian Brass Ring
      const merRing = new THREE.Mesh(
        registerGeo(new THREE.TorusGeometry(1.036, 0.004, 12, 96)),
        brassMat
      );
      armillaryGroup.add(merRing);

      // 8 Cardinal Brass Compass Studs along the Equatorial Ring
      const studGeo = registerGeo(new THREE.BoxGeometry(0.018, 0.018, 0.018));
      for (let i = 0; i < 8; i++) {
        const stud = new THREE.Mesh(studGeo, brassMat);
        const ang = (i * Math.PI) / 4;
        stud.position.set(Math.cos(ang) * 1.032, 0, Math.sin(ang) * 1.032);
        stud.rotation.y = -ang;
        armillaryGroup.add(stud);
      }

      customUpdateArtifact = (elapsed) => {
        armillaryGroup.rotation.y = elapsed * 0.24;
      };
    }

    let animationFrameId: number;
    const clock = new THREE.Clock();
    let hasRenderedInitialFrame = false;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if ((document.hidden || isPausedRef.current) && hasRenderedInitialFrame) {
        return;
      }

      const elapsed = clock.getElapsedTime();

      if (!isDraggingRef.current) {
        earthMesh.rotation.y += 0.0009 + dragVelocityRef.current;
        cloudMesh.rotation.y += 0.0012 + dragVelocityRef.current;
        dragVelocityRef.current *= 0.94;
      }

      if (customUpdateArtifact) {
        customUpdateArtifact(elapsed);
      }

      renderer.render(scene, camera);
      hasRenderedInitialFrame = true;
    };

    animationFrameId = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!container) return;
      const defaultSize = compact ? 76 : 332;
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width) || container.clientWidth || defaultSize;
      const h = Math.round(rect.height) || container.clientHeight || defaultSize;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const rafResizeId = requestAnimationFrame(handleResize);
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
      artifactGroup.rotation.y += spinDelta * 0.65;
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
      cancelAnimationFrame(rafResizeId);
      resizeObserver.disconnect();
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      earthGeometry.dispose();
      earthMaterial.dispose();
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      for (const g of disposableGeometries) g.dispose();
      for (const m of disposableMaterials) m.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (domElement.parentElement) {
        domElement.parentElement.removeChild(domElement);
      }
    };
  }, [isDarkTheme, isLight, activeThemeId, themePreset, compact]);

  const progressPct = Math.min(100, Math.max(0, Math.round(progressFrac * 100)));

  const arcRadius = 153;
  const arcLength = 267.04;
  const arcOffset = arcLength * (1 - Math.min(1, Math.max(0, progressFrac)));

  if (compact) {
    const cleanCityUpper = (cityName || '').trim().toLocaleUpperCase('tr-TR');
    return (
      <div
        ref={wrapperRef}
        className="relative w-[86px] h-[86px] sm:w-[90px] sm:h-[90px] shrink-0 flex items-center justify-center select-none touch-none"
      >
        <div
          ref={earthStageRef}
          className="relative w-[86px] h-[86px] sm:w-[90px] sm:h-[90px] shrink-0 flex items-center justify-center z-5"
        />
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
          viewBox="0 0 332 332"
        >
          <circle
            cx="166"
            cy="166"
            r={arcRadius}
            fill="none"
            stroke="rgba(225, 29, 72, 0.65)"
            strokeWidth="4"
          />
        </svg>

        {/* 112 Acil Çağrı Merkezi Emblem Overlay harmonized with the 3D Rotating Earth */}
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-between py-[5px] px-1">
          {/* Top Ribbon: Selected Province Name (Giriş Ekranında Seçilen İl) */}
          {cleanCityUpper ? (
            <div className="px-2 py-[1.5px] rounded-full bg-gradient-to-r from-[#dc2626] via-[#e11d48] to-[#dc2626] border border-white/45 shadow-sm max-w-[78px] overflow-hidden">
              <div className="text-[7.5px] font-black uppercase tracking-[0.11em] text-white leading-none truncate text-center">
                {cleanCityUpper}
              </div>
            </div>
          ) : (
            <div className="h-[11px]" />
          )}

          {/* Center Hero "112" Typography over the rotating 3D Earth */}
          <div
            className="font-display text-[24px] sm:text-[26px] font-black tracking-[-0.04em] text-white leading-none -my-0.5"
            style={{
              textShadow:
                '0 2px 8px rgba(225, 29, 72, 0.95), 0 1px 4px rgba(0, 0, 0, 0.98), 0 0 14px rgba(0, 0, 0, 0.9)',
            }}
          >
            112
          </div>

          {/* Bottom White Emblem Band: ACİL / ÇAĞRI MERKEZİ (matching the official 112 logo language) */}
          <div className="w-[74px] sm:w-[76px] rounded-b-xl rounded-t-[4px] bg-white/95 border border-rose-500/45 shadow-md px-1 py-[2.5px] flex flex-col items-center justify-center leading-none">
            <span className="text-[8.5px] font-black tracking-[0.07em] text-[#e30613] leading-none">
              ACİL
            </span>
            <span className="mt-[1px] text-[5.5px] font-extrabold tracking-[0.07em] text-[#e30613] leading-none whitespace-nowrap">
              ÇAĞRI MERKEZİ
            </span>
          </div>
        </div>
      </div>
    );
  }

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
          stroke={themePreset.earthCircleStroke}
          strokeWidth="1.5"
        />
        {/* Bottom Progress Track (from bottom-left 140° to bottom-right 40° along r=153) */}
        <path
          d="M 48.8 264.4 A 153 153 0 0 0 283.2 264.4"
          fill="none"
          stroke={isDarkTheme ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.14)'}
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Active Progress Arc */}
        {progressFrac > 0 && (
          <path
            d="M 48.8 264.4 A 153 153 0 0 0 283.2 264.4"
            fill="none"
            stroke={themePreset.accentHex}
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
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: themePreset.accentHex }}
          />
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
            <span className="font-extrabold" style={{ color: themePreset.accentHex }}>
              %{progressPct}
            </span>
            <span className="text-white/60">•</span>
            <span className="font-bold text-white">{remainText}</span>
          </div>
        )}
      </div>
    </div>
  );
};
