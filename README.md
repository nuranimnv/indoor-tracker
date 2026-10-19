# Indoor Tracker — telefonla otaq daxilində hərəkətin izlənməsi

İstifadəçi otağın ölçülərini (en × uzunluq, metrlə və ya addımla) daxil edir. Ekranda həmin ölçüdə düzbucaqlı çəkilir.
Telefonu götürən adam otaqda yeridikcə telefon öz sensorları ilə mövqeyini hesablayır və
müəllimin ekranında (panel) nöqtə də eyni cür hərəkət edir.

## Fayllar

| Fayl | Nə edir |
|---|---|
| `index.html` | Başlanğıc: sessiya ID və otaq ölçülərini daxil etmək |
| `dashboard.html` + `js/dashboard.js` | Müəllimin ekranı: canlı xəritə, statistika, telefon üçün QR kod |
| `phone.html` + `js/phone.js` | Telefon: sensorlar, addım hesablanması, mövqeyin göndərilməsi |
| `js/room.js` | Otağın (düzbucaqlı, tor, iz, nöqtə) canvas-da çəkilməsi |
| `js/sync.js` | Telefon ↔ panel əlaqəsi (Firebase Realtime Database) |
| `js/config.js` | Firebase açarları — **buranı doldurmaq lazımdır** |
| `serve.ps1` | Kompüterdə test üçün kiçik veb server |

## Necə işləyir (müəllimə izah üçün)

GPS bina daxilində işləmir. Ona görə **Pedestrian Dead Reckoning (PDR)** metodundan istifadə olunur:

1. **Addımın aşkarlanması** — akselerometr (`devicemotion`).
   - Cazibə vektoru yavaş orta qiymətlə tapılır və təcilin yalnız **şaquli** hissəsi götürülür (telefon necə tutulsa da işləyir).
     Filtrlər zamana əsaslanır, ona görə telefon saniyədə 60 və ya 200 ölçü göndərsə də nəticə eynidir.
   - Hər addımda ayaq yerə dəyəndə bu siqnalda bir böyük müsbət **zirvə**, ardınca çökəklik olur. Zirvə tamamlananda
     (siqnal yenidən aşağı enəndə) onun gücü məlumdur və qərar verilir. Bir addım iki dəfə sayılmır.
   - Dayananda bədənin silkələnməsi və çəkinin ayaqdan ayağa keçməsi real addımın təxminən yarısı qədər olur.
     Ona görə son addımların orta gücünün **60%-indən zəif** zirvələr sayılmır. Addım gücü yadda qalır və ~45 s-də unudulur.
   - Güclü zirvə (≥ 1.6 m/s²) dərhal addım sayılır, tək addım da işləyir. Zəif zirvələr yalnız 2 s ərzində oxşar
     ikinci zirvə gələndə sayılır. İki addım arası ən azı 0.3 s olmalıdır.
   - Adam dönəndə (istiqamət 1 s-də 30°-dən çox dəyişəndə) və ya telefon əldə sürətlə fırlananda addım sayılmır.
2. **İstiqamət** — giroskop/kompas (`deviceorientation`). Telefonun "irəli" istiqaməti α, β, γ bucaqlarından hesablanır.
3. **Kalibrləmə** — «Başla» basılanda adam üzünü xəritənin yuxarı divarına tutur. Həmin istiqamət 0° qəbul edilir.
4. **Yeni mövqe**, hər addımda:
   `x = x + L·sin(θ)`, `y = y − L·cos(θ)`. Burada L addım uzunluğu (default 0.65 m), θ isə otağa nisbətən istiqamətdir.
   Mövqe divarlardan kənara çıxa bilməz.
5. Mövqe Firebase Realtime Database-ə yazılır, panel onu dərhal oxuyub ekranda göstərir (gecikmə ~0.1–0.3 s).

Məhdudiyyət: PDR-də xəta zamanla toplanır (təxminən yeridilən məsafənin 5–10%-i).
Onu azaltmaq üçün:
- Otağın ölçüsünü **addımla** daxil edin, o zaman nöqtə də sizin addımlarınızla hərəkət edir. Yaxud Ayarlarda addım uzunluğunu ölçün.
- İzləmə zamanı xəritədə adamın həqiqi yerinə toxunsanız, mövqe həmin nöqtəyə düzəldilir.
- Başlanğıc nöqtəsinə (A) qayıdıb **«📍 A nöqtəsinə qayıtdım»** düyməsini basanda toplanmış xəta yol boyunca paylanır və iz A-da qapanır.

### Ayarlar (telefonda)
- **Addım həssaslığı** (default 1.0): addım sayılmırsa azaldın, artıq sayılırsa artırın.
- **● Sensor yazısı**: addım sayğacını yoxlamaq üçün. Düyməni basın, addımlarınızı sayaraq yeriyin, yenidən basın və
  neçə addım atdığınızı yazın. Xam sensor məlumatı Firebase-də `sessions/{id}/debug` altında saxlanır və təhlil üçün istifadə olunur.

## Qurulma

### 1. Firebase Realtime Database
1. [console.firebase.google.com](https://console.firebase.google.com) → layihəniz (`indoorTracking`).
2. **Build → Realtime Database → Create database** (test mode).
3. **Rules** bölməsinə bunu yazın və **Publish** basın:
   ```json
   { "rules": { "sessions": { ".read": true, ".write": true } } }
   ```
4. **Project settings → General → Your apps → Web app (</>)** yaradın. `firebaseConfig` dəyərlərini
   `js/config.js` faylına köçürün. `databaseURL` mütləq doldurulmalıdır.

### 2. Saytı HTTPS-də yerləşdirmək (telefon sensorları üçün vacibdir)
Brauzer telefon sensorlarına yalnız **HTTPS** saytda icazə verir. Ən asan üsullar:
- **Netlify Drop**: [app.netlify.com/drop](https://app.netlify.com/drop). `indoor-tracker` qovluğunu ora sürüşdürüb atın. Sizə `https://...netlify.app` linki verilir.
- **GitHub Pages**: qovluğu repoya yükləyin, sonra Settings → Pages bölməsini aktiv edin.
- **Firebase Hosting**: `firebase init hosting` və `firebase deploy` (Node.js lazımdır).

### 3. İstifadə
1. Kompüterdə saytı açın, otağın ölçülərini daxil edin və **«Paneli aç»** basın.
2. Telefonla paneldəki **QR kodu** skan edin (və ya linki açın).
3. Telefonda xəritəyə toxunaraq hazırda dayandığınız yeri seçin.
4. Üzünüzü xəritənin **yuxarı** divarına çevirin, telefonu qarşınızda tutun və **«Başla»** basın. iPhone sensor icazəsi soruşacaq, «Allow» seçin.
5. Yeriyin. Müəllimin ekranında nöqtə və onun izi canlı hərəkət edəcək.

Kod yenilənəndən sonra telefon köhnə faylları keşdən yükləməsin deyə HTML fayllarında skript versiyasını (`?v=23`) artırın.

## Kompüterdə test (telefonsuz)
`js/config.js` boş olsa, proqram **lokal rejimdə** işləyir: eyni brauzerin iki tabı bir-biri ilə əlaqə saxlayır.
```
powershell -ExecutionPolicy Bypass -File serve.ps1
```
Sonra `http://localhost:8080` açın. Bir tabda paneli, digərində telefon səhifəsini açın.
«Əl ilə idarə» bölməsindəki oxlarla hərəkəti yoxlaya bilərsiniz.
