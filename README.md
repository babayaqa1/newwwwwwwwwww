# YouTube Parça Kesici 🎬✂️

YouTube linkini yapıştır → istediğin **dakika aralığını** seç → o parçayı kesip **bilgisayarına indir**.
Arayüz Azericedir. Sonra o parçayı istediğin gibi yeniden YouTube'a yükleyebilirsin.

Alet tamamen **kendi bilgisayarında** çalışır. İndirdiğin dosyalar sadece sana gelir.

---

## Neden bir sunucu gerekiyor?

Tarayıcı tek başına YouTube videosunu indiremez (YouTube buna izin vermiyor, CORS engeli var).
Bu yüzden küçük bir Node.js sunucusu, arka planda iki araç kullanır:

- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — YouTube'dan videoyu (sadece seçtiğin aralığı) indirir
- **[ffmpeg](https://ffmpeg.org/)** — videoyu tam noktadan keser ve birleştirir

Bu iki aracı bir kez kurman yeterli.

---

## Kurulum

### 1. Node.js
Node.js 18+ gerekli. [nodejs.org](https://nodejs.org) adresinden kur.

### 2. yt-dlp və ffmpeg

**Windows** (PowerShell — [winget](https://learn.microsoft.com/windows/package-manager/) ile):
```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

**macOS** ([Homebrew](https://brew.sh) ile):
```bash
brew install yt-dlp ffmpeg
```

**Linux** (Debian/Ubuntu):
```bash
sudo apt install ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

Kurulumu yoxla:
```bash
yt-dlp --version
ffmpeg -version
```

### 3. Aleti başlat
```bash
cd youtube-parca-kesici
npm install
npm start
```

Sonra tarayıcıda aç: **http://localhost:4545**

> **Windows'ta kısayol:** `npm install`i bir kez yaptıktan sonra (ya da hiç yapmadan)
> klasördeki **`BASLAT.bat`** dosyasına çift tıklaman yeterli — gerekirse paketleri kurar,
> sunucuyu başlatır ve tarayıcıyı otomatik açar.

---

## Otomatik güncelleme (bir daha ZIP indirme!)

ZIP yerine **bir kez git ile kur** — sonra `BASLAT.bat` her açılışta son sürümü kendisi çeker.

**Tek seferlik kurulum:**
1. Git'i kur: PowerShell'de `winget install Git.Git` (sonra PowerShell'i yeniden aç)
2. Projeyi klonla (istediğin klasörde, örn. Masaüstü):
   ```powershell
   cd "$HOME\Desktop"
   git clone https://github.com/babayaqa1/newwwwwwwwwww
   ```
3. Oluşan `newwwwwwwwwww` klasörüne gir → **`BASLAT.bat`**'a çift tıkla

Bundan sonra: **sadece `BASLAT.bat`'a çift tıkla.** İçindeki `git pull` en son sürümü otomatik indirir — ZIP derdi biter. (Senin `cookies.txt` dosyan ve indirdiğin videolar güncellemeden etkilenmez, git onlara dokunmaz.)

---

## Nasıl istifadə edilir

1. YouTube linkini yapıştır, **"Melumati al"**a bas.
2. Video başlığı, uzunluğu ve önizlemesi görünür.
3. Zaman çizelgesinden aralık seç (veya `04:00-05:20` yaz), **"+ elave et"** ile listeye ekle. İstediğin kadar aralık ekleyebilirsin — hepsi **tek videoda birleşir**.
4. **Video (mp4)** veya **Sadece səs (mp3)** seç.
5. Keyfiyyəti seç — standart olaraq **Ən yüksək (avtomatik)** (4K-a qədər; mp3-də göstərilmir).
6. **"Kes, birleshdir ve yukle"**yə bas. **Canlı yüzdə** göstərgesi ilerleyişi göstərir; bitince fayl (`.mp4` / `.mp3`) videonun **adıyla** bilgisayarına inir.

---

## Qeydlər

- İlk kez ağır/uzun bir aralık biraz sürebilir (yt-dlp `--force-keyframes-at-cuts` ile tam noktadan keser).
- Bazı videolar bölge/yaş kısıtlamalı olabilir; o zaman yt-dlp indiremez.
- **"Sign in to confirm you're not a bot" hatası** alırsan çerez lazım. İki yol:
  - **Kolay ama kırılgan:** menüden tarayıcını seç (Firefox en sorunsuzu). Chrome/Edge seçersen tarayıcı **tamamen kapalı** olmalı, yoksa `Could not copy Chrome cookie database` hatası gelir (Chrome çerez dosyasını kilitler).
  - **En sağlam (tavsiye): `cookies.txt`** — tarayıcına **"Get cookies.txt LOCALLY"** eklentisini kur, `youtube.com` açıkken eklentiden **Export** de, inen `cookies.txt` dosyasını proje klasörüne (`server.js`'in yanına) koy. Sonra menüden **"cookies.txt fayli"**ni seç. Bu yöntem tarayıcının açık/kapalı olmasından etkilenmez. (`cookies.txt` git'e gönderilmez, kişiseldir.)
- yt-dlp'yi ara sıra güncelle: `yt-dlp -U` (YouTube değişikliklerine ayak uydurur).
- Port değiştirmek için: `PORT=8080 npm start`.

## Məsuliyyət

Bu alet yalnız **öz kontentin** ya da paylaşım/kesim üçün icazə verilən videolar üçün nəzərdə tutulub.
Başqasının müəllif hüququ ilə qorunan videosunu icazəsiz yenidən yükləmək YouTube qaydalarını və
müəllif hüququnu poza bilər. İstifadə məsuliyyəti səninlədir.
