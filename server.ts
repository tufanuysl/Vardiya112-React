import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '25mb' }));

function getGenAIClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.post('/api/shift-schedule/analyze', async (req, res) => {
  try {
    const { mimeType, base64Data, currentGroupNames, currentNumGroups, currentYearMonth } =
      req.body || {};

    if (!mimeType || !base64Data) {
      res.status(400).json({
        error: 'Lütfen geçerli bir PDF veya fotoğraf dosyası yükleyin.',
      });
      return;
    }

    const ai = getGenAIClient();

    const promptText = `Sen 112 Acil Çağrı Merkezi, hastane, sağlık ve vardiya çizelgelerini okuyan uzman bir yapay zeka asistanısın.
Kullanıcı bir vardiya/nöbet listesi belgesi (PDF veya fotoğraf) yükledi.
Mevcut sistem bağlamı:
- Mevcut yıl/ay referansı: ${currentYearMonth || '2026-11'} (Eğer belgede yıl yazmıyorsa bu yılı baz al, ay yazmıyorsa bu ayı baz al).
- Mevcut grup sayısı: ${currentNumGroups || 5}
- Mevcut grup adları: ${Array.isArray(currentGroupNames) ? currentGroupNames.join(', ') : '1. Grup, 2. Grup, 3. Grup, 4. Grup, 5. Grup'}

GÖREVİN:
1. Belgedeki nöbet/vardiya sistemini analiz et:
   - Kaç grup var? (Örn: 5 grup, 4 grup, 3 grup vb. Eğer grup isimleri A, B, C, D, E veya 1. Grup, 2. Grup ise bunları sırayla 0'dan başlayan groupIndex ile eşleştir).
   - Çalışma sistemi 12/36 (Gündüz - Gece dönüşümlü) mi yoksa 24 saatlik (24/48, 24/72) mi?
   - Vardiya başlangıç ve bitiş saatleri belgede yazıyorsa çıkar (yazmıyorsa standart 08:00-20:00 ve 20:00-08:00 kullan).
2. Belgede gruplara ait personel/üye isimleri varsa her grubun üyelerini çıkar.
3. Belgedeki tablodan veya listeden tarih bazlı nöbet kayıtlarını (referenceCandidates) çıkar:
   - Her kayıt için tarih (YYYY-MM-DD formatında), hangi grup olduğu (0 tabanlı groupIndex ve groupName) ve vardiya tipi ('GUNDUZ' veya 'AKSAM') belirt.
   - 24 saatlik nöbetlerde vardiya tipini 'GUNDUZ' olarak işaretle.
   - Tablodan en net okunan en az 5-15 adet nöbet eşleşmesini referenceCandidates dizisine ekle.
4. Kullanıcının doğrudan referans alabileceği en güvenilir başlangıç nöbet bilgisini suggestedReference alanında öner.
5. Belgenin anlaşılır Türkçe özetini documentSummary alanına yaz.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: promptText,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            documentSummary: {
              type: Type.STRING,
              description: 'Belgenin Türkçe özeti (tespit edilen ay, sistem, grup sayısı vb.)',
            },
            confidenceNote: {
              type: Type.STRING,
              description: 'Okuma netliği ve dikkat edilmesi gereken kısa not',
            },
            detectedSystem: {
              type: Type.OBJECT,
              properties: {
                numGroups: {
                  type: Type.INTEGER,
                  description: 'Tespit edilen toplam grup sayısı (2 ile 10 arası)',
                },
                is24HourSystem: {
                  type: Type.BOOLEAN,
                  description: '24 saatlik nöbet sistemi mi?',
                },
                dayStart: {
                  type: Type.STRING,
                  description: 'Gündüz vardiyası başlangıç saati (SS:DD)',
                },
                dayEnd: {
                  type: Type.STRING,
                  description: 'Gündüz vardiyası bitiş saati (SS:DD)',
                },
                nightStart: {
                  type: Type.STRING,
                  description: 'Gece vardiyası başlangıç saati (SS:DD)',
                },
                nightEnd: {
                  type: Type.STRING,
                  description: 'Gece vardiyası bitiş saati (SS:DD)',
                },
                restHours: {
                  type: Type.INTEGER,
                  description: 'Standart dinlenme süresi (örn. 36, 48, 72)',
                },
                shiftTransition: {
                  type: Type.STRING,
                  description: 'ALTERNATE (Dönüşümlü) veya SAME (Sabit)',
                },
                shiftPreset: {
                  type: Type.STRING,
                  description: '112_5G, 112_4G, 24_48, 24_72 veya CUSTOM',
                },
              },
              required: [
                'numGroups',
                'is24HourSystem',
                'dayStart',
                'dayEnd',
                'nightStart',
                'nightEnd',
                'restHours',
                'shiftTransition',
                'shiftPreset',
              ],
            },
            detectedGroups: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  groupIndex: {
                    type: Type.INTEGER,
                    description: '0 tabanlı grup indeksi (0 = 1. Grup)',
                  },
                  groupName: {
                    type: Type.STRING,
                    description: 'Grup adı (örn. 1. Grup, A Grubu)',
                  },
                  members: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Gruptaki personellerin ad soyad listesi',
                  },
                },
                required: ['groupIndex', 'groupName', 'members'],
              },
            },
            referenceCandidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: {
                    type: Type.STRING,
                    description: 'YYYY-MM-DD formatında nöbet tarihi',
                  },
                  groupIndex: {
                    type: Type.INTEGER,
                    description: '0 tabanlı grup indeksi',
                  },
                  groupName: {
                    type: Type.STRING,
                    description: 'Grup adı veya personel adı',
                  },
                  shiftType: {
                    type: Type.STRING,
                    description: 'GUNDUZ veya AKSAM',
                  },
                  label: {
                    type: Type.STRING,
                    description: 'Kısa açıklama (örn. 15 Kasım Çarşamba - 1. Grup Gündüz)',
                  },
                },
                required: ['date', 'groupIndex', 'groupName', 'shiftType', 'label'],
              },
            },
            suggestedReference: {
              type: Type.OBJECT,
              properties: {
                groupIndex: {
                  type: Type.INTEGER,
                  description: 'Önerilen referans grup indeksi (0 tabanlı)',
                },
                refDate: {
                  type: Type.STRING,
                  description: 'Önerilen referans tarihi (YYYY-MM-DD)',
                },
                refType: {
                  type: Type.STRING,
                  description: 'GUNDUZ veya AKSAM',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Bu referansın neden seçildiğine dair Türkçe açıklama',
                },
              },
              required: ['groupIndex', 'refDate', 'refType', 'explanation'],
            },
          },
          required: [
            'documentSummary',
            'confidenceNote',
            'detectedSystem',
            'detectedGroups',
            'referenceCandidates',
            'suggestedReference',
          ],
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);
    res.json(parsed);
  } catch (error: unknown) {
    console.error('Shift schedule analysis error:', error);
    const errMsg =
      error instanceof Error ? error.message : 'Vardiya listesi analiz edilirken bir hata oluştu.';
    res.status(500).json({
      error: errMsg,
    });
  }
});

// Temporary in-memory store for native .ics Calendar downloads/redirects
const icsStore = new Map<string, { content: string; filename: string; createdAt: number }>();

app.post('/api/calendar/ics', (req, res) => {
  const { icsContent, filename } = req.body || {};
  if (typeof icsContent !== 'string' || !icsContent.includes('BEGIN:VCALENDAR')) {
    res.status(400).json({ error: 'Geçersiz takvim verisi.' });
    return;
  }

  // Prune old entries (> 15 minutes)
  const now = Date.now();
  for (const [k, v] of icsStore.entries()) {
    if (now - v.createdAt > 15 * 60 * 1000) {
      icsStore.delete(k);
    }
  }

  const safeFilename =
    typeof filename === 'string' && /^[a-zA-Z0-9_.-]+\.ics$/.test(filename)
      ? filename
      : 'vardiya_takvimi.ics';
  const id = `${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  icsStore.set(id, {
    content: icsContent,
    filename: safeFilename,
    createdAt: now,
  });

  res.json({
    id,
    downloadUrl: `/api/calendar/ics/${id}/${safeFilename}`,
    inlineUrl: `/api/calendar/ics/${id}/${safeFilename}?inline=1`,
  });
});

app.get('/api/calendar/ics/:id/:filename', (req, res) => {
  const { id } = req.params;
  const entry = icsStore.get(id);
  if (!entry) {
    res.status(404).send('Takvim dosyası süresi doldu veya bulunamadı.');
    return;
  }

  const isInline = req.query.inline === '1';
  const buf = Buffer.from(entry.content, 'utf-8');

  // Strict 'text/calendar' without '; charset=utf-8' so Android PackageManager
  // and DownloadManager match Google Calendar / Samsung Calendar <data android:mimeType="text/calendar" />
  res.writeHead(200, {
    'Content-Type': 'text/calendar',
    'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${entry.filename}"`,
    'Content-Length': String(buf.length),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(buf);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
