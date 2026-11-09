# Tahta Kilit — Yönetim Paneli

Okullardaki akıllı tahtaları tek merkezden yönetmek için web paneli.
Firebase Authentication (e-posta/şifre) ve Realtime Database kullanır.

© Mehmet Karadeniz, 2026-2027

## Dosyalar

- `index.html` — arayüz ve stiller
- `app.js` — Firebase bağlantısı ve panel mantığı
- `database.rules.json` — Realtime Database güvenlik kuralları

Panel ES modülü kullanır. Bu yüzden dosyayı çift tıklayarak (`file://`)
değil, bir web sunucusu üzerinden (GitHub Pages, Firebase Hosting vb.) açın.

## Veri yapısı (Realtime Database)

```
/admins/{uid}            true  → tüm okulları yönetir (konsoldan elle eklenir)
/members/{uid}           { school }  → hesabın bağlı olduğu okul
/schools/{kod}           { name, contact, email, status, owner, created }
/boards/{kod}/{id}       { name, sub, created }
/state/{kod}/{id}        { online, locked, last, method, ts }  → tahta yazar
/cmd/{kod}/{id}          { action: lock|unlock|shutdown, ts, by } → panel yazar
/notices/{kod}/{id}      { title, desc, target, ts }
/keys/{kod}/{id}         { name, code, active, created }
/schedule/{kod}          { open, close, days }
```

`status`: `pending` (onay bekliyor), `active`, `inactive`.
Bir okul hesabı yalnızca kendi okulu `active` iken o okulun verilerine erişir.

## Kota

Spark planında Realtime Database işlem sayısını değil, bant genişliğini
(ayda 10 GB) ve eşzamanlı bağlantıyı (100) sınırlar. Panel bu yüzden okul
verilerini sayfa açılınca bir kez okur. Yalnızca `state` ve `cmd` dalları
canlı dinlenir. Her açık tahta ve her açık panel bir bağlantı sayılır.

## Kurulum

1. Realtime Database → Rules sekmesine `database.rules.json` içeriğini
   yapıştırıp yayınlayın.
2. Authentication → Users ekranından admin hesabının UID'sini kopyalayın.
   Realtime Database → Data ekranında `admins/<UID>` = `true` kaydını ekleyin.
3. Authentication → Settings → Authorized domains listesine panelin
   yayınlandığı alan adını ekleyin (örn. `karadenizmehmet-debug.github.io`).
4. Okullar giriş ekranındaki "Okul başvurusu" sekmesinden kayıt olur,
   admin Kurumlar ekranından onaylar.
