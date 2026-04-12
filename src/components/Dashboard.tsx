import React, { useEffect, useState } from 'react';
import { collection, query, getDocs, where, limit, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  Users, 
  BookOpen, 
  Calendar, 
  ClipboardList, 
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  CalendarDays,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { seedInitialData } from '../lib/seed';
import { PedagogicalCalendar, CalendarEvent, CalendarEventType } from '../types';
import { useTranslation } from 'react-i18next';

const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  holiday: 'عطلة / أيام مستثناة',
  exam_s1: 'امتحانات السداسي الأول',
  exam_s2: 'امتحانات السداسي الثاني',
  review: 'اطلاع الطلبة على النتائج',
  deliberation: 'مداولات الدورة العادية',
  resit_s1: 'استدراكي السداسي الأول',
  resit_s2: 'استدراكي السداسي الثاني',
  thesis_submission: 'إيداع مذكرات التخرج',
  thesis_defense: 'مناقشة مذكرات التخرج',
  final_deliberation: 'المداولات النهائية',
  certificates: 'تسليم الشهادات النهائية',
  master_app: 'الترشح للماستر',
};

const EVENT_TYPE_COLORS: Record<CalendarEventType, string> = {
  holiday: 'bg-orange-50 text-orange-700 border-orange-100',
  exam_s1: 'bg-blue-50 text-blue-700 border-blue-100',
  exam_s2: 'bg-blue-50 text-blue-700 border-blue-100',
  review: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  deliberation: 'bg-purple-50 text-purple-700 border-purple-100',
  resit_s1: 'bg-amber-50 text-amber-700 border-amber-100',
  resit_s2: 'bg-amber-50 text-amber-700 border-amber-100',
  thesis_submission: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  thesis_defense: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  final_deliberation: 'bg-rose-50 text-rose-700 border-rose-100',
  certificates: 'bg-teal-50 text-teal-700 border-teal-100',
  master_app: 'bg-violet-50 text-violet-700 border-violet-100',
};

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { user, isAdmin } = useAuth();
  const isTahar = user?.email === 't.mansouri@lagh-univ.dz';
  console.log('Dashboard: Render state:', { user, isAdmin, isTahar });
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    teachers: 0,
    sessions: 0,
    projects: 0,
    modules: 0
  });
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [calendar, setCalendar] = useState<PedagogicalCalendar | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [teachersSnap, sessionsSnap, projectsSnap, modulesSnap, calendarSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'sessionLogs')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'modules')),
          getDocs(query(collection(db, 'pedagogicalCalendars'), orderBy('academicYear', 'desc'), limit(1)))
        ]);

        setStats({
          teachers: teachersSnap.size,
          sessions: sessionsSnap.size,
          projects: projectsSnap.size,
          modules: modulesSnap.size
        });

        if (!calendarSnap.empty) {
          setCalendar({ id: calendarSnap.docs[0].id, ...calendarSnap.docs[0].data() } as PedagogicalCalendar);
        }

        const recentQuery = query(collection(db, 'sessionLogs'), orderBy('createdAt', 'desc'), limit(5));
        const recentSnap = await getDocs(recentQuery);
        setRecentSessions(recentSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'dashboard_stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const [showConfirm, setShowConfirm] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedProgress, setSeedProgress] = useState<{ step: string; percentage: number } | null>(null);

  const handleForceSeed = async () => {
    try {
      console.log('handleForceSeed: Starting...');
      setIsSeeding(true);
      setSeedProgress({ step: 'جاري البدء...', percentage: 0 });
      
      console.log('handleForceSeed: Calling seedInitialData(true)...');
      await seedInitialData(true, (progress) => {
        setSeedProgress(progress);
      });
      
      console.log('handleForceSeed: seedInitialData completed successfully');
      alert('تم توليد البيانات بنجاح! سيتم إعادة تحميل الصفحة الآن.');
      window.location.reload();
    } catch (err) {
      console.error('handleForceSeed: Seeding failed:', err);
      alert('فشل في توليد البيانات: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSeeding(false);
      setSeedProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const statCards = [
    { label: t('teachers'), value: stats.teachers, icon: Users, color: 'bg-blue-500' },
    { label: t('recorded_sessions'), value: stats.sessions, icon: Calendar, color: 'bg-emerald-500' },
    { label: t('projects'), value: stats.projects, icon: ClipboardList, color: 'bg-amber-500' },
    { label: t('modules'), value: stats.modules, icon: BookOpen, color: 'bg-indigo-500' },
  ];

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('welcome')}, {user?.displayName}</h1>
          <p className="text-slate-500">{t('activity_overview')} ({t('role')}: {user?.role})</p>
        </div>
        <div className="flex items-center gap-4">
          {(isAdmin || isTahar) && (
            <div className="relative">
              {!showConfirm ? (
                <button 
                  onClick={() => {
                    if (isSeeding) return;
                    console.log('Seed button clicked, showing confirm');
                    setShowConfirm(true);
                  }}
                  disabled={isSeeding}
                  className={cn(
                    "bg-orange-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-orange-700 transition-all flex items-center gap-3 shadow-xl shadow-orange-200 cursor-pointer relative z-50 border-2 border-orange-400",
                    isSeeding && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <RefreshCw className={cn("w-6 h-6", isSeeding && "animate-spin")} />
                  {isSeeding ? 'جاري توليد البيانات...' : 'توليد البيانات الأولية للقسم (اضغط هنا)'}
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-white p-2 rounded-2xl shadow-xl border-2 border-orange-200 animate-in fade-in zoom-in duration-200">
                  <p className="text-sm font-bold text-slate-700 px-2">هل أنت متأكد؟ سيتم مسح كل شيء.</p>
                  <button 
                    onClick={() => {
                      console.log('Confirm: YES clicked');
                      setShowConfirm(false);
                      handleForceSeed();
                    }}
                    className="bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-700 transition-all"
                  >
                    نعم، ابدأ
                  </button>
                  <button 
                    onClick={() => {
                      console.log('Confirm: NO clicked');
                      setShowConfirm(false);
                    }}
                    className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                  >
                    إلغاء
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-slate-600">
              {new Date().toLocaleDateString('ar-DZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      {isSeeding && seedProgress && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-orange-50 border-2 border-orange-200 p-6 rounded-3xl shadow-lg"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-6 h-6 text-orange-600 animate-spin" />
              <h3 className="text-lg font-bold text-orange-900">{seedProgress.step}</h3>
            </div>
            <span className="text-orange-700 font-bold">{seedProgress.percentage}%</span>
          </div>
          <div className="w-full bg-orange-200 rounded-full h-4 overflow-hidden">
            <motion.div 
              className="bg-orange-600 h-full"
              initial={{ width: 0 }}
              animate={{ width: `${seedProgress.percentage}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-sm text-orange-700 mt-3 font-medium">يرجى عدم إغلاق الصفحة حتى اكتمال العملية...</p>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4"
          >
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg", card.color)}>
              <card.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium">{card.label}</p>
              <h3 className="text-2xl font-bold text-slate-900">{card.value}</h3>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Pedagogical Calendar Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <CalendarDays className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">الرزنامة البيداغوجية</h2>
                  <p className="text-xs text-slate-500">المواعيد الهامة للسنة الجامعية {calendar?.academicYear}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {calendar?.events && calendar.events.length > 0 ? (
                calendar.events.map((event) => (
                  <div key={event.id} className={cn("p-4 rounded-xl border flex flex-col justify-between", EVENT_TYPE_COLORS[event.type])}>
                    <p className="text-[10px] font-bold uppercase mb-1 opacity-70">{EVENT_TYPE_LABELS[event.type]}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">{event.startDate} {event.endDate !== event.startDate && `إلى ${event.endDate}`}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-full py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <p className="text-sm text-slate-400 italic">لا توجد مواعيد مضافة في الرزنامة حالياً</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">آخر النشاطات</h2>
              <button className="text-sm text-blue-600 font-medium hover:underline">عرض الكل</button>
            </div>
            <div className="space-y-4">
              {recentSessions.length > 0 ? recentSessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      session.status === 'taught' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                    )}>
                      {session.status === 'taught' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">تم تسجيل حصة جديدة</p>
                      <p className="text-xs text-slate-500">{session.date} - {session.startTime}</p>
                    </div>
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-xs font-bold",
                    session.status === 'taught' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  )}>
                    {session.status === 'taught' ? 'تم التدريس' : 'غياب'}
                  </span>
                </div>
              )) : (
                <p className="text-center text-slate-500 py-8">لا توجد نشاطات مؤخراً</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-6">إحصائيات التقدم</h2>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">مشاريع التخرج</span>
                <span className="text-sm font-bold text-blue-600">65%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full" style={{ width: '65%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">تغطية المقاييس</span>
                <span className="text-sm font-bold text-emerald-600">82%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div className="bg-emerald-600 h-2 rounded-full" style={{ width: '82%' }}></div>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-50">
              <div className="flex items-center gap-3 text-amber-600 bg-amber-50 p-4 rounded-xl border border-amber-100">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-xs font-medium leading-relaxed">
                  هناك 3 أساتذة لم يقوموا بتسجيل حصصهم لهذا الأسبوع. يرجى المتابعة.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
