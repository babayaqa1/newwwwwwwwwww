// YouTube Parca Kesici — kicik lokal server.
// Brauzer tek bashina YouTube videosunu yukleye bilmir (CORS + YouTube mehdudiyyetleri),
// buna gore butun agir is burada, yt-dlp ve ffmpeg vasitesile gorulur.
import express from 'express';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4545;

// Hazir fayllar bura yigilir; her indirmeden sonra temizlenir.
const TMP_ROOT = path.join(os.tmpdir(), 'yt-parca-kesici');

// Ishlek ishler: jobId -> veziyyet. Canli faiz ucun SSE ile oxunur.
const jobs = new Map();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Kicik komekci: prosesi ishe sal, cixishi topla, setir-setir izle ------
// spawn massiv arqumentlerle chagirilir (shell yoxdur) — deye URL/vaxt kimi
// istifadechi melumati komanda injection ucun tehlukeli deyil.
function run(cmd, args, { timeoutMs = 0, onLine = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    let buf = '';
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Proses ${cmd} vaxt ashdi (${timeoutMs} ms)`));
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => {
      stdout += d;
      if (onLine) {
        buf += d;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          onLine(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      // ENOENT — alet qurashdirilmayib. Aydin mesaj verek.
      if (err.code === 'ENOENT') {
        reject(new Error(`"${cmd}" tapilmadi. Zehmet olmasa qurashdirin (README-ya baxin).`));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${cmd} ${code} kodu ile bitdi`));
    });
  });
}

// Saniyeni HH:MM:SS formatina cevir (yt-dlp download-sections ucun).
function toTimestamp(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds)));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// YouTube "bot deyilsen tesdiqle" xetasi ucun: brauzerdeki cookie-leri istifade et.
// Yalniz tehlukesiz siyahidan brauzer adini qebul edirik (komanda injection olmasin).
const ALLOWED_BROWSERS = new Set(['chrome', 'edge', 'firefox', 'brave', 'opera', 'chromium', 'vivaldi', 'safari']);
function cookieArgs(browser) {
  const b = String(browser || '').trim().toLowerCase();
  return ALLOWED_BROWSERS.has(b) ? ['--cookies-from-browser', b] : [];
}

// Fayl adi ucun tehlukesiz metn (basliqdan) — sistemde qadagan simvollari sil.
function safeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ') // Windows-de qadagan simvollar
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'parca';
}

// --- Video haqqinda melumat -------------------------------------------------
app.post('/api/info', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Link boshdur.' });
  try {
    const { stdout } = await run(
      'yt-dlp',
      ['--dump-single-json', '--no-playlist', '--no-warnings', ...cookieArgs(req.body?.browser), url],
      { timeoutMs: 60_000 },
    );
    const info = JSON.parse(stdout);
    res.json({
      title: info.title || 'Adsiz',
      duration: info.duration || 0, // saniye
      uploader: info.uploader || info.channel || '',
      thumbnail: info.thumbnail || '',
      id: info.id || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Araliqlari yoxla ve normallashdir --------------------------------------
function parseSegments(body) {
  let segments = Array.isArray(body?.segments) ? body.segments : null;
  if (!segments || segments.length === 0) {
    const s = Number(body?.start);
    const e = Number(body?.end);
    if (Number.isFinite(s) && Number.isFinite(e)) segments = [{ start: s, end: e }];
  }
  if (!segments || segments.length === 0) return { error: 'En azi bir aralig secin.' };
  const clean = [];
  for (const seg of segments) {
    const s = Number(seg?.start);
    const e = Number(seg?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      return { error: 'Araliqlardan biri sehvdir (son > bashlangic olmalidir).' };
    }
    clean.push({ start: s, end: e });
  }
  return { segments: clean };
}

// --- Ishi bashlat: jobId qaytar, agir ishi arxada gor -----------------------
app.post('/api/cut/start', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const quality = String(req.body?.quality || 'best');
  const format = String(req.body?.format || 'video'); // 'video' | 'audio'
  const title = safeFileName(req.body?.title);
  const browser = req.body?.browser;
  if (!url) return res.status(400).json({ error: 'Link boshdur.' });

  const parsed = parseSegments(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const jobId = randomUUID();
  jobs.set(jobId, { percent: 0, phase: 'hazirlanir', done: false, error: null, fileName: null, filePath: null, dir: null });
  res.json({ jobId });

  // Arxada ishle (cavabi gozletme).
  processJob(jobId, { url, quality, format, title, browser, segments: parsed.segments })
    .catch((err) => {
      const job = jobs.get(jobId);
      if (job) { job.error = err.message; job.done = true; }
    });
});

async function processJob(jobId, { url, quality, format, title, browser, segments }) {
  const job = jobs.get(jobId);
  const isAudio = format === 'audio';
  const cookies = cookieArgs(browser);

  const allowedHeights = new Set(['360', '480', '720', '1080', '1440', '2160']);
  const height = quality === 'best' ? null : (allowedHeights.has(quality) ? quality : null);
  const formatArg = height
    ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`
    : 'bestvideo*+bestaudio/best';

  const jobDir = path.join(TMP_ROOT, jobId);
  await mkdir(jobDir, { recursive: true });
  job.dir = jobDir;

  const n = segments.length;
  const mergePhaseWeight = n > 1 ? 90 : 100; // birleshme varsa endirmeye 90% ayir

  const partFiles = [];
  for (let i = 0; i < n; i++) {
    const { start, end } = segments[i];
    job.phase = n > 1 ? `parca ${i + 1}/${n} endirilir` : (isAudio ? 'ses endirilir' : 'endirilir');

    const outTemplate = path.join(jobDir, `part${i}.%(ext)s`);
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline', // faiz setir-setir gelsin
      ...cookies, // YouTube bot yoxlamasi ucun brauzer cookie-leri
      '--download-sections', `*${toTimestamp(start)}-${toTimestamp(end)}`,
    ];
    if (isAudio) {
      args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      // deqiq kesim (birleshmede uc-uca oturmesi ucun vacibdir)
      args.push('--force-keyframes-at-cuts', '-f', formatArg, '--merge-output-format', 'mp4');
    }
    args.push('-o', outTemplate, url);

    await run('yt-dlp', args, {
      timeoutMs: 15 * 60_000,
      onLine: (line) => {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) {
          const frac = Number(m[1]) / 100;
          job.percent = Math.min(mergePhaseWeight, Math.round(((i + frac) / n) * mergePhaseWeight));
        }
      },
    });

    const produced = (await readdir(jobDir)).filter((f) => f.startsWith(`part${i}.`));
    if (produced.length === 0) throw new Error(`${i + 1}-ci parca yaradilmadi. Link ve vaxti yoxlayin.`);
    partFiles.push(path.join(jobDir, produced[0]));
    job.percent = Math.round(((i + 1) / n) * mergePhaseWeight);
  }

  // Birleshdir (cox parca) ya da birbasha ver (tek parca).
  const ext = isAudio ? '.mp3' : '.mp4';
  let finalPath;
  if (partFiles.length === 1) {
    finalPath = partFiles[0];
  } else {
    job.phase = 'birleshdirilir';
    job.percent = Math.max(job.percent, 92);
    const listPath = path.join(jobDir, 'list.txt');
    const listBody = partFiles
      .map((p) => `file '${p.split(path.sep).join('/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    await writeFile(listPath, listBody, 'utf8');

    finalPath = path.join(jobDir, `birlesmish${ext}`);
    try {
      // Sur'etli yol: yeniden kodlashdirmadan yapishdir.
      await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', finalPath],
        { timeoutMs: 10 * 60_000 });
    } catch {
      // Kodeklerin uyghunsuzlugunda -c copy uzumur; ehtiyat: yeniden kodlashdir.
      const reArgs = isAudio
        ? ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-q:a', '0', finalPath]
        : ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'veryfast', finalPath];
      await run('ffmpeg', reArgs, { timeoutMs: 25 * 60_000 });
    }
  }

  const suffix = n > 1 ? `_${n}parca` : '';
  job.fileName = `${title}${suffix}${ext}`;
  job.filePath = finalPath;
  job.percent = 100;
  job.phase = 'hazir';
  job.done = true;
}

// --- Canli faiz (Server-Sent Events) ----------------------------------------
app.get('/api/cut/stream/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  const send = () => {
    res.write(`data: ${JSON.stringify({
      percent: job.percent, phase: job.phase, done: job.done,
      error: job.error, fileName: job.fileName,
    })}\n\n`);
  };
  send();
  const timer = setInterval(() => {
    send();
    if (job.done) { clearInterval(timer); res.end(); }
  }, 400);
  req.on('close', () => clearInterval(timer));
});

// --- Hazir fayli yukle, sonra temizle ---------------------------------------
app.get('/api/cut/file/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.filePath) return res.status(404).json({ error: 'Fayl hazir deyil.' });
  res.download(job.filePath, job.fileName, async () => {
    await rm(job.dir, { recursive: true, force: true }).catch(() => {});
    jobs.delete(req.params.id);
  });
});

// Server bashlayanda kohne temp qaliqlarini sil (evvelki cokme/dayanmadan).
async function cleanupOldTemp() {
  if (!existsSync(TMP_ROOT)) return;
  const entries = await readdir(TMP_ROOT).catch(() => []);
  const now = Date.now();
  for (const name of entries) {
    const p = path.join(TMP_ROOT, name);
    const info = await stat(p).catch(() => null);
    if (info && now - info.mtimeMs > 60 * 60_000) {
      await rm(p, { recursive: true, force: true }).catch(() => {});
    }
  }
}

await mkdir(TMP_ROOT, { recursive: true });
await cleanupOldTemp();

app.listen(PORT, () => {
  console.log(`\n  YouTube Parca Kesici ishleyir:  http://localhost:${PORT}\n`);
});
