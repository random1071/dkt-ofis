import { useState, useSyncExternalStore } from 'react';
import { Download, Laptop, PlayCircle, Smartphone, Sparkles, Share, PlusSquare, MoreVertical, ShieldCheck, BookOpen, CircleHelp, AlertTriangle } from 'lucide-react';
import { startTour, type TourStep } from '../components/Tour';
import { Tabs } from '../components/ui';
import { canInstall, promptInstall, subscribeInstall } from '../lib/install';

function useInstall() {
  return useSyncExternalStore(subscribeInstall, canInstall);
}

const TUTORIALS: { title: string; steps: string[]; tour?: TourStep[] }[] = [
  {
    title: 'Danışan eklemek',
    steps: ['Danışanlar ekranında "Yeni danışan"a (veya + Yeni → Danışan) dokunun.', 'Ad soyad yazın (zorunlu). Telefonu ekleyin; WhatsApp mesajları bu numaraya hazırlanır.', 'Anlaşılan seans ücretini ve ödeme düzenini (seans başı / paket) seçin.', 'Gerekirse "+ Veli, acil durum…" ile ek bilgileri açın.', '"Kaydet"e basın. "Danışan eklendi" mesajını görürsünüz.'],
    tour: [{ route: '/danisanlar', target: '[data-tour="add-client"]', title: 'Yeni danışan', body: 'Bu düğmeyle danışan formunu açın. Ad soyad zorunlu, diğer alanlar isteğe bağlıdır.' }],
  },
  {
    title: 'Randevu oluşturmak',
    steps: ['Takvimde boş bir saate dokunun ya da "Yeni randevu"yu kullanın.', 'Danışanı seçin; ücret ve süre danışan kaydından otomatik gelir.', 'Önerilen boş saatlerden birine dokunun veya saati elle yazın.', 'Çakışma varsa sarı uyarı görünür. Dış kurum saatine randevu verilemez.', '"Randevu oluştur"a basın.'],
    tour: [{ route: '/takvim', target: ['[data-tour="cal-new"]', '.cal-grid-wrap'], title: 'Randevu', body: 'Boş bir saate dokunun veya bu düğmeyi kullanın.' }],
  },
  {
    title: 'Tekrarlayan randevu oluşturmak',
    steps: ['Yeni randevu formunda "Tekrar" bölümünden "Her hafta", "2 haftada bir", "Her ay" veya "Özel"i seçin.', 'Haftada birden fazla gün için günleri işaretleyin (örn. Pzt + Per).', 'Bitiş: "Bitiş yok", belirli bir tarih ya da toplam seans sayısı.', 'Önizleme kaç randevu oluşacağını ve çakışmaları gösterir.', 'Bitişsiz serilerde takvim, uygulama açıldıkça otomatik olarak ileriye uzar.'],
  },
  {
    title: 'Randevuyu taşımak / ertelemek',
    steps: ['Randevuya dokunun → "Taşı / Ertele".', '"Taşı": aynı randevu yeni zamana alınır; eski zaman geçmişte saklanır.', '"Ertele": eski randevu "Ertelendi" olur, yeni zamanda bağlantılı yeni randevu açılır.', '"Tarih sonra": yalnızca "Ertelendi" olarak işaretlenir.', 'Bilgisayarda randevuyu takvimde sürükleyerek de taşıyabilirsiniz.', 'Tekrarlayan bir randevuda saat değişikliği için "Düzenle" → "Bu ve sonrakiler" veya "Tüm seri".'],
  },
  {
    title: 'Randevuyu iptal etmek',
    steps: ['Randevuya dokunun → "İptal et".', 'Ücretlendirilip ücretlendirilmeyeceğini seçin (geç iptal politikası önerilir).', 'Paketli danışanda seansın pakette kalmasını veya düşülmesini seçin.', 'İsterseniz neden yazın. Ardından iptal mesajını WhatsApp\'ta hazırlayabilirsiniz.', 'İptal geçmişi randevuda saklanır.'],
  },
  {
    title: 'Seansı tamamlandı olarak işaretlemek',
    steps: ['Bugün ekranında veya randevu detayında "Tamamlandı"ya basın.', 'Bireysel seansta ücret görünür; ödemeyi o an aldıysanız "Ödemeyi şimdi aldım"ı işaretleyin.', 'Paketli seansta paketten 1 seans düşülür; ayrıca gelir yazılmaz.', 'İsterseniz kısa bir idari not ekleyin.', 'Tamamlanan seans, ödeme alınmadıkça "Ödenmedi" görünür.'],
    tour: [{ route: '/bugun', target: '[data-testid="day-close"]', title: 'Bugün', body: 'Günün randevuları solda; her birinin altında "Tamamlandı", "Gelmedi", "İptal" düğmeleri bulunur.' }],
  },
  {
    title: 'Ödeme kaydetmek (kısmi ödemeler dahil)',
    steps: ['Ödemeler → "Ödeme kaydet" (veya danışan profilinde "Ödeme").', 'Danışanı seçin; güncel borç gösterilir.', 'Alınan tutarı yazın. Tutar en eski borçtan başlayarak otomatik dağıtılır; isterseniz "Elle ayarla".', 'Tutar borçtan azsa kalan kısım "Kısmi ödendi" olur; fazlası avans olarak saklanır ve sonraki seanslardan düşülür.', 'Yanlış kayıtta "Düzelt" (neden yazılır) veya "Geçersiz say" kullanın; kayıtlar silinmez.'],
    tour: [{ route: '/odemeler', target: '[data-tour="add-payment"]', title: 'Ödeme', body: 'Bu düğmeyle ödeme kaydedin. Açık alacaklar sekmesinde ödenmemiş kalemleri görürsünüz.' }],
  },
  {
    title: 'Gider kaydetmek',
    steps: ['Gelir-Gider → "Gider ekle" (veya + Yeni → Gider).', 'Açıklama, tutar, tarih ve kategoriyi girin.', 'Kira gibi aylık giderler için "Her ay tekrarlansın"ı işaretleyin.', 'Düzeltmelerde neden yazın; önceki değer geçmişte saklanır.'],
  },
  {
    title: 'Paket oluşturmak',
    steps: ['Paketler → "Yeni paket" (veya danışan profilinde "Paket oluştur").', '4, 8, 10 seans ya da özel seçin; fiyat danışan ücretine göre önerilir.', 'Satın alma, başlangıç ve son kullanma tarihlerini kontrol edin.', 'Ödemeyi aldıysanız "Paket ödemesini şimdi aldım"ı işaretleyin. Paket satışı gelire bir kez yazılır.'],
  },
  {
    title: 'Paket kredilerini kullanmak',
    steps: ['Randevu oluştururken "Ödeme şekli: Paket" ve paketi seçin.', 'Seans tamamlandığında paketten otomatik 1 seans düşülür.', 'Bireysel tamamlanmış bir seansı sonradan pakete bağlamak için randevu detayında "Pakete bağla".', 'Hediye seans veya düzeltme için paket detayında +/− düğmeleri (neden zorunludur).', '2 seans kaldığında ve bitiş tarihi yaklaştığında Genel Bakış\'ta uyarı görürsünüz.'],
  },
  {
    title: 'Ödenmemiş bakiyeleri yönetmek',
    steps: ['Ödemeler → "Açık alacaklar" sekmesi tüm ödenmemiş kalemleri gösterir.', '7 günden eski kalemler "Gecikmiş" olarak işaretlenir.', 'Mesaj simgesiyle ödeme hatırlatma mesajı hazırlayın (otomatik gönderilmez).', '"Ödeme al" ile doğrudan o kalemi kapatın.'],
  },
  {
    title: 'Görev oluşturmak',
    steps: ['Görevler → "Yeni görev" (veya + Yeni → Görev).', 'Başlık, son tarih ve öncelik belirleyin; isterseniz danışan bağlayın.', 'Bugün / Yaklaşan / Gecikmiş sekmeleriyle takip edin; daireye dokunarak tamamlayın.'],
  },
  {
    title: 'Yedek almak ve geri yüklemek',
    steps: ['Yedekleme → "Yedek dosyasını indir". Dosya şifrelenir: şifreli kullanımda uygulama şifrenizle, şifresiz kullanımda o an belirlediğiniz yedek şifresiyle.', 'Dosyayı cihaz dışına (USB, Google Drive, iCloud, e-posta) kaydedin.', 'Geri yüklemek için Yedekleme → "Yedek dosyası seç" → şifre → önizleme → "Geri yükle".', 'Geri yüklemeden önce mevcut verilerin güvenlik yedeği otomatik alınır.', 'Uygulama ayrıca cihaz içinde otomatik yedekler tutar.'],
    tour: [{ route: '/yedekleme', target: '[data-testid="export-backup"]', title: 'Yedek', body: 'Haftada bir bu düğmeyle yedek alıp dosyayı cihaz dışına kaydedin.' }],
  },
  {
    title: 'Uygulamayı telefona yüklemek',
    steps: ['iPhone: Safari\'de adresi açın → Paylaş → "Ana Ekrana Ekle" → "Web Uygulaması olarak aç" açık → Ekle.', 'Android: Chrome\'da adresi açın → ⋮ menü → "Uygulamayı yükle" / "Ana ekrana ekle".', 'Ana ekrandaki "DKT Ofis" simgesinden açın; internet olmadan da çalışır.', 'Telefondaki kayıtlar bilgisayardakinden ayrıdır; aktarım için yedek dosyası kullanılır.'],
  },
  {
    title: 'Çalışma saatlerini ayarlamak',
    steps: ['Ayarlar → "Çalışma saatleri ve müsaitlik". Varsayılan düzen haftanın 7 günü 07.00–21.00.', 'Her günün başlangıç ve bitiş saatini ayrı ayrı değiştirin; günün kutusunu kaldırırsanız o gün kapalı olur.', '"Tüm açık günlere uygula" bir günün saatini diğer açık günlere kopyalar; "Haftanın 7 günü 07:00–21:00" standart düzeni geri getirir.', '"Çalışma saatlerini kaydet"e basın. Boş saat önerileri, çakışma uyarıları ve tekrarlayan randevular bu saatlere göre çalışır; kayıtlı randevular değişmez.'],
  },
  {
    title: 'Seans notu yazmak',
    steps: ['Bugün ekranında randevudaki "Seans notu" düğmesine, randevu ayrıntısındaki "Seans notu yaz"a veya danışan dosyasında Seans Notları → "Yeni seans notu"na dokunun.', 'Şablon seçin: Serbest not, SOAP (Subjektif, Objektif, Değerlendirme, Plan) veya Kısa seans notu. Kendi şablonlarınızı Not ve Form Şablonları ekranında hazırlarsınız.', 'Yazdıkça not birkaç saniyede bir şifreli olarak "taslak" kaydedilir; pencereyi kapatıp sonra devam edebilirsiniz.', 'Bitince "Notu tamamla". Sonradan düzenlerseniz önceki hâl "Sürümler"de saklanır ve geri dönebilirsiniz.', 'Silinen notlar danışan dosyasında Seans Notları → "Silinenler"de durur; oradan geri alabilirsiniz.'],
  },
  {
    title: 'Konuşarak not yazmak',
    steps: ['Seans notu penceresinde "Konuşarak yaz"a dokunun. Konuştuklarınız imlecin olduğu yere eklenir; mevcut metin silinmez.', '"virgül", "nokta", "soru işareti", "yeni satır" diyerek noktalama ekleyebilirsiniz.', 'Cihaz konuşmayı kendisi işleyemiyorsa ses metne çevrilmek üzere Apple / Google / Microsoft\'a gidebilir; ilk kullanımda bu açıkça sorulur. Danışan adı ve tanı söylemeyin.', 'Uygulama ses kaydı saklamaz. Metni okuyup düzeltin, sonra kaydedin.', 'Mikrofon düğmesi yoksa telefon klavyesindeki mikrofon (dikte) tuşunu kullanabilirsiniz.'],
  },
  {
    title: 'Hedef (BEP) ve gelişim takibi',
    steps: ['Danışan dosyası → Hedefler (BEP) → "Uzun vadeli amaç".', 'Amacın altına "Bu amaca hedef ekle" ile kısa vadeli hedef ve ölçüt (örn. 10 denemede 8) yazın.', 'Ölçüm: hedefteki "Ölçüm" düğmesi veya seans notundaki "Bu seansta çalışılan hedefler" bölümü. Doğru ve toplam deneme girince yüzde hesaplanır.', '"Gelişim" düğmesi grafiği ve tüm ölçümleri gösterir.', 'Durumu "Devam ediyor", "Beklemede" veya "Tamamlandı" yapın. İçerik tamamen sizin mesleki değerlendirmenizdir; uygulama terapi önerisi sunmaz.'],
  },
  {
    title: 'Ev çalışması vermek',
    steps: ['Danışan dosyası → Ev Çalışmaları → "Ev çalışması".', 'Başlık, açıklama, son tarih ve isterseniz ilgili hedefi seçin.', 'Sonraki seansta "Tamamlandı" veya "Tamamlanmadı" olarak işaretleyin.', 'Geçmişi görmek için "Tümü (geçmiş dahil)".'],
  },
  {
    title: 'PDF rapor almak',
    steps: ['Tek seans: seans notu penceresinde "PDF".', 'Tüm seans notları: danışan dosyası → Seans Notları → "PDF". Hedef raporu: Hedefler (BEP) → "PDF". Tam dosya: danışan menüsü (⋯) → "Danışan dosyası (PDF)".', 'Gelir-gider: Raporlar → "Gelir-gider PDF".', 'Açılan sayfada isterseniz tarih aralığı seçin, "PDF olarak kaydet / yazdır"a basın ve yazdırma penceresinde "PDF olarak kaydet"i seçin.', 'PDF şifresizdir; güvenli saklayın.'],
  },
  {
    title: 'Belge ve fotoğraf eklemek',
    steps: ['Danışan dosyası → Belgeler → "Dosya ekle".', 'Fotoğraf, PDF veya belge seçin (dosya başına en fazla 10 MB).', 'Dosyalar bu cihazda şifreli saklanır ve yedek dosyasına dahil edilir (cihaz içi otomatik yedeklere dahil edilmez).', 'Görüntülemek veya indirmek için dosyanın yanındaki düğmeye dokunun.'],
  },
  {
    title: 'Bildirimler ve takvime ekleme',
    steps: ['Ayarlar → Bildirimler → "Yaklaşan randevular için bildirim göster".', 'Ne zaman hatırlatılacağını seçin (örn. 1 gün önce, 2 saat önce) ve "Cihaz bildirimlerine izin ver"e dokunun.', 'Bildirimler uygulama açıkken gelir. Uygulama kapalıyken hatırlatma için "Önümüzdeki 60 günü telefon takvimine aktar" veya randevudaki "Telefon takvimine ekle"yi kullanın.', 'Takvim kayıtlarında ve bildirimlerde varsayılan olarak danışan adı yazmaz.', 'Bu bildirimler yalnızca size gelir; danışana mesaj gönderilmez.'],
  },
  {
    title: 'Dış kurum çalışma saatleri (isteğe bağlı)',
    steps: ['Takvim → ⋯ → "Dış kurum çalışma saati ekle" (veya Ayarlar → Dış kurum).', 'Kurum adını, günleri (birden fazla) ve saat aralığını girin; başlangıç/bitiş tarihini belirleyin.', 'Bu saatler takvimde çizgili mavi bant olarak görünür ve ofise randevu verilmesi engellenir.', 'Bir gün gitmeyecekseniz randevu verirken "Bu tarihte gitmiyorum" diyebilirsiniz.', 'Düzeni geçici kapatabilir, düzenleyebilir veya silebilirsiniz. Finans ve danışan kayıtlarına dahil edilmez.'],
  },
];

const FAQ: [string, React.ReactNode][] = [
  ['Kayıtlarım nerede saklanıyor?', <>Tüm kayıtlarınız yalnızca kullandığınız cihazın tarayıcı veritabanında (IndexedDB) AES-256 ile şifreli olarak saklanır (şifre korumasını kapatsanız da kayıtlar şifreli kalır). Hiçbir sunucuya, buluta veya yapay zekâ servisine gönderilmez.</>],
  ['Uygulamayı kapatırsam ne olur?', <>Hiçbir şey kaybolmaz. Her işlem kaydedildiği anda veritabanına yazılır ("kaydedildi" bildirimi bunu gösterir). Tekrar açtığınızda (şifre koruması açıksa şifrenizi girip) kaldığınız yerden devam edersiniz.</>],
  ['Verilerimi başka bir telefona nasıl taşırım?', <>Eski cihazda Yedekleme → "Yedek dosyasını indir". Dosyayı yeni cihaza gönderin (AirDrop, e-posta, WhatsApp, Drive). Yeni cihazda uygulamayı açıp kurulumu yapın, önce yeni cihazda da bir yedek alın, sonra Yedekleme → "Yedek dosyası seç" → yedeğin şifresi → "Tamamen değiştir". Dikkat: "Tamamen değiştir" yeni cihazdaki mevcut kayıtların yerine yedeği koyar.</>],
  ['Nasıl yedek alırım?', <>Yedekleme ekranında "Yedek dosyasını indir". Uygulama ayrıca cihaz içinde otomatik yedek tutar, ancak cihaz kaybına karşı dosyayı cihaz dışında saklamanız gerekir. Bilgisayarda Chrome/Edge ile bir klasör seçerseniz yedekler oraya otomatik yazılır.</>],
  ['Yedeği nasıl geri yüklerim?', <>Yedekleme → "Yedek dosyası seç" → dosyayı oluşturduğunuz andaki uygulama şifresi, kurtarma kodu veya yedek şifresi → içerik önizlemesi → "Geri yükle". İşlemden önce mevcut veriler otomatik olarak yedeklenir.</>],
  ['Kayıtlarım neden diğer cihazımda otomatik görünmüyor?', <>Uygulama ücretsiz ve tamamen yerel çalışır; ücretli bir bulut sunucusu kullanmadığı için cihazlar arasında <b>otomatik eşitleme yoktur</b>. Her cihaz kendi kayıtlarını tutar. Aktarmak için yedek dosyasını kullanın. Önerimiz: tek bir ana cihaz kullanmak.</>],
  ['Randevuyu nasıl değiştiririm?', <>Randevuya dokunun → "Düzenle" (saat, süre, ücret, danışan) veya "Taşı / Ertele". Bilgisayarda randevuyu takvimde sürükleyebilirsiniz. Tekrarlayan randevularda "Sadece bu", "Bu ve sonrakiler" veya "Tüm seri" seçilebilir.</>],
  ['Kısmi ödemeyi nasıl kaydederim?', <>Ödeme kaydet ekranında alınan tutarı yazmanız yeterli. Seans "Kısmi ödendi" görünür; kalan kısım açık alacaklarda listelenir. Kalan ödeme geldiğinde tekrar "Ödeme kaydet".</>],
  ['Paketler nasıl çalışır?', <>Paket satıldığında fiyat bir kez gelir sayılır. Pakete bağlı her tamamlanan seansta paketten 1 seans düşülür; ikinci kez gelir yazılmaz. İptal/gelmeme durumunda düşülüp düşülmeyeceğini siz seçersiniz. Şu an seans başı ödeme kullanıyorsanız paketleri kullanmanız gerekmez.</>],
  ['Şifremi unutursam ne olur?', <>Kilit ekranında "Şifremi unuttum" → kurulumda verilen kurtarma kodu → yeni şifre. Kurtarma kodu da yoksa şifreli kayıtlara ulaşılamaz; bu yüzden kodu güvenli yerde saklayın.</>],
  ['Şifre zorunlu mu?', <>Hayır. Kurulumda "Şifresiz devam et" seçebilir, şifre korumasını sonradan Ayarlar → Güvenlik'ten açıp kapatabilirsiniz; kayıtlarınız silinmez. Şifresiz kullanımda kayıtlar cihazda yine şifreli saklanır, ancak uygulama şifre sormadan açılır: cihazın kilidi açıkken eline alan herkes kayıtları görebilir. Danışan bilgileri için şifre korumasını öneririz.</>],
  ['İnternet olmadan çalışır mı?', <>Evet. Uygulama bir kez açılıp yüklendikten sonra internet olmadan açılır ve tüm kayıtlarınızla çalışır. WhatsApp mesajı göndermek için internet gerekir.</>],
  ['Seans notlarım güvende mi?', <>Seans notları, hedefler, ev çalışmaları, formlar ve belgeler diğer kayıtlar gibi bu cihazda AES-256 ile şifreli saklanır ve yedek dosyasına dahil edilir. Hiçbir yapay zekâ servisine veya sunucuya gönderilmez. PDF ve CSV dışa aktarımları şifresizdir.</>],
  ['Uygulama kapalıyken bildirim gelir mi?', <>Hayır. Bildirimler uygulama açıkken gösterilir. Uygulama kapalıyken hatırlatma için randevuları telefonun takvimine aktarın (Ayarlar → Bildirimler); takvim uygulaması alarm verir. Kapalıyken bildirim için ayrı bir sunucu gerekir; şu an kurulmadı.</>],
  ['Mesajlar otomatik gönderiliyor mu?', <>Hayır. Uygulama hiçbir mesajı kendiliğinden göndermez. "WhatsApp'ta aç" mesajı hazırlar; göndermek için WhatsApp'ta gönder tuşuna sizin basmanız gerekir.</>],
  ['Ücretli bir şey var mı?', <>Hayır. Uygulama abonelik, deneme süresi veya ücretli servis kullanmaz. Uygulama ücretsiz Cloudflare Workers üzerinde yalnızca statik dosya olarak yayınlanır; kayıtlarınız oraya gönderilmez.</>],
];

export function HelpPage() {
  const [tab, setTab] = useState<'start' | 'computer' | 'iphone' | 'android' | 'guides' | 'faq' | 'limits'>('start');
  const installable = useInstall();
  return (
    <div>
      <div className="page-head"><div><h2>DKT Ofis Yardım Merkezi</h2><p>Uygulamayı adım adım öğrenin</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'start', label: 'Başlangıç' },
        { id: 'computer', label: 'Bilgisayar' },
        { id: 'iphone', label: 'iPhone' },
        { id: 'android', label: 'Android' },
        { id: 'guides', label: 'Adım adım' },
        { id: 'faq', label: 'Sık sorulanlar' },
        { id: 'limits', label: 'Sınırlamalar' },
      ]} />

      {tab === 'start' && (
        <div className="col gap-4">
          <div className="card welcome-card card-pad row wrap gap-4">
            <Sparkles style={{ width: 24, height: 24, color: 'var(--accent-strong)' }} />
            <div className="grow"><div className="strong">Başlangıç rehberi</div><div className="small muted">Ekran üzerinde işaretleyerek ana bölümleri 2 dakikada gösterir.</div></div>
            <button className="btn primary" onClick={() => startTour()} data-testid="help-start-tour"><PlayCircle /> Rehberi başlat</button>
          </div>
          <div className="card card-pad row wrap gap-4" data-testid="guide-pdf-card">
            <BookOpen style={{ width: 22, height: 22, color: 'var(--accent)' }} />
            <div className="grow" style={{ minWidth: 200 }}><div className="strong">Kısa kullanım kılavuzu (PDF)</div><div className="small muted">Tüm özellikler 2 sayfada, ekran görüntüleriyle. Yazdırabilir veya paylaşabilirsiniz. İnternet bağlantısı gerekir.</div></div>
            <a className="btn" href="./kullanim-kilavuzu.pdf" target="_blank" rel="noopener" data-testid="guide-pdf-link"><Download /> Kılavuzu aç</a>
          </div>
          {installable && (
            <div className="card card-pad row wrap gap-4">
              <Download style={{ width: 22, height: 22, color: 'var(--accent)' }} />
              <div className="grow"><div className="strong">Bu cihaza yükle</div><div className="small muted">Uygulamayı kendi simgesi ve penceresiyle açmak için yükleyin.</div></div>
              <button className="btn" onClick={promptInstall}>Yükle</button>
            </div>
          )}
          <div className="grid-3">
            {[
              ['1. Danışan ekle', 'Danışanlar → Yeni danışan. Ad ve telefon yeterli.'],
              ['2. Randevu oluştur', 'Takvimde boş saate dokun. Tekrarlayan randevu seçebilirsin.'],
              ['3. Seansı tamamla', 'Bugün ekranında "Tamamlandı"; ödemeyi aynı anda işaretle.'],
              ['4. Ödemeleri takip et', 'Açık alacaklar ve kısmi ödemeler Ödemeler ekranında.'],
              ['5. Yedek al', 'Haftada bir yedek dosyasını cihaz dışına kaydet.'],
              ['6. Raporlara bak', 'Aylık gelir, gider, katılım ve iptal oranları.'],
            ].map(([t, d]) => <div key={t} className="card card-pad"><div className="strong mb-2">{t}</div><div className="small muted">{d}</div></div>)}
          </div>
          <div className="card card-pad small muted" style={{ lineHeight: 1.6 }}>
            <b className="strong" style={{ color: 'var(--text)' }}>Klavye kısayolları (bilgisayar):</b> <kbd>Ctrl</kbd> + <kbd>K</kbd> veya <kbd>/</kbd> arama · <kbd>N</kbd> yeni randevu · <kbd>Esc</kbd> pencereyi kapat.
          </div>
        </div>
      )}

      {tab === 'computer' && (
        <div className="card card-pad help-article">
          <h3><Laptop style={{ display: 'inline', width: 20, height: 20, verticalAlign: -3 }} /> Bilgisayarda kullanım (Windows / macOS)</h3>
          <ol>
            <li><b>Uygulamayı açın:</b> Chrome, Edge veya Safari'de uygulama adresini açın (adres size ayrıca iletildi; yer imlerine ekleyin).</li>
            <li><b>Chrome'da yükleme:</b> adres çubuğunun sağındaki <b>yükle</b> simgesine (ekran ve aşağı ok) tıklayın → "Yükle". Simge yoksa ⋮ menü → "Kaydet ve paylaş" → "Uygulamayı yükle".</li>
            <li><b>Edge'de yükleme:</b> ⋯ menü → "Uygulamalar" → "Bu siteyi uygulama olarak yükle" → "Yükle".</li>
            <li><b>Yükleme seçeneği yoksa (ör. Safari / Firefox):</b> sayfayı yer imlerine ekleyin; macOS Safari'de Dosya → "Dock'a Ekle" seçeneği de kullanılabilir.</li>
            <li><b>Açmak:</b> yüklendikten sonra Başlat menüsü (Windows), Launchpad/Dock (macOS) veya masaüstündeki <b>DKT Ofis</b> simgesinden açın. Kendi penceresinde çalışır.</li>
            <li><b>Kilidi açmak (şifre koruması açıksa):</b> şifrenizi girip "Kilidi aç". Belirlediğiniz süre işlem yapılmazsa otomatik kilitlenir; sol alttaki "Kilitle" ile elle kilitleyebilirsiniz.</li>
            <li><b>Sol menü:</b> Genel Bakış, Bugün, Takvim; Ofis (Danışanlar, Seanslar, Bekleme Listesi); Finans (Ödemeler, Paketler, Gelir-Gider, Raporlar); Düzen; Sistem.</li>
            <li><b>Takvim:</b> Gün / Hafta / Ay / Ajanda görünümleri. Boş saate tıklayın → yeni randevu. Randevuyu sürükleyerek taşıyın.</li>
            <li><b>Danışan:</b> Danışanlar → Yeni danışan; profilde ⋯ → "Bilgileri düzenle".</li>
            <li><b>Randevu:</b> "Yeni randevu" veya <kbd>N</kbd>; değiştirmek için randevuya tıklayın.</li>
            <li><b>Ödeme ve gider:</b> sağ üstteki "+ Yeni" menüsünden.</li>
            <li><b>Paketler:</b> Paketler → Yeni paket; randevuda "Ödeme şekli: Paket".</li>
            <li><b>Yedek:</b> Yedekleme → "Yedek dosyasını indir" ya da otomatik yedek için bir klasör seçin.</li>
            <li><b>Geri yükleme:</b> Yedekleme → "Yedek dosyası seç".</li>
          </ol>
        </div>
      )}

      {tab === 'iphone' && (
        <div className="card card-pad help-article">
          <h3><Smartphone style={{ display: 'inline', width: 20, height: 20, verticalAlign: -3 }} /> iPhone'a yükleme</h3>
          <div className="row top wrap gap-6">
            <ol className="grow" style={{ minWidth: 260 }}>
              <li>Uygulama adresini <b>Safari</b>'de açın (iPhone'da yükleme yalnızca Safari'den yapılabilir; iOS 16.4+ ile Chrome'daki Paylaş menüsünden de mümkündür).</li>
              <li>Ekranın altındaki <b>Paylaş</b> simgesine <Share style={{ display: 'inline', width: 16, height: 16, verticalAlign: -3 }} /> dokunun.</li>
              <li>Listeyi aşağı kaydırıp <b>"Ana Ekrana Ekle"</b> <PlusSquare style={{ display: 'inline', width: 16, height: 16, verticalAlign: -3 }} /> seçeneğine dokunun.</li>
              <li>İsmin <b>"DKT Ofis"</b> olduğunu kontrol edin. Ekranda <b>"Web Uygulaması olarak aç"</b> anahtarı varsa <b>açık</b> olsun.</li>
              <li>Sağ üstteki <b>Ekle</b>'ye dokunun.</li>
              <li>Ana ekranda beliren DKT Ofis simgesinden açın. Doğru kurulduysa üstte Safari adres çubuğu, altta Safari araç çubuğu <b>görünmez</b>; uygulama kendi penceresinde açılır.</li>
              <li><b>Mobil menü:</b> alttaki çubuk — Genel, Takvim, ortadaki <b>+</b> (hızlı ekle), Danışanlar ve Menü (diğer tüm bölümler).</li>
              <li><b>Randevu:</b> Takvim → güne dokun → boş saate dokun. Değiştirmek için randevuya dokunun → Düzenle veya Taşı / Ertele.</li>
              <li><b>Ödeme:</b> + → Ödeme veya Bugün ekranında "Ödeme al".</li>
              <li><b>Yedek:</b> Menü → Yedekleme → "Paylaş / Dosyalar'a kaydet" ile iCloud Drive'a kaydedin. Geri yüklemek için "Yedek dosyası seç".</li>
            </ol>
            <IphoneIllustration />
          </div>
          <div className="callout info mt-4"><CircleHelp /><div className="callout-body small">iPhone'da Safari'de ve ana ekrana eklenen uygulamada kayıtlar ayrı tutulabilir. Uygulamayı yükledikten sonra kurulumu ana ekrandaki simgeden yapın ve her zaman oradan açın. Apple, uzun süre (haftalarca) açılmayan web sitelerinin verilerini temizleyebilir; ana ekrana eklenen uygulamalar bundan korunur. Yine de düzenli yedek alın.</div></div>
          <div className="callout warn mt-3"><CircleHelp /><div className="callout-body small"><b>Simge Safari çubuklarıyla açılıyorsa:</b> ana ekrandaki eski simgeyi silin (içinde kayıt varsa önce Yedekleme'den yedek alın). Safari'de adresin <b>dkt-ofis.terapiofisi.workers.dev</b> olduğunu kontrol edin, Paylaş → "Ana Ekrana Ekle" adımlarını "Web Uygulaması olarak aç" açık olacak şekilde tekrarlayın.</div></div>
        </div>
      )}

      {tab === 'android' && (
        <div className="card card-pad help-article">
          <h3><Smartphone style={{ display: 'inline', width: 20, height: 20, verticalAlign: -3 }} /> Android'e yükleme</h3>
          <ol>
            <li>Uygulama adresini <b>Chrome</b>'da açın.</li>
            <li>Ekranın altında "Uygulamayı yükle" bildirimi çıkarsa dokunun. Çıkmazsa sağ üstteki <MoreVertical style={{ display: 'inline', width: 16, height: 16, verticalAlign: -3 }} /> menü → <b>"Uygulamayı yükle"</b> veya <b>"Ana ekrana ekle"</b>.</li>
            <li>"Yükle"ye dokunarak onaylayın.</li>
            <li>Ana ekrandaki / uygulama çekmecesindeki <b>DKT Ofis</b> simgesinden açın; kendi penceresinde, adres çubuğu olmadan açılır.</li>
            <li><b>Mobil menü:</b> alttaki çubuk — Genel, Takvim, <b>+</b>, Danışanlar, Menü.</li>
            <li><b>Kayıt yönetimi:</b> her kayda dokunarak açın; düzenleme, arşivleme ve geri alma o ekrandadır.</li>
            <li><b>Yedek:</b> Menü → Yedekleme → "Yedek dosyasını indir" (İndirilenler klasörüne kaydedilir) veya "Paylaş" ile Google Drive'a kaydedin. Geri yüklemek için "Yedek dosyası seç".</li>
          </ol>
        </div>
      )}

      {tab === 'guides' && (
        <div className="card">
          {TUTORIALS.map((t) => (
            <details key={t.title} className="faq">
              <summary><span className="row"><BookOpen style={{ width: 16, height: 16, color: 'var(--accent)' }} /> {t.title}</span></summary>
              <div className="faq-body">
                <ol style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                {t.tour && <button className="btn sm mt-3" onClick={() => startTour(t.tour)}><PlayCircle /> Ekranda göster</button>}
              </div>
            </details>
          ))}
        </div>
      )}

      {tab === 'faq' && (
        <div className="card">
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq">
              <summary>{q}</summary>
              <div className="faq-body">{a}</div>
            </details>
          ))}
        </div>
      )}

      {tab === 'limits' && (
        <div className="card card-pad help-article">
          <h3><ShieldCheck style={{ display: 'inline', width: 20, height: 20, verticalAlign: -3 }} /> Bilmeniz gereken sınırlamalar</h3>
          <ul>
            <li><b>Otomatik cihazlar arası eşitleme yok.</b> Ücretsiz ve gizlilik odaklı olması için veriler sunucuya gönderilmez. Cihazlar arası aktarım yedek dosyasıyla yapılır.</li>
            <li><b>Tarayıcı depolaması tam güvence değildir.</b> Cihaz kaybı, arıza veya tarayıcı verilerinin silinmesi ("geçmişi temizle") kayıtları silebilir. Düzenli yedek dosyası alın.</li>
            <li><b>Şifre ve kurtarma kodu kaybolursa</b> şifreli kayıtlara kimse erişemez.</li>
            <li><b>Şifresiz kullanımda</b> kayıtlar cihazda şifreli kalır, ancak uygulama şifre sormadan açılır; cihazın kilidi açıkken eline alan herkes kayıtları görebilir.</li>
            <li><b>Güvenlik:</b> cihaz içi şifreleme, sunucuda yönetilen profesyonel bir kimlik doğrulama sistemiyle aynı seviyede değildir. Cihazınızı ekran kilidiyle koruyun.</li>
            <li><b>Bildirimler:</b> uygulama kapalıyken telefona hatırlatma bildirimi gönderemez. Hatırlatmalar uygulama açıldığında Genel Bakış'ta görünür.</li>
            <li><b>Mesajlar</b> otomatik gönderilmez; WhatsApp'ta hazırlanır, gönderimi siz yaparsınız.</li>
            <li><b>Klinik kayıt sistemi değildir.</b> İdari kayıt içindir; elektronik sağlık kaydı yazılımının yerini tutmaz.</li>
            <li><b>PDF:</b> raporlar tarayıcının "Yazdır → PDF olarak kaydet" özelliğiyle PDF yapılır.</li>
          </ul>
          <div className="callout warn mt-4"><AlertTriangle /><div className="callout-body small">En önemli alışkanlık: <b>haftada bir yedek dosyası alıp cihaz dışında saklamak.</b></div></div>
        </div>
      )}
    </div>
  );
}

function IphoneIllustration() {
  return (
    <svg viewBox="0 0 140 260" width="140" style={{ flex: 'none' }} aria-label="iPhone Paylaş menüsü çizimi">
      <rect x="4" y="4" width="132" height="252" rx="22" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="2" />
      <rect x="14" y="20" width="112" height="16" rx="8" fill="var(--surface)" />
      <text x="70" y="31" textAnchor="middle" fontSize="7" fill="var(--text-3)">dkt-ofis</text>
      <rect x="14" y="120" width="112" height="100" rx="10" fill="var(--surface)" stroke="var(--border)" />
      <text x="24" y="140" fontSize="8" fill="var(--text-2)">Kopyala</text>
      <line x1="20" y1="148" x2="120" y2="148" stroke="var(--border)" />
      <rect x="18" y="153" width="104" height="18" rx="5" fill="var(--accent-soft)" />
      <text x="24" y="165" fontSize="8" fill="var(--accent-strong)" fontWeight="600">Ana Ekrana Ekle  ⊞</text>
      <line x1="20" y1="176" x2="120" y2="176" stroke="var(--border)" />
      <text x="24" y="190" fontSize="8" fill="var(--text-2)">Yer İmi Ekle</text>
      <rect x="14" y="228" width="112" height="20" rx="6" fill="var(--surface)" />
      <g transform="translate(64 231)" stroke="var(--accent)" strokeWidth="1.6" fill="none" strokeLinecap="round"><path d="M6 2v9M3 5l3-3 3 3" /><path d="M2 8v5h8V8" /></g>
    </svg>
  );
}
