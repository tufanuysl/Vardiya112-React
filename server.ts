import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const FIREBASE_PROJECT_ID = 'intrepid-league-2bcxw';

// Hide Express fingerprint and trust reverse proxy (Cloud Run / AI Studio proxy)
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ============================================================================
// 1. SUSPICIOUS ACTIVITY AUDIT LOGGER (In-memory bounded ring buffer + console)
// ============================================================================
interface SecurityAuditEntry {
  timestamp: string;
  level: 'WARN' | 'BLOCK';
  event: string;
  ipHash: string;
  method: string;
  path: string;
  reason: string;
}

const securityAuditLog: SecurityAuditEntry[] = [];
const MAX_AUDIT_LOG_ENTRIES = 200;

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function hashIpForAudit(ip: string): string {
  return crypto.createHash('sha256').update(`${ip}:vardiya112-audit`).digest('hex').slice(0, 12);
}

function logSecurityEvent(
  level: 'WARN' | 'BLOCK',
  event: string,
  req: Request,
  reason: string
): void {
  const entry: SecurityAuditEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ipHash: hashIpForAudit(getClientIp(req)),
    method: req.method,
    path: req.originalUrl || req.path,
    reason,
  };
  securityAuditLog.push(entry);
  if (securityAuditLog.length > MAX_AUDIT_LOG_ENTRIES) {
    securityAuditLog.shift();
  }
  console.warn(
    `[SECURITY:${entry.level}] ${entry.event} | ip=${entry.ipHash} | ${entry.method} ${entry.path} | ${entry.reason}`
  );
}

// ============================================================================
// 2. HTTPS ENFORCEMENT & SECURITY HEADERS
// ============================================================================
app.use((req: Request, res: Response, next: NextFunction) => {
  // Enforce HTTPS in production behind Cloud Run proxy
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (IS_PRODUCTION && forwardedProto === 'http') {
    logSecurityEvent('BLOCK', 'INSECURE_HTTP_REQUEST', req, 'Plain HTTP request in production');
    if (req.method === 'GET' || req.method === 'HEAD') {
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';
      res.redirect(301, `https://${host}${req.originalUrl}`);
      return;
    }
    res.status(403).json({ error: 'Güvenli bağlantı (HTTPS) zorunludur.' });
    return;
  }

  // Standard hardened security headers (compatible with AI Studio preview iframe & Firebase Auth popups)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), payment=(), usb=(), microphone=(self), geolocation=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// ============================================================================
// 3. STRICT CORS ALLOWLIST & CSRF PROTECTION
// ============================================================================
const STATIC_TRUSTED_ORIGINS = new Set<string>([
  'https://ais-dev-5pef5obhvgovpp2guu4e54-398735320015.europe-west1.run.app',
  'https://ais-pre-5pef5obhvgovpp2guu4e54-398735320015.europe-west1.run.app',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function isTrustedOrigin(origin: string | undefined, req: Request): boolean {
  if (!origin) return true; // Same-origin navigation / non-CORS request
  if (STATIC_TRUSTED_ORIGINS.has(origin)) return true;

  try {
    const parsed = new URL(origin);
    const reqHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim();
    if (reqHost && parsed.host === reqHost) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (origin) {
    if (isTrustedOrigin(origin, req)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With'
      );
      res.setHeader('Access-Control-Max-Age', '600');
    } else if (req.path.startsWith('/api/')) {
      logSecurityEvent('BLOCK', 'CORS_ORIGIN_REJECTED', req, `Untrusted origin: ${origin}`);
      res.status(403).json({ error: 'Bu kaynaktan erişime izin verilmiyor (CORS).' });
      return;
    }
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  // CSRF protection for state-changing / API POST requests:
  // Require custom header X-Requested-With: Vardiya112Client or verified trusted Origin + JSON content-type
  if (req.path.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD') {
    const requestedWith = req.headers['x-requested-with'];
    const contentType = String(req.headers['content-type'] || '');
    const hasCustomHeader = requestedWith === 'Vardiya112Client';
    const hasTrustedOriginAndJson =
      Boolean(origin) && isTrustedOrigin(origin, req) && contentType.includes('application/json');

    if (!hasCustomHeader && !hasTrustedOriginAndJson) {
      logSecurityEvent(
        'BLOCK',
        'CSRF_GUARD_TRIGGERED',
        req,
        'Missing X-Requested-With header or untrusted Content-Type on state-changing API call'
      );
      res.status(403).json({ error: 'Geçersiz güvenlik başlığı (CSRF koruması).' });
      return;
    }
  }

  next();
});

// Tightened payload limit (12 MB max JSON body)
app.use(express.json({ limit: '12mb' }));

// ============================================================================
// 4. SLIDING-WINDOW PER-IP RATE LIMITER
// ============================================================================
interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();
const MAX_RATE_BUCKET_KEYS = 5000;

function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  routeLabel: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (rateBuckets.size > MAX_RATE_BUCKET_KEYS) {
      for (const [k, v] of rateBuckets.entries()) {
        if (now > v.resetAt) rateBuckets.delete(k);
      }
    }

    const clientIp = getClientIp(req);
    const key = `${options.routeLabel}:${clientIp}`;
    const existing = rateBuckets.get(key);

    if (!existing || now > existing.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
      res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(options.maxRequests - 1));
      next();
      return;
    }

    existing.count += 1;
    const remaining = Math.max(0, options.maxRequests - existing.count);
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (existing.count > options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      logSecurityEvent(
        'BLOCK',
        'RATE_LIMIT_EXCEEDED',
        req,
        `Exceeded ${options.maxRequests} req/${options.windowMs}ms on ${options.routeLabel}`
      );
      res.status(429).json({
        error: `Çok fazla istek gönderildi. Lütfen ${retryAfterSec} saniye bekleyip tekrar deneyin.`,
      });
      return;
    }

    next();
  };
}

const aiRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 12,
  routeLabel: 'ai-endpoint',
});

const exportRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  routeLabel: 'export-weather',
});

// ============================================================================
// 5. SERVER-SIDE FIREBASE ID TOKEN VERIFICATION (Cryptographic RS256 Check)
// ============================================================================
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && now < cachedGoogleCerts.expiresAt) {
    return cachedGoogleCerts.certs;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(GOOGLE_CERTS_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch Google certs: ${response.status}`);
    }
    const certs = (await response.json()) as Record<string, string>;
    cachedGoogleCerts = {
      certs,
      expiresAt: now + 60 * 60 * 1000, // 1 hour cache
    };
    return certs;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeBase64UrlJson<T>(segment: string): T | null {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf-8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

async function verifyFirebaseIdToken(idToken: string): Promise<{
  uid: string;
  email?: string;
} | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  const [headerSeg, payloadSeg, signatureSeg] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerSeg);
  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
  }>(payloadSeg);

  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || !header.kid) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec - 30) return null;
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) return null;

  const certs = await getGooglePublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) return null;

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerSeg}.${payloadSeg}`);
  verifier.end();

  const signatureBuf = Buffer.from(signatureSeg, 'base64url');
  const isValid = verifier.verify(certPem, signatureBuf);
  if (!isValid) return null;

  return {
    uid: payload.sub,
    email: payload.email,
  };
}

async function requireFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logSecurityEvent('BLOCK', 'MISSING_AUTH_TOKEN', req, 'Authorization Bearer token required');
    res.status(401).json({
      error: 'Bu işlem için oturum açmanız gerekiyor. Lütfen Google hesabınızla giriş yapın.',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length < 32 || token.length > 4096) {
    logSecurityEvent('BLOCK', 'MALFORMED_AUTH_TOKEN', req, 'Invalid token length');
    res.status(401).json({ error: 'Geçersiz oturum anahtarı.' });
    return;
  }

  try {
    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      logSecurityEvent('BLOCK', 'INVALID_AUTH_TOKEN', req, 'JWT signature or claims check failed');
      res.status(401).json({
        error: 'Oturum süresi dolmuş veya geçersiz. Lütfen tekrar giriş yapın.',
      });
      return;
    }
    next();
  } catch {
    logSecurityEvent('WARN', 'AUTH_VERIFICATION_ERROR', req, 'Token verification failed');
    res.status(401).json({ error: 'Kimlik doğrulaması yapılamadı.' });
  }
}

// ============================================================================
// 6. UPLOAD MAGIC-BYTE & INPUT VALIDATION HELPERS
// ============================================================================
const ALLOWED_SCHEDULE_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
]);

function verifyFileMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) return false;

  if (mimeType === 'application/pdf') {
    // %PDF- (25 50 44 46 2D)
    return (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46 &&
      buffer[4] === 0x2d
    );
  }
  if (mimeType === 'image/jpeg') {
    // FF D8 FF
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    // 89 50 4E 47 0D 0A 1A 0A
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mimeType === 'image/webp') {
    // RIFF....WEBP
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

function sanitizePlainText(input: unknown, maxLen = 60): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001F\u007F<>`$\\]/g, '')
    .trim()
    .slice(0, maxLen);
}

// ============================================================================
// 7. ROUTES
// ============================================================================
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Vardiya 112',
    timestamp: new Date().toISOString(),
  });
});

function getGenAIClient() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Sunucu yapay zeka anahtarı yapılandırılmamış.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.post(
  '/api/shift-schedule/analyze',
  aiRateLimiter,
  requireFirebaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { mimeType, base64Data, currentGroupNames, currentNumGroups, currentYearMonth } =
        req.body || {};

      const cleanMime = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';
      if (!ALLOWED_SCHEDULE_MIMES.has(cleanMime)) {
        logSecurityEvent('BLOCK', 'INVALID_UPLOAD_MIME', req, `Rejected mimeType=${cleanMime}`);
        res.status(400).json({
          error: 'Yalnızca PDF, JPEG, PNG veya WEBP formatında çizelge yükleyebilirsiniz.',
        });
        return;
      }

      if (typeof base64Data !== 'string' || base64Data.length < 32) {
        res.status(400).json({
          error: 'Lütfen geçerli bir PDF veya fotoğraf dosyası yükleyin.',
        });
        return;
      }

      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '').trim();
      const decodedBuffer = Buffer.from(cleanBase64, 'base64');
      const MAX_SCHEDULE_BYTES = 8 * 1024 * 1024; // 8 MB

      if (decodedBuffer.length === 0 || decodedBuffer.length > MAX_SCHEDULE_BYTES) {
        logSecurityEvent(
          'BLOCK',
          'UPLOAD_SIZE_EXCEEDED',
          req,
          `Schedule upload bytes=${decodedBuffer.length}`
        );
        res.status(400).json({
          error: 'Dosya boyutu çok büyük (Maksimum 8 MB).',
        });
        return;
      }

      if (!verifyFileMagicBytes(decodedBuffer, cleanMime)) {
        logSecurityEvent(
          'BLOCK',
          'UPLOAD_MAGIC_MISMATCH',
          req,
          `File signature did not match declared mimeType=${cleanMime}`
        );
        res.status(400).json({
          error: 'Dosya içeriği seçilen dosya türüyle uyuşmuyor veya bozuk.',
        });
        return;
      }

      const safeYearMonth =
        typeof currentYearMonth === 'string' && /^\d{4}-\d{2}$/.test(currentYearMonth)
          ? currentYearMonth
          : '2026-11';
      const safeNumGroups =
        typeof currentNumGroups === 'number' &&
        Number.isInteger(currentNumGroups) &&
        currentNumGroups >= 2 &&
        currentNumGroups <= 10
          ? currentNumGroups
          : 5;
      const safeGroupNames = Array.isArray(currentGroupNames)
        ? currentGroupNames
            .slice(0, 10)
            .map((n) => sanitizePlainText(n, 40))
            .filter(Boolean)
        : ['1. Grup', '2. Grup', '3. Grup', '4. Grup', '5. Grup'];

      const ai = getGenAIClient();

      const promptText = `Sen 112 Acil Çağrı Merkezi, hastane, sağlık ve vardiya çizelgelerini okuyan uzman bir yapay zeka asistanısın.
Kullanıcı bir vardiya/nöbet listesi belgesi (PDF veya fotoğraf) yükledi.
Mevcut sistem bağlamı:
- Mevcut yıl/ay referansı: ${safeYearMonth} (Eğer belgede yıl yazmıyorsa bu yılı baz al, ay yazmıyorsa bu ayı baz al).
- Mevcut grup sayısı: ${safeNumGroups}
- Mevcut grup adları: ${safeGroupNames.join(', ')}

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
                mimeType: cleanMime,
                data: cleanBase64,
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
      const errMsg = IS_PRODUCTION
        ? 'Vardiya listesi analiz edilirken bir hata oluştu.'
        : error instanceof Error
        ? error.message
        : 'Vardiya listesi analiz edilirken bir hata oluştu.';
      res.status(500).json({
        error: errMsg,
      });
    }
  }
);

// Temporary in-memory store for native .ics Calendar downloads/redirects (10-min TTL, max 100 items)
const icsStore = new Map<string, { content: string; filename: string; createdAt: number }>();
const EXPORT_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_EXPORT_STORE_ITEMS = 100;

app.post(
  '/api/calendar/ics',
  exportRateLimiter,
  requireFirebaseAuth,
  (req: Request, res: Response) => {
    const { icsContent, filename } = req.body || {};
    if (
      typeof icsContent !== 'string' ||
      !icsContent.includes('BEGIN:VCALENDAR') ||
      Buffer.byteLength(icsContent, 'utf-8') > 512 * 1024
    ) {
      res.status(400).json({ error: 'Geçersiz veya çok büyük takvim verisi.' });
      return;
    }

    const now = Date.now();
    for (const [k, v] of icsStore.entries()) {
      if (now - v.createdAt > EXPORT_TOKEN_TTL_MS) {
        icsStore.delete(k);
      }
    }
    if (icsStore.size >= MAX_EXPORT_STORE_ITEMS) {
      const oldestKey = icsStore.keys().next().value;
      if (oldestKey) icsStore.delete(oldestKey);
    }

    const safeFilename =
      typeof filename === 'string' && /^[a-zA-Z0-9_.-]{1,64}\.ics$/.test(filename)
        ? filename
        : 'vardiya_takvimi.ics';
    const id = crypto.randomBytes(16).toString('hex');
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
  }
);

app.get('/api/calendar/ics/:id/:filename', exportRateLimiter, (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) {
    res.status(400).send('Geçersiz indirme bağlantısı.');
    return;
  }

  const entry = icsStore.get(id);
  if (!entry || Date.now() - entry.createdAt > EXPORT_TOKEN_TTL_MS) {
    icsStore.delete(id);
    res.status(404).send('Takvim dosyası süresi doldu veya bulunamadı.');
    return;
  }

  const isInline = req.query.inline === '1';
  const buf = Buffer.from(entry.content, 'utf-8');

  res.writeHead(200, {
    'Content-Type': 'text/calendar',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${entry.filename}"`,
    'Content-Length': String(buf.length),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(buf);
});

// Temporary in-memory store for Calendar PNG sharing/downloading (10-min TTL, max 100 items)
const imageStore = new Map<string, { buffer: Buffer; filename: string; createdAt: number }>();

app.post(
  '/api/calendar/image',
  exportRateLimiter,
  requireFirebaseAuth,
  (req: Request, res: Response) => {
    const { base64Data, filename } = req.body || {};
    if (typeof base64Data !== 'string' || base64Data.length < 32) {
      res.status(400).json({ error: 'Geçersiz görsel verisi.' });
      return;
    }

    const cleanBase64 = base64Data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
    const buffer = Buffer.from(cleanBase64, 'base64');
    const MAX_PNG_BYTES = 6 * 1024 * 1024; // 6 MB

    if (buffer.length > MAX_PNG_BYTES || !verifyFileMagicBytes(buffer, 'image/png')) {
      logSecurityEvent('BLOCK', 'INVALID_PNG_UPLOAD', req, `PNG size=${buffer.length}`);
      res.status(400).json({ error: 'Geçerli bir PNG dosyası oluşturulamadı.' });
      return;
    }

    const now = Date.now();
    for (const [k, v] of imageStore.entries()) {
      if (now - v.createdAt > EXPORT_TOKEN_TTL_MS) {
        imageStore.delete(k);
      }
    }
    if (imageStore.size >= MAX_EXPORT_STORE_ITEMS) {
      const oldestKey = imageStore.keys().next().value;
      if (oldestKey) imageStore.delete(oldestKey);
    }

    const safeFilename =
      typeof filename === 'string' && /^[a-zA-Z0-9_.-]{1,64}\.png$/.test(filename)
        ? filename
        : 'vardiya_takvimi.png';
    const id = crypto.randomBytes(16).toString('hex');
    imageStore.set(id, {
      buffer,
      filename: safeFilename,
      createdAt: now,
    });

    res.json({
      id,
      downloadUrl: `/api/calendar/image/${id}/${safeFilename}`,
      inlineUrl: `/api/calendar/image/${id}/${safeFilename}?inline=1`,
    });
  }
);

app.get('/api/calendar/image/:id/:filename', exportRateLimiter, (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) {
    res.status(400).send('Geçersiz görsel bağlantısı.');
    return;
  }

  const entry = imageStore.get(id);
  if (!entry || Date.now() - entry.createdAt > EXPORT_TOKEN_TTL_MS) {
    imageStore.delete(id);
    res.status(404).send('Görsel süresi doldu veya bulunamadı.');
    return;
  }

  const isInline = req.query.inline === '1';
  const encodedName = encodeURIComponent(entry.filename);
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${entry.filename}"; filename*=UTF-8''${encodedName}`,
    'Content-Length': String(entry.buffer.length),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(entry.buffer);
});

// Server-side Turkish Audio Transcription for Android WebView / Capacitor
app.post(
  '/api/voice/transcribe',
  aiRateLimiter,
  requireFirebaseAuth,
  async (req: Request, res: Response) => {
    try {
      const { mimeType, base64Data } = req.body || {};
      if (typeof base64Data !== 'string' || base64Data.length < 16) {
        res.status(400).json({ error: 'Ses kaydı boş veya geçersiz.' });
        return;
      }

      const rawMime =
        typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : 'audio/webm';
      if (!ALLOWED_AUDIO_MIMES.has(rawMime)) {
        logSecurityEvent('BLOCK', 'INVALID_AUDIO_MIME', req, `Rejected audio mime=${rawMime}`);
        res.status(400).json({ error: 'Desteklenmeyen ses formatı.' });
        return;
      }

      const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '').trim();
      const audioBuffer = Buffer.from(cleanBase64, 'base64');
      const MAX_AUDIO_BYTES = 6 * 1024 * 1024; // 6 MB
      if (audioBuffer.length === 0 || audioBuffer.length > MAX_AUDIO_BYTES) {
        logSecurityEvent('BLOCK', 'AUDIO_SIZE_EXCEEDED', req, `Audio bytes=${audioBuffer.length}`);
        res.status(400).json({ error: 'Ses kaydı boyutu çok büyük (Maksimum 6 MB).' });
        return;
      }

      const ai = getGenAIClient();

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: rawMime,
                data: cleanBase64,
              },
            },
            {
              text: 'Bu Türkçe ses kaydını yazıya dök. Konuşmacı 112 vardiya grubu için personel isimleri (ad soyad) söylüyor olabilir. Yalnızca duyduğun isimleri virgülle ayrılmış düz metin olarak yaz, başka hiçbir açıklama ekleme.',
            },
          ],
        },
      });

      const transcript = (response.text ?? '').trim();
      res.json({ transcript });
    } catch (error: unknown) {
      console.error('Voice transcription error:', error);
      const errMsg = IS_PRODUCTION
        ? 'Ses kaydı metne çevrilirken bir hata oluştu.'
        : error instanceof Error
        ? error.message
        : 'Ses kaydı metne çevrilirken bir hata oluştu.';
      res.status(500).json({ error: errMsg });
    }
  }
);

// Live Weather Proxy (Open-Meteo, 5-min in-memory cache per coordinate)
const weatherCache = new Map<string, { payload: unknown; cachedAt: number }>();

app.get('/api/weather', exportRateLimiter, async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ error: 'Geçersiz koordinat.' });
      return;
    }

    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cached = weatherCache.get(key);
    if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
      res.json(cached.payload);
      return;
    }

    if (weatherCache.size > 250) {
      const oldestKey = weatherCache.keys().next().value;
      if (oldestKey) weatherCache.delete(oldestKey);
    }

    const fetchWithTimeout = async (url: string, ms = 7000) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
    };

    const safeLat = encodeURIComponent(lat.toFixed(4));
    const safeLng = encodeURIComponent(lng.toFixed(4));
    const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${safeLat}&longitude=${safeLng}&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=Europe%2FIstanbul`;
    try {
      const upstream = await fetchWithTimeout(openMeteoUrl);
      if (upstream.ok) {
        const payload = await upstream.json();
        weatherCache.set(key, { payload, cachedAt: Date.now() });
        res.json(payload);
        return;
      }
    } catch {
      // Fall through to wttr.in backup
    }

    try {
      const backup = await fetchWithTimeout(`https://wttr.in/${safeLat},${safeLng}?format=j1`);
      if (backup.ok) {
        const payload = await backup.json();
        weatherCache.set(key, { payload, cachedAt: Date.now() });
        res.json(payload);
        return;
      }
    } catch {
      // Fall through to stale cache or error
    }

    if (cached) {
      res.json(cached.payload);
      return;
    }
    res.status(502).json({ error: 'Hava durumu alınamadı.' });
  } catch {
    res.status(500).json({ error: 'Hava durumu servisine ulaşılamadı.' });
  }
});

async function startServer() {
  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        dotfiles: 'deny',
      })
    );
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
