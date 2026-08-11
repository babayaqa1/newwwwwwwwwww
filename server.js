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

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Kicik komekci: prosesi ishe sal, cixishi topla -----------------------
// spawn massiv arqumentlerle chagirilir (shell yoxdur) — deye URL/vaxt kimi
// istifadechi melumati komanda injection ucun tehlukeli deyil.
function run(cmd, args, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Proses ${cmd} vaxt ashdi (${timeoutMs} ms)`));
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => { stdout += d; });
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

// --- Video haqqinda melumat -------------------------------------------------
app.post('/api/info', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Link boshdur.' });
  try {
    const { stdout } = await run(
      'yt-dlp',
      ['--dump-single-json', '--no-playlist', '--no-warnings', url],
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

// Fayl adi ucun tehlukesiz metn (basliqdan) — sistemde qadagan simvollari sil.
function safeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ') // Windows-de qadagan simvollar
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'parca';
}

// --- Bir ve ya bir nece araligi kes, birleshdir ve qaytar -------------------
app.post('/api/cut', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const quality = String(req.body?.quality || 'best'); // 'best' ya da maks hundurluk (piksel)
  const title = safeFileName(req.body?.title);

  if (!url) return res.status(400).json({ error: 'Link boshdur.' });

  // Araliqlari topla: yeni format (segments massivi) ya da kohne (start/end).
  let segments = Array.isArray(req.body?.segments) ? req.body.segments : null;
  if (!segments || segments.length === 0) {
    const s = Number(req.body?.start);
    const e = Number(req.body?.end);
    if (Number.isFinite(s) && Number.isFinite(e)) segments = [{ start: s, end: e }];
  }
  if (!segments || segments.length === 0) {
    return res.status(400).json({ error: 'En azi bir aralig secin.' });
  }

  // Her araligi yoxla.
  const clean = [];
  for (const seg of segments) {
    const s = Number(seg?.start);
    const e = Number(seg?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      return res.status(400).json({ error: 'Araliqlardan biri sehvdir (son > bashlangic olmalidir).' });
    }
    clean.push({ start: s, end: e });
  }

  const allowedHeights = new Set(['360', '480', '720', '1080', '1440', '2160']);
  // 'best' -> hec bir hundurluk mehdudiyyeti qoyma, en yuksek mumkun keyfiyyet.
  const height = quality === 'best' ? null : (allowedHeights.has(quality) ? quality : null);
  const formatArg = height
    ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`
    : 'bestvideo*+bestaudio/best';

  const jobDir = path.join(TMP_ROOT, randomUUID());
  await mkdir(jobDir, { recursive: true });

  try {
    // 1) Her araligi ayrica endir.
    const partFiles = [];
    for (let i = 0; i < clean.length; i++) {
      const { start, end } = clean[i];
      const outTemplate = path.join(jobDir, `part${i}.%(ext)s`);
      const args = [
        '--no-playlist',
        '--no-warnings',
        '--download-sections', `*${toTimestamp(start)}-${toTimestamp(end)}`,
        '--force-keyframes-at-cuts', // deqiq kesim (birleshmede uc-uca oturmesi ucun vacibdir)
        '-f', formatArg,
        '--merge-output-format', 'mp4',
        '-o', outTemplate,
        url,
      ];
      await run('yt-dlp', args, { timeoutMs: 15 * 60_000 });
      const produced = (await readdir(jobDir)).filter((f) => f.startsWith(`part${i}.`));
      if (produced.length === 0) throw new Error(`${i + 1}-ci parca yaradilmadi. Link ve vaxti yoxlayin.`);
      partFiles.push(path.join(jobDir, produced[0]));
    }

    // 2) Tek parca -> birleshdirmeye ehtiyac yoxdur. Cox parca -> ffmpeg concat.
    let finalPath;
    if (partFiles.length === 1) {
      finalPath = partFiles[0];
    } else {
      // concat demuxer: fayl siyahisi. Windows-de yollar ucun / istifade edirik.
      const listPath = path.join(jobDir, 'list.txt');
      const listBody = partFiles
        .map((p) => `file '${p.split(path.sep).join('/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      await writeFile(listPath, listBody, 'utf8');

      finalPath = path.join(jobDir, 'birlesmish.mp4');
      try {
        // Evvelce sur'etli yol: yeniden kodlashdirmadan yapishdir.
        await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', finalPath],
          { timeoutMs: 10 * 60_000 });
      } catch {
        // Kodeklerin uyghunsuzlugunda -c copy uzumur; ehtiyat: yeniden kodlashdir.
        await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'veryfast', finalPath],
          { timeoutMs: 25 * 60_000 });
      }
    }

    // 3) Fayl adi: video basligi + parca sayi.
    const ext = path.extname(finalPath) || '.mp4';
    const suffix = clean.length > 1 ? `_${clean.length}parca` : '';
    const safeName = `${title}${suffix}${ext}`;

    res.download(finalPath, safeName, async (err) => {
      // Gonderdikden sonra temizle (ugurlu ya ugursuz — fayllar qalmasin).
      await rm(jobDir, { recursive: true, force: true }).catch(() => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Fayl gonderilerken xeta.' });
      }
    });
  } catch (err) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
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
