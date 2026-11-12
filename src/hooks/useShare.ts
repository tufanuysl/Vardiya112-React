import domtoimage from 'dom-to-image';
import { useCallback } from 'react';

export const useShare = () => {
  const shareElement = useCallback(async (element: HTMLElement, fileName = 'vardiya-durumu.png') => {
    const triggerDownload = (url: string) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    try {
      const isDark = document.documentElement.classList.contains('dark');
      const dataUrl = await domtoimage.toPng(element, {
        quality: 1.0,
        bgcolor: isDark ? '#090D16' : '#F8FAFC',
        filter: (node: Node) => {
          return !(node instanceof HTMLElement && node.classList && node.classList.contains('no-share'));
        },
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Vardiya 112',
            text: 'Vardiya 112 Takvim Görünümü',
          });
          return;
        } catch (shareErr: unknown) {
          const errName = shareErr instanceof Error ? shareErr.name : '';
          const errMsg = shareErr instanceof Error ? shareErr.message : String(shareErr);
          // User closed/canceled the native share sheet — not an error
          if (errName === 'AbortError' || /cancel|abort/i.test(errMsg)) {
            return;
          }
          // If Web Share API failed due to iframe/gesture restrictions, fall back to direct download
          triggerDownload(dataUrl);
          return;
        }
      }

      triggerDownload(dataUrl);
    } catch {
      // Ignore capture errors silently without blocking UI
    }
  }, []);

  return { shareElement };
};
