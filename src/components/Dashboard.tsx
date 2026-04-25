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
  ChevronRight,
  MoreVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { seedInitialData } from '../lib/seed';
import { PedagogicalCalendar, CalendarEvent, CalendarEventType, Module, Project, User, Cycle, Level, Specialty } from '../types';
import { useTranslation } from 'react-i18next';
import { mapLevelName } from '../lib/utils';

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
  
  const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
    holiday: t('holiday'),
    exam_s1: t('exam_s1'),
    exam_s2: t('exam_s2'),
    review: t('review'),
    deliberation: t('deliberation'),
    resit_s1: t('resit_s1'),
    resit_s2: t('resit_s2'),
    thesis_submission: t('thesis_submission'),
    thesis_defense: t('thesis_defense'),
    final_deliberation: t('final_deliberation'),
    certificates: t('certificates_delivery'),
    master_app: t('master_app'),
  };

  const { user, isAdmin } = useAuth();
  const isTahar = user?.email === 't.mansouri@lagh-univ.dz';

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin': return t('admin');
      case 'vice_admin': return t('vice_admin');
      case 'specialty_manager': return t('specialty_manager');
      case 'teacher': return t('teacher');
      default: return role;
    }
  };
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    teachers: 0,
    students: 0,
    sessions: 0,
    projects: 0,
    modules: 0,
    avgProgress: 0,
    projectCompletion: 0
  });
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [calendar, setCalendar] = useState<PedagogicalCalendar | null>(null);
  const [breakdown, setBreakdown] = useState<any[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [teachersSnap, studentsSnap, sessionsSnap, projectsSnap, modulesSnap, calendarSnap, cyclesSnap, levelsSnap, specialtiesSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'students')),
          getDocs(collection(db, 'sessionLogs')),
          getDocs(collection(db, 'projects')),
          getDocs(collection(db, 'modules')),
          getDocs(query(collection(db, 'pedagogicalCalendars'), orderBy('academicYear', 'desc'), limit(1))),
          getDocs(collection(db, 'cycles')),
          getDocs(collection(db, 'levels')),
          getDocs(collection(db, 'specialties'))
        ]);

        const teachers = teachersSnap.docs.map(d => d.data() as User);
        const modules = modulesSnap.docs.map(d => d.data() as Module);
        const projects = projectsSnap.docs.map(d => d.data() as Project);
        const cycles = cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle));
        const levels = levelsSnap.docs.map(d => {
          const data = d.data() as any;
          const cycle = cycles.find(c => c.id === data.cycleId);
          return { id: d.id, ...data, name: mapLevelName(data.name, cycle?.name || '') } as Level;
        });
        const specialties = specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty));

        const avgProgress = modules.length > 0 
          ? Math.round(modules.reduce((acc, m) => acc + (m.progress || 0), 0) / modules.length)
          : 0;
        
        const projectCompletion = projects.length > 0
          ? Math.round(projects.reduce((acc, p) => acc + (p.progress || 0), 0) / projects.length)
          : 0;

        setStats({
          teachers: teachersSnap.size,
          students: studentsSnap.size,
          sessions: sessionsSnap.size,
          projects: projectsSnap.size,
          modules: modulesSnap.size,
          avgProgress,
          projectCompletion
        });

        // Calculate breakdown
        const breakdownData: any[] = [];
        cycles.forEach(cycle => {
          const cycleLevels = levels.filter(l => l.cycleId === cycle.id);
          cycleLevels.forEach(level => {
            const levelSpecs = specialties.filter(s => s.levelId === level.id);
            levelSpecs.forEach(spec => {
              const specModules = modules.filter(m => m.specialtyId === spec.id);
              if (specModules.length > 0) {
                const progress = Math.round(specModules.reduce((acc, m) => acc + (m.progress || 0), 0) / specModules.length);
                breakdownData.push({
                  cycle: cycle.name,
                  level: level.name,
                  specialty: spec.name,
                  progress
                });
              }
            });
          });
        });
        setBreakdown(breakdownData);

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
      setSeedProgress({ step: t('loading'), percentage: 0 });
      
      console.log('handleForceSeed: Calling seedInitialData(true)...');
      await seedInitialData(true, (progress) => {
        setSeedProgress({
          ...progress,
          step: t(progress.step) || progress.step
        });
      });
      
      console.log('handleForceSeed: seedInitialData completed successfully');
      alert(t('generate_data_success') || 'تم توليد البيانات بنجاح! سيتم إعادة تحميل الصفحة الآن.');
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
    { label: t('total_students'), value: stats.students, icon: Users, color: 'bg-emerald-500' },
    { label: t('recorded_sessions'), value: stats.sessions, icon: Calendar, color: 'bg-amber-500' },
    { label: t('projects'), value: stats.projects, icon: ClipboardList, color: 'bg-indigo-500' },
  ];

  return (
    <div className="space-y-10 pb-12" dir="rtl">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            {t('welcome')}, <span className="text-blue-600">{user?.displayName}</span>
          </h1>
          <p className="text-slate-500 font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {t('activity_overview')} • {getRoleLabel(user?.role || '')}
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          {(isAdmin || isTahar) && (
            <div className="relative">
              {!showConfirm ? (
                <button 
                  onClick={() => {
                    if (isSeeding) return;
                    setShowConfirm(true);
                  }}
                  disabled={isSeeding}
                  className={cn(
                    "bg-white text-orange-600 px-6 py-3 rounded-2xl font-bold hover:bg-orange-50 transition-all flex items-center gap-3 border-2 border-orange-100 shadow-sm group",
                    isSeeding && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <RefreshCw className={cn("w-5 h-5 transition-transform duration-500", isSeeding ? "animate-spin" : "group-hover:rotate-180")} />
                  <span>{isSeeding ? t('generating') : t('initial_data_gen')}</span>
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-white p-2 rounded-2xl shadow-2xl border border-orange-100 animate-in fade-in zoom-in duration-200">
                  <p className="text-xs font-bold text-slate-700 px-3">{t('are_you_sure_seed')}</p>
                  <button 
                    onClick={() => {
                      setShowConfirm(false);
                      handleForceSeed();
                    }}
                    className="bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-700 transition-all"
                  >
                    {t('yes_start')}
                  </button>
                  <button 
                    onClick={() => setShowConfirm(false)}
                    className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-200 transition-all"
                  >
                    {t('cancel')}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="bg-white px-5 py-3 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <CalendarDays className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-700">
              {new Date().toLocaleDateString('ar-DZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      {isSeeding && seedProgress && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white border border-orange-100 p-8 rounded-4xl shadow-2xl shadow-orange-100/50 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-orange-100">
            <motion.div 
              className="h-full bg-orange-500"
              initial={{ width: 0 }}
              animate={{ width: `${seedProgress.percentage}%` }}
            />
          </div>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-600">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-slate-900">{seedProgress.step}</h3>
                <p className="text-sm text-slate-500 font-medium">{t('seeding_warning')}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black text-orange-600">{seedProgress.percentage}%</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Stats Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="group bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 transition-all duration-300"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg transition-transform duration-500 group-hover:rotate-12", card.color)}>
                <card.icon className="w-7 h-7" />
              </div>
              <div className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg text-[10px] font-bold">
                <TrendingUp className="w-3 h-3" />
                <span>+12%</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{card.label}</p>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight">{card.value}</h3>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-8 space-y-8">
          {/* Pedagogical Calendar Section */}
          <div className="bg-white rounded-4xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 text-indigo-600 flex items-center justify-center">
                  <CalendarDays className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900">{t('pedagogical_calendar')}</h2>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{t('academic_year_label')} {calendar?.academicYear}</p>
                </div>
              </div>
              <button className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-blue-600">
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {calendar && (
                  <>
                    <div className="p-5 rounded-3xl border-2 border-blue-50 bg-blue-50/30 group hover:bg-blue-50 transition-colors">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest">{t('semester')} 1</p>
                      </div>
                      <p className="text-sm font-extrabold text-slate-900">{calendar.s1Start} <span className="text-slate-400 font-medium mx-1">→</span> {calendar.s1End}</p>
                    </div>
                    <div className="p-5 rounded-3xl border-2 border-blue-50 bg-blue-50/30 group hover:bg-blue-50 transition-colors">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <p className="text-[10px] font-black uppercase text-blue-600 tracking-widest">{t('semester')} 2</p>
                      </div>
                      <p className="text-sm font-extrabold text-slate-900">{calendar.s2Start} <span className="text-slate-400 font-medium mx-1">→</span> {calendar.s2End}</p>
                    </div>
                  </>
                )}
                {calendar?.events?.map((event) => (
                  <div key={event.id} className={cn("p-5 rounded-3xl border-2 transition-all hover:scale-[1.02]", EVENT_TYPE_COLORS[event.type].replace('bg-', 'bg-opacity-30 bg-').replace('border-', 'border-opacity-50 border-'))}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn("w-2 h-2 rounded-full", EVENT_TYPE_COLORS[event.type].split(' ')[1].replace('text-', 'bg-'))} />
                      <p className="text-[10px] font-black uppercase tracking-widest opacity-80">{EVENT_TYPE_LABELS[event.type]}</p>
                    </div>
                    <p className="text-sm font-extrabold text-slate-900">
                      {event.startDate} 
                      {event.endDate !== event.startDate && <><span className="text-slate-400 font-medium mx-1">→</span> {event.endDate}</>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Activities */}
          <div className="bg-white rounded-4xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center">
                  <ClipboardList className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-extrabold text-slate-900">{t('recent_activities')}</h2>
              </div>
              <button className="px-4 py-2 text-sm text-blue-600 font-bold hover:bg-blue-50 rounded-xl transition-all">{t('view_all')}</button>
            </div>
            <div className="p-4 space-y-2">
              {recentSessions.length > 0 ? recentSessions.map((session, i) => (
                <motion.div 
                  key={session.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-5 rounded-3xl hover:bg-slate-50 transition-all group"
                >
                  <div className="flex items-center gap-5">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110",
                      session.status === 'taught' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                    )}>
                      {session.status === 'taught' ? <CheckCircle2 className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
                    </div>
                    <div>
                      <p className="font-extrabold text-slate-900 text-base">{t('session_logged')}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400 font-bold flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {session.date}
                        </span>
                        <span className="text-xs text-slate-400 font-bold flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {session.startTime}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className={cn(
                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest",
                    session.status === 'taught' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  )}>
                    {session.status === 'taught' ? t('taught') : t('absence')}
                  </div>
                </motion.div>
              )) : (
                <div className="py-12 text-center">
                  <p className="text-slate-400 font-medium italic">{t('no_recent_activities')}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Content Area */}
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-white rounded-4xl border border-slate-100 shadow-sm overflow-hidden sticky top-24">
            <div className="p-8 border-b border-slate-50 bg-slate-50/30">
              <h2 className="text-xl font-extrabold text-slate-900 mb-1">تقدم المقاييس</h2>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">حسب التخصص والمستوى</p>
            </div>
            <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar">
              {breakdown.length > 0 ? breakdown.map((item, idx) => (
                <div key={idx} className="p-5 bg-white rounded-3xl border border-slate-100 hover:border-blue-200 transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-lg text-[9px] font-black uppercase tracking-tighter">{item.cycle}</span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-lg text-[9px] font-black uppercase tracking-tighter">{item.level}</span>
                      </div>
                      <h4 className="text-sm font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors">{item.specialty}</h4>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-black text-blue-600">{item.progress}%</span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${item.progress}%` }}
                      transition={{ duration: 1, delay: idx * 0.1 }}
                      className={cn(
                        "h-full rounded-full transition-all",
                        item.progress > 70 ? "bg-emerald-500" : item.progress > 30 ? "bg-blue-500" : "bg-orange-500"
                      )} 
                    />
                  </div>
                </div>
              )) : (
                <div className="py-12 text-center">
                  <p className="text-slate-400 font-medium italic">لا توجد بيانات متاحة</p>
                </div>
              )}
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
