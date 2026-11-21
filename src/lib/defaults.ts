import type { Settings, Template, DayHours } from './types';

const day = (enabled: boolean, start = '09:00', end = '18:00'): DayHours => ({
  enabled,
  start,
  end,
  breaks: enabled ? [{ start: '12:30', end: '13:30', label: 'Öğle arası' }] : [],
});

export function defaultSettings(now: string): Settings {
  return {
    id: 'main',
    createdAt: now,
    updatedAt: now,
    therapistName: 'Ezgi',
    officeName: 'Dil ve Konuşma Terapisi Ofisi',
    currency: 'TRY',
    defaultDuration: 45,
    defaultFee: 0,
    slotStep: 15,
    workingHours: {
      '1': day(true),
      '2': day(true),
      '3': day(true),
      '4': day(true),
      '5': day(true),
      '6': day(true, '10:00', '15:00'),
      '7': day(false),
    },
    specialDays: [],
    paymentMethods: ['Nakit', 'Havale / EFT', 'Kredi kartı', 'Diğer'],
    incomeCategories: ['Bireysel seans', 'Paket satışı', 'Diğer gelir'],
    expenseCategories: ['Kira', 'Faturalar', 'Ekipman', 'Ofis malzemeleri', 'Eğitim', 'Ulaşım', 'Yazılım', 'Vergi ve harçlar', 'Diğer giderler'],
    sessionTypes: ['Bireysel terapi', 'Değerlendirme', 'Aile görüşmesi', 'Online seans'],
    serviceCategories: [
      'Dil gelişimi',
      'Konuşma sesi bozuklukları',
      'Kekemelik / akıcılık',
      'Ses bozuklukları',
      'Otizm spektrum bozukluğu',
      'Yutma bozuklukları',
      'Afazi / nörojenik',
      'Diğer',
    ],
    cancellationPolicy: { chargeByDefault: false, freeHours: 24, percent: 100, packageCreditByDefault: 'return' },
    noShowPolicy: { charge: true, percent: 100, usePackageCredit: true },
    packagePolicy: { defaultValidityDays: 60, warnDaysBefore: 7, warnRemaining: 2 },
    statusColors: {
      planned: '#b27d80',
      completed: '#7c9583',
      cancelled: '#b36a5d',
      noshow: '#b98f52',
      postponed: '#8f7b93',
    },
    theme: 'system',
    language: 'tr',
    autoLockMinutes: 10,
    backup: { intervalHours: 6, keep: 10, exportReminderDays: 7 },
    welcomeCardHidden: false,
    onboardingDone: false,
    notifyUpcoming: true,
  };
}

export const TEMPLATE_DEFAULTS: Omit<Template, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    key: 'confirm',
    title: 'Randevu onayı',
    body: 'Merhaba {danisan}, {tarih} {saat} tarihli randevunuz oluşturulmuştur. Görüşmek üzere.\n{terapist}',
  },
  {
    key: 'reminder',
    title: 'Randevu hatırlatma',
    body: 'Merhaba {danisan}, {tarih} {saat} randevunuzu hatırlatmak isterim. Bir değişiklik olursa lütfen haber veriniz.\n{terapist}',
  },
  {
    key: 'change',
    title: 'Randevu değişikliği',
    body: 'Merhaba {danisan}, randevunuz {tarih} {saat} olarak güncellenmiştir. Uygun değilse lütfen bana yazınız.\n{terapist}',
  },
  {
    key: 'cancel',
    title: 'İptal bildirimi',
    body: 'Merhaba {danisan}, {tarih} {saat} tarihli randevunuz iptal edilmiştir. Yeni bir randevu planlamak için bana yazabilirsiniz.\n{terapist}',
  },
  {
    key: 'payment',
    title: 'Ödeme hatırlatma',
    body: 'Merhaba {danisan}, güncel bakiyeniz {bakiye} olarak görünmektedir. Uygun olduğunuzda ödemenizi rica ederim. Teşekkürler.\n{terapist}',
  },
  {
    key: 'package',
    title: 'Paket yenileme',
    body: 'Merhaba {danisan}, mevcut paketinizde {kalan} seans kalmıştır. Yeni paket planlamak isterseniz bana yazabilirsiniz.\n{terapist}',
  },
  {
    key: 'first',
    title: 'İlk randevu bilgilendirmesi',
    body: 'Merhaba {danisan}, ilk görüşmemiz {tarih} {saat} tarihinde. Ofis adresi ve gerekli bilgileri ayrıca paylaşacağım. Varsa önceki raporları getirmeniz faydalı olur.\n{terapist}',
  },
  {
    key: 'followup',
    title: 'Takip mesajı',
    body: 'Merhaba {danisan}, son görüşmemizin ardından nasıl gittiğini merak ettim. Sorunuz olursa bana yazabilirsiniz.\n{terapist}',
  },
];

export const SESSION_STATUS_LABEL = {
  planned: 'Planlandı',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
  noshow: 'Gelmedi',
  postponed: 'Ertelendi',
} as const;

export const PRIORITY_LABEL = { low: 'Düşük', normal: 'Normal', high: 'Yüksek' } as const;
export const TASK_STATUS_LABEL = { todo: 'Yapılacak', doing: 'Devam Ediyor', done: 'Tamamlandı' } as const;
export const NOTE_KIND_LABEL = { quick: 'Hızlı not', office: 'Ofis hatırlatması', admin: 'İdari not', client: 'Danışan notu' } as const;
export const PREFERRED_TIME_LABEL = { any: 'Farketmez', morning: 'Sabah (09–12)', noon: 'Öğleden sonra (12–16)', evening: 'Akşam (16+)' } as const;
export const WAITING_STATUS_LABEL = { waiting: 'Bekliyor', contacted: 'İletişime geçildi', scheduled: 'Randevu verildi', cancelled: 'Vazgeçti' } as const;
export const REMINDER_LABEL: Record<string, string> = {
  none: 'Hatırlatma yok',
  '2h': '2 saat önce',
  '1d': '1 gün önce',
  '2d': '2 gün önce',
};
export const BLOCK_KIND_LABEL = { holiday: 'Tatil', personal: 'Kişisel zaman', unavailable: 'Müsait değil' } as const;
