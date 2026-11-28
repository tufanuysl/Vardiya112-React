import domtoimage from 'dom-to-image';
import { useCallback } from 'react';
import {
  apiUrl,
  blobToBase64,
  isCapacitorNative,
  openExternalSystemUrl,
  shareOrOpenNativeFile,
  toAbsoluteApiUrl,
} from '../utils/nativeBridge';
import { getAuthHeaders } from '../firebase';

function dataUrlToBlob(dataUrl: string, fallbackMime = 'image/png'): Blob {
  const parts = dataUrl.split(',');
  const header = parts[0] || '';
  const base64 = parts[1] || '';
  if (!base64 || base64.length < 16) {
    throw new Error('Geçersiz veya boş PNG verisi.');
  }
  const mimeMatch = header.match(/data:([^;]+);base64/i);
  const mime = mimeMatch ? mimeMatch[1] : fallbackMime;
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 100) {
              resolve(blob);
              return;
            }
            try {
              const fallbackDataUrl = canvas.toDataURL('image/png');
              resolve(dataUrlToBlob(fallbackDataUrl, 'image/png'));
            } catch (err) {
              reject(err);
            }
          },
          'image/png',
          1.0
        );
      } else {
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrlToBlob(dataUrl, 'image/png'));
      }
    } catch (err) {
      reject(err);
    }
  });
}

async function isValidPngBlob(blob: Blob): Promise<boolean> {
  if (!blob || blob.size < 64) return false;
  try {
    const headerBuf = await blob.slice(0, 8).arrayBuffer();
    const bytes = new Uint8Array(headerBuf);
    // Standard PNG magic header: 89 50 4E 47 0D 0A 1A 0A
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  } catch {
    return blob.size > 100;
  }
}

interface DomToImageWithImpl {
  toPng: typeof domtoimage.toPng;
  impl?: {
    fontFaces?: {
      resolveAll?: () => Promise<string>;
    };
  };
}

function resolveCaptureBgColor(element: HTMLElement): string {
  try {
    const computed = window.getComputedStyle(element).backgroundColor;
    if (
      computed &&
      computed !== 'transparent' &&
      computed !== 'rgba(0, 0, 0, 0)'
    ) {
      return computed;
    }
  } catch {
    // Fallback below
  }
  const isDark = document.documentElement.classList.contains('dark');
  return isDark ? '#090D16' : '#F8FAFC';
}

async function captureElementAsPng(element: HTMLElement, bgcolor: string): Promise<string> {
  const baseFilter = (node: Node) => {
    return !(node instanceof HTMLElement && node.classList && node.classList.contains('no-share'));
  };

  // Bypass dom-to-image's external @font-face XHR fetcher, which causes
  // status:0 / 30000ms timeouts on cross-origin fonts.gstatic.com .woff2 URLs
  // in sandboxed iframes and Android WebViews.
  const dti = domtoimage as unknown as DomToImageWithImpl;
  const fontFacesImpl = dti.impl?.fontFaces;
  const originalResolveAll = fontFacesImpl?.resolveAll;

  if (fontFacesImpl && typeof originalResolveAll === 'function') {
    fontFacesImpl.resolveAll = () => Promise.resolve('');
  }

  const width = Math.max(element.scrollWidth, element.offsetWidth);
  const height = Math.max(element.scrollHeight, element.offsetHeight);

  try {
    return await domtoimage.toPng(element, {
      quality: 1.0,
      bgcolor,
      width,
      height,
      cacheBust: false,
      filter: baseFilter,
    });
  } finally {
    if (fontFacesImpl && typeof originalResolveAll === 'function') {
      fontFacesImpl.resolveAll = originalResolveAll;
    }
  }
}

async function uploadPngToServer(
  blob: Blob,
  fileName: string
): Promise<{ downloadUrl: string; inlineUrl: string } | null> {
  try {
    const base64Content = await blobToBase64(blob);
    const res = await fetch(apiUrl('/api/calendar/image'), {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        base64Data: base64Content,
        filename: fileName,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      downloadUrl?: string;
      inlineUrl?: string;
    };
    if (!data.downloadUrl) return null;
    return {
      downloadUrl: data.downloadUrl,
      inlineUrl: data.inlineUrl || data.downloadUrl,
    };
  } catch {
    return null;
  }
}

async function deliverPngBlob(
  blob: Blob,
  fileName: string,
  mode: 'share' | 'download' = 'share',
  shareTitle = 'Vardiya 112',
  shareText = 'Vardiya 112 Takvim Görünümü'
): Promise<boolean> {
  const valid = await isValidPngBlob(blob);
  if (!valid) {
    return false;
  }

  const triggerUrlDownload = (href: string, revokeAfter = false) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (revokeAfter) {
      window.setTimeout(() => {
        URL.revokeObjectURL(href);
      }, 60000);
    }
  };

  // 1. Capacitor Native Share / FileOpener (@capacitor/filesystem + @capacitor/share)
  if (isCapacitorNative()) {
    const base64Content = await blobToBase64(blob);
    const nativeRes = await shareOrOpenNativeFile({
      fileName,
      mimeType: 'image/png',
      base64Content,
      title: shareTitle,
      text: shareText,
      dialogTitle: mode === 'download' ? 'Görseli Kaydet / Aç' : 'Nöbet Çizelgesini Paylaş',
      preferFileOpener: mode === 'download',
    });
    if (nativeRes.handled) {
      return true;
    }

    const uploaded = await uploadPngToServer(blob, fileName);
    if (uploaded) {
      const target = mode === 'download' ? uploaded.downloadUrl : uploaded.inlineUrl;
      const opened = await openExternalSystemUrl(toAbsoluteApiUrl(target));
      if (opened) return true;
    }
  }

  // 2. Web Share API (when mode === 'share')
  if (mode === 'share') {
    try {
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: shareTitle,
          text: shareText,
        });
        return true;
      }
    } catch (shareErr: unknown) {
      const errName = shareErr instanceof Error ? shareErr.name : '';
      const errMsg = shareErr instanceof Error ? shareErr.message : String(shareErr);
      if (errName === 'AbortError' || /cancel|abort/i.test(errMsg)) {
        return true;
      }
      // Fall through to real HTTP PNG download
    }
  }

  // 3. Real HTTP server-backed PNG download (Content-Type: image/png + Content-Disposition: attachment)
  // Prevents Android Chrome / WebView / iframe from stripping .png extension on blob: URLs
  const uploaded = await uploadPngToServer(blob, fileName);
  if (uploaded) {
    triggerUrlDownload(toAbsoluteApiUrl(uploaded.downloadUrl), false);
    return true;
  }

  // 4. Offline Blob Download Fallback
  const objectUrl = URL.createObjectURL(blob);
  triggerUrlDownload(objectUrl, true);
  return true;
}

export const useShare = () => {
  const shareCanvas = useCallback(
    async (
      canvas: HTMLCanvasElement,
      fileName = 'nobet-cizelgesi.png',
      mode: 'share' | 'download' = 'share'
    ): Promise<boolean> => {
      try {
        const blob = await canvasToPngBlob(canvas);
        return await deliverPngBlob(
          blob,
          fileName,
          mode,
          'Vardiya 112 Nöbet Çizelgesi',
          'Vardiya 112 Aylık Nöbet Çizelgesi'
        );
      } catch {
        return false;
      }
    },
    []
  );

  const shareElement = useCallback(
    async (element: HTMLElement, fileName = 'vardiya-durumu.png'): Promise<boolean> => {
      try {
        const bgcolor = resolveCaptureBgColor(element);
        const dataUrl = await captureElementAsPng(element, bgcolor);
        const blob = dataUrlToBlob(dataUrl, 'image/png');
        return await deliverPngBlob(blob, fileName, 'share');
      } catch {
        return false;
      }
    },
    []
  );

  return { shareElement, shareCanvas };
};
