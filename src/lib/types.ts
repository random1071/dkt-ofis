// Veri modelleri — tüm kayıtlar şifreli olarak IndexedDB'de saklanır.
// Tarih/saatler Europe/Istanbul duvar saati olarak "YYYY-MM-DDTHH:mm" biçiminde tutulur.

export type ID = string;

export interface BaseRecord {
  id: ID;
  createdAt: string; // ISO zaman damgası
  updatedAt: string;
  archived?: boolean;
  archivedAt?: string;
}

export interface Revision {
  at: string;
  reason?: string;
  before: Record<string, unknown>;
}

export type BillingMode = 'individual' | 'package';

export interface Client extends BaseRecord {
  name: string;
  phone: string;
  email?: string;
  birthDate?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelation?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  registeredAt: string; // YYYY-MM-DD
  serviceCategory?: string;
  sessionType?: string;
  sessionDuration: number; // dk
  sessionFee: number;
  billingMode: BillingMode;
  frequency?: string;
  notes?: string;
  needsFollowUp?: boolean;
  color?: string;
  anonymizedAt?: string;
}

export type AppointmentStatus = 'planned' | 'completed' | 'cancelled' | 'noshow' | 'postponed';

export interface AppointmentHistoryEntry {
  at: string;
  action: string; // örn: "Ertelendi", "Durum değişti"
  detail?: string;
}

export interface Appointment extends BaseRecord {
  clientId: ID;
  start: string; // YYYY-MM-DDTHH:mm
  end: string;
  sessionType?: string;
  fee: number; // anlaşılan ücret
  billing: BillingMode;
  packageId?: ID;
  status: AppointmentStatus;
  /** Bu randevu için borçlandırılan tutar (bireysel ödeme). Yalnızca tamamlanan / ücretli iptal / ücretli gelmedi durumlarında > 0 */
  charge: number;
  /** Paketten düşüldü mü */
  packageCreditUsed?: boolean;
  paymentMethod?: string; // tercih edilen ödeme yöntemi
  notes?: string;
  sessionNote?: string; // idari seans notu
  seriesId?: ID;
  seriesKey?: string; // seriesId + tarih — çift kaydı önler
  detached?: boolean; // seriden ayrıştırılmış tekil değişiklik
  reminder?: string; // 'none' | '1h' | '1d' | '2d'
  rescheduledFrom?: string; // önceki başlangıç
  rescheduledToId?: ID; // ertelenip yeni randevu oluşturulduysa
  cancelReason?: string;
  history: AppointmentHistoryEntry[];
}

export type RecurrenceFreq = 'weekly' | 'biweekly' | 'monthly' | 'custom';

export interface Series extends BaseRecord {
  clientId: ID;
  freq: RecurrenceFreq;
  interval: number; // custom: her N haftada bir
  weekdays: number[]; // 1=Pzt ... 7=Paz
  startDate: string; // YYYY-MM-DD
  endDate?: string; // dahil
  time: string; // HH:mm (tüm günler için varsayılan)
  times?: Record<string, string>; // gün bazında saat (opsiyonel)
  duration: number;
  sessionType?: string;
  fee: number;
  billing: BillingMode;
  packageId?: ID;
  paymentMethod?: string;
  reminder?: string;
  notes?: string;
  generatedUntil?: string; // YYYY-MM-DD
  ended?: boolean;
}

export type PaymentKind = 'payment' | 'refund';

export interface Allocation {
  type: 'appointment' | 'package';
  id: ID;
  amount: number;
}

export interface Payment extends BaseRecord {
  clientId?: ID; // diğer gelir için boş olabilir
  date: string; // YYYY-MM-DD
  amount: number; // her zaman pozitif
  kind: PaymentKind;
  method: string;
  allocations: Allocation[];
  category?: string; // diğer gelir kategorisi (clientId yoksa)
  note?: string;
  voided?: boolean;
  voidReason?: string;
  voidedAt?: string;
  revisions?: Revision[];
}

export interface Package extends BaseRecord {
  clientId: ID;
  name: string;
  totalSessions: number;
  price: number;
  purchaseDate: string;
  startDate: string;
  expiryDate?: string;
  method?: string;
  notes?: string;
  cancelled?: boolean;
  revisions?: Revision[];
}

export type PackageTxType = 'use' | 'return' | 'adjust';

export interface PackageTx extends BaseRecord {
  packageId: ID;
  type: PackageTxType;
  delta: number; // -1 kullanım, +1 iade, ±n düzeltme
  appointmentId?: ID;
  reason?: string;
  date: string;
}

export interface Expense extends BaseRecord {
  description: string;
  amount: number;
  date: string;
  category: string;
  method: string;
  note?: string;
  recurringId?: ID;
  recurringKey?: string;
  voided?: boolean;
  voidReason?: string;
  revisions?: Revision[];
}

export interface RecurringExpense extends BaseRecord {
  description: string;
  amount: number;
  category: string;
  method: string;
  dayOfMonth: number;
  startDate: string;
  endDate?: string;
  active: boolean;
  note?: string;
}

export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'normal' | 'high';

export interface Task extends BaseRecord {
  title: string;
  description?: string;
  dueDate?: string;
  priority: Priority;
  status: TaskStatus;
  clientId?: ID;
  reminder?: string;
  completedAt?: string;
}

export interface Note extends BaseRecord {
  title?: string;
  body: string;
  kind: 'quick' | 'office' | 'admin' | 'client';
  clientId?: ID;
  pinned?: boolean;
}

export interface WaitingEntry extends BaseRecord {
  name: string;
  phone: string;
  preferredDays: number[];
  preferredTime: 'any' | 'morning' | 'noon' | 'evening';
  serviceType?: string;
  registeredAt: string;
  priority: Priority;
  notes?: string;
  status: 'waiting' | 'contacted' | 'scheduled' | 'cancelled';
  clientId?: ID;
}

export interface TimeBlock extends BaseRecord {
  start: string; // YYYY-MM-DDTHH:mm
  end: string;
  label: string;
  kind: 'holiday' | 'personal' | 'unavailable';
}

/** Dış kurum çalışma düzeni — yalnızca takvim/müsaitlik içindir; finans ve danışan kayıtlarına dahil edilmez. */
export interface ExternalSchedule extends BaseRecord {
  institution: string;
  weekdays: number[]; // 1=Pzt ... 7=Paz
  startTime: string; // HH:mm
  endTime: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;
  active: boolean;
  skipDates: string[]; // bu tarihlerde gidilmiyor
  note?: string;
}

export interface Template extends BaseRecord {
  key: string;
  title: string;
  body: string;
}

// ───────────── Mesleki takip (seans notları, BEP, ev çalışması, formlar, belgeler) ─────────────

export interface NoteField {
  key: string;
  label: string;
  hint?: string;
}

export interface NoteTemplate extends BaseRecord {
  name: string;
  fields: NoteField[];
  builtin?: boolean;
}

export interface SessionNoteVersion {
  at: string;
  templateName?: string;
  values: Record<string, string>;
  fields: NoteField[];
}

export interface SessionNote extends BaseRecord {
  clientId: ID;
  appointmentId?: ID;
  date: string; // YYYY-MM-DD
  templateId?: ID;
  templateName?: string;
  /** Not yazıldığı andaki alanlar (şablon sonradan değişse de not aynı görünür) */
  fields: NoteField[];
  values: Record<string, string>;
  status: 'draft' | 'final';
  versions?: SessionNoteVersion[];
  deletedAt?: string;
}

export type GoalStatus = 'active' | 'done' | 'paused';

export interface Goal extends BaseRecord {
  clientId: ID;
  kind: 'long' | 'short';
  parentId?: ID; // kısa vadeli hedefin bağlı olduğu uzun vadeli amaç
  title: string;
  criterion?: string;
  status: GoalStatus;
  startDate: string;
  targetDate?: string;
  note?: string;
}

export interface GoalProgress extends BaseRecord {
  goalId: ID;
  clientId: ID;
  date: string;
  correct?: number;
  total?: number;
  comment?: string;
  noteId?: ID;
  appointmentId?: ID;
}

export interface Homework extends BaseRecord {
  clientId: ID;
  goalId?: ID;
  title: string;
  description?: string;
  assignedDate: string;
  dueDate?: string;
  status: 'open' | 'done' | 'not_done';
  completedAt?: string;
}

export type FormFieldType = 'text' | 'choice' | 'score';

export interface FormField {
  id: string;
  label: string;
  type: FormFieldType;
  options?: string[];
  max?: number;
}

export interface FormTemplate extends BaseRecord {
  name: string;
  fields: FormField[];
}

export interface FormResponse extends BaseRecord {
  clientId: ID;
  templateId?: ID;
  templateName: string;
  fields: FormField[];
  date: string;
  answers: Record<string, string | number>;
}

export interface Attachment extends BaseRecord {
  clientId: ID;
  name: string;
  mime: string;
  size: number;
  note?: string;
}

export interface NotificationEntry extends BaseRecord {
  key: string; // tekrar bildirimini önler: randevu + başlangıç + süre
  kind: 'upcoming' | 'daily';
  title: string;
  body: string;
  appointmentId?: ID;
  at: string;
}

export interface ActivityEntry {
  id: ID;
  at: string;
  action: string; // 'create' | 'update' | 'archive' | ...
  entity: string;
  entityId?: ID;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface DayHours {
  enabled: boolean;
  start: string;
  end: string;
  breaks: { start: string; end: string; label: string }[];
}

export interface SpecialDay {
  date: string;
  enabled: boolean;
  start: string;
  end: string;
  label?: string;
}

export interface Settings {
  id: 'main';
  createdAt: string;
  updatedAt: string;
  therapistName: string;
  officeName: string;
  currency: string;
  defaultDuration: number;
  defaultFee: number;
  slotStep: number;
  workingHours: Record<string, DayHours>; // '1'..'7'
  specialDays: SpecialDay[];
  paymentMethods: string[];
  incomeCategories: string[];
  expenseCategories: string[];
  sessionTypes: string[];
  serviceCategories: string[];
  cancellationPolicy: { chargeByDefault: boolean; freeHours: number; percent: number; packageCreditByDefault: 'return' | 'use' };
  noShowPolicy: { charge: boolean; percent: number; usePackageCredit: boolean };
  packagePolicy: { defaultValidityDays: number; warnDaysBefore: number; warnRemaining: number };
  statusColors: Record<AppointmentStatus, string>;
  theme: 'light' | 'dark' | 'system';
  language: 'tr';
  autoLockMinutes: number;
  backup: { intervalHours: number; keep: number; exportReminderDays: number };
  welcomeCardHidden?: boolean;
  onboardingDone?: boolean;
  lastExportAt?: string;
  notifyUpcoming: boolean;
  /** Ezgi'nin kendi cihazına bildirim (danışana mesaj DEĞİL) */
  notifications?: NotificationSettings;
  /** Konuşarak not için bilgilendirme kabul edildi mi */
  speechConsentAt?: string;
}

export interface NotificationSettings {
  enabled: boolean;
  offsets: number[]; // dakika: 1440 = 1 gün önce, 120 = 2 saat önce
  dailySummary: boolean;
  showNames: boolean; // bildirimde danışan adı (varsayılan kapalı)
}

export interface DB {
  settings: Map<ID, Settings>;
  clients: Map<ID, Client>;
  appointments: Map<ID, Appointment>;
  series: Map<ID, Series>;
  payments: Map<ID, Payment>;
  packages: Map<ID, Package>;
  packageTx: Map<ID, PackageTx>;
  expenses: Map<ID, Expense>;
  recurringExpenses: Map<ID, RecurringExpense>;
  tasks: Map<ID, Task>;
  notes: Map<ID, Note>;
  waiting: Map<ID, WaitingEntry>;
  blocks: Map<ID, TimeBlock>;
  external: Map<ID, ExternalSchedule>;
  templates: Map<ID, Template>;
  activity: Map<ID, ActivityEntry>;
  sessionNotes: Map<ID, SessionNote>;
  noteTemplates: Map<ID, NoteTemplate>;
  goals: Map<ID, Goal>;
  goalProgress: Map<ID, GoalProgress>;
  homework: Map<ID, Homework>;
  formTemplates: Map<ID, FormTemplate>;
  formResponses: Map<ID, FormResponse>;
  attachments: Map<ID, Attachment>;
  notificationLog: Map<ID, NotificationEntry>;
}

export type TableName = keyof DB;

export const TABLES: TableName[] = [
  'settings', 'clients', 'appointments', 'series', 'payments', 'packages', 'packageTx',
  'expenses', 'recurringExpenses', 'tasks', 'notes', 'waiting', 'blocks', 'external', 'templates', 'activity',
  'sessionNotes', 'noteTemplates', 'goals', 'goalProgress', 'homework', 'formTemplates', 'formResponses', 'attachments', 'notificationLog',
];

/** Danışana bağlı mesleki kayıt tabloları (silme / anonimleştirme / dışa aktarma bunları kapsar) */
export const CLINICAL_TABLES = ['sessionNotes', 'goals', 'goalProgress', 'homework', 'formResponses', 'attachments'] as const;

export const TABLE_LABELS: Record<TableName, string> = {
  settings: 'Ayarlar',
  clients: 'Danışan',
  appointments: 'Randevu / seans',
  series: 'Tekrarlayan randevu kuralı',
  payments: 'Ödeme',
  packages: 'Paket',
  packageTx: 'Paket hareketi',
  expenses: 'Gider',
  recurringExpenses: 'Düzenli gider',
  tasks: 'Görev',
  notes: 'Not',
  waiting: 'Bekleme listesi',
  blocks: 'Kapalı zaman',
  external: 'Dış kurum çalışma düzeni',
  templates: 'Mesaj şablonu',
  activity: 'İşlem geçmişi',
  sessionNotes: 'Seans notu',
  noteTemplates: 'Not şablonu',
  goals: 'Hedef (BEP)',
  goalProgress: 'Hedef ölçümü',
  homework: 'Ev çalışması',
  formTemplates: 'Form şablonu',
  formResponses: 'Doldurulmuş form',
  attachments: 'Belge / fotoğraf',
  notificationLog: 'Bildirim geçmişi',
};
