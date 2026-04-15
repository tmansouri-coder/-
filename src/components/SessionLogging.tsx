import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, query, where, orderBy, Timestamp, limit } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import { ScheduleSession, SessionLog, Module, Room, User, PedagogicalCalendar, Cycle, Level, Specialty } from '../types';
import { CheckCircle2, XCircle, AlertTriangle, Info, Clock, MapPin, BookOpen, Plus, AlertCircle, BarChart2 } from 'lucide-react';
import { cn, isDateExcluded, getDatesForDay } from '../lib/utils';
import { doc, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function SessionLogging() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { user, isAdmin, isViceAdmin, isSpecialtyManager } = useAuth();
  const { selectedYear } = useAcademicYear();
  const [mySessions, setMySessions] = useState<ScheduleSession[]>([]);
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [calendar, setCalendar] = useState<PedagogicalCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState<ScheduleSession | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [updatingProgress, setUpdatingProgress] = useState<string | null>(null);
  const [activeSemester, setActiveSemester] = useState<'S1' | 'S2'>('S1');

  useEffect(() => {
    const fetchData = async () => {
      if (!auth.currentUser) return;

      try {
        const logsQuery = (isAdmin || isViceAdmin)
          ? query(collection(db, 'sessionLogs'), where('academicYear', '==', selectedYear), orderBy('date', 'desc'))
          : query(collection(db, 'sessionLogs'), where('teacherId', '==', auth.currentUser.uid), where('academicYear', '==', selectedYear), orderBy('date', 'desc'));

        const [sessionsSnap, logsSnap, modulesSnap, roomsSnap, teachersSnap, calendarSnap, cyclesSnap, levelsSnap, specialtiesSnap] = await Promise.all([
          getDocs(query(collection(db, 'scheduleSessions'), where('teacherId', '==', auth.currentUser.uid), where('academicYear', '==', selectedYear))),
          getDocs(logsQuery),
          getDocs(query(collection(db, 'modules'), where('academicYear', '==', selectedYear))),
          getDocs(collection(db, 'rooms')),
          getDocs(collection(db, 'users')),
          getDocs(query(collection(db, 'pedagogicalCalendars'), where('academicYear', '==', selectedYear), limit(1))),
          getDocs(collection(db, 'cycles')),
          getDocs(collection(db, 'levels')),
          getDocs(collection(db, 'specialties'))
        ]);

        setMySessions(sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleSession)));
        setLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SessionLog)));
        setModules(modulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Module)));
        setRooms(roomsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Room)));
        setTeachers(teachersSnap.docs.map(d => ({ ...d.data() } as User)));
        setCycles(cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle)));
        setLevels(levelsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Level)));
        setSpecialties(specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty)));
        
        if (!calendarSnap.empty) {
          setCalendar({ id: calendarSnap.docs[0].id, ...calendarSnap.docs[0].data() } as PedagogicalCalendar);
        }
      } catch (err) {
        console.error("Error fetching session data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [isAdmin, isViceAdmin, isSpecialtyManager, selectedYear]);

  const handleLogSession = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showLogModal || !auth.currentUser) return;

    const formData = new FormData(e.currentTarget);
    const logData = {
      scheduleSessionId: showLogModal.id,
      teacherId: auth.currentUser.uid,
      moduleId: showLogModal.moduleId,
      date: formData.get('date') as string,
      status: formData.get('status') as any,
      content: formData.get('content') as string,
      observations: formData.get('observations') as string,
      timestamp: Timestamp.now(),
      academicYear: selectedYear
    };

    try {
      const docRef = await addDoc(collection(db, 'sessionLogs'), logData);
      setLogs(prev => [{ id: docRef.id, ...logData } as SessionLog, ...prev]);
      setShowLogModal(null);
      toast.success('تم تسجيل الحصة بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'sessionLogs');
    }
  };

  const handleUpdateProgress = async (moduleId: string, progress: number) => {
    // Check if user is allowed to update this module
    const module = modules.find(m => m.id === moduleId);
    const isAllowed = isAdmin || isViceAdmin || 
                      (isSpecialtyManager && user?.specialtyIds?.includes(module?.specialtyId || '')) ||
                      module?.teacherId === auth.currentUser?.uid || 
                      mySessions.some(s => s.moduleId === moduleId);
    
    if (!isAllowed) {
      toast.error(t('unauthorized_progress_update'));
      return;
    }

    setUpdatingProgress(moduleId);
    try {
      await updateDoc(doc(db, 'modules', moduleId), { progress });
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, progress } : m));
      toast.success(t('update_progress_success'));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `modules/${moduleId}`);
    } finally {
      setUpdatingProgress(null);
    }
  };

  if (loading) return <div className="p-8 text-center">{t('loading')}</div>;

  const getModuleSortInfo = (moduleId: string) => {
    const module = modules.find(m => m.id === moduleId);
    if (!module) return { cycleOrder: 99, levelOrder: 99, specialtyName: '' };
    
    const specialty = specialties.find(s => s.id === module.specialtyId);
    const level = levels.find(l => l.id === specialty?.levelId);
    const cycle = cycles.find(c => c.id === level?.cycleId);

    const cycleOrder = 
      cycle?.name === 'Licence' || cycle?.name === 'ليسانس' ? 1 :
      cycle?.name === 'Master' || cycle?.name === 'ماستر' ? 2 :
      cycle?.name === 'Engineer' || cycle?.name === 'مهندس' ? 3 : 4;
    
    const levelOrder = 
      level?.name.includes('1') ? 1 :
      level?.name.includes('2') ? 2 :
      level?.name.includes('3') ? 3 : 4;

    return { cycleOrder, levelOrder, specialtyName: specialty?.name || '' };
  };

  const myModules = ((isAdmin || isViceAdmin)
    ? modules.filter(m => m.semester === activeSemester)
    : isSpecialtyManager
      ? modules.filter(m => (user?.specialtyIds?.includes(m.specialtyId) || m.teacherId === auth.currentUser?.uid || mySessions.some(s => s.moduleId === m.id)) && m.semester === activeSemester)
      : modules.filter(m => (m.teacherId === auth.currentUser?.uid || mySessions.some(s => s.moduleId === m.id)) && m.semester === activeSemester))
    .sort((a, b) => {
      const infoA = getModuleSortInfo(a.id);
      const infoB = getModuleSortInfo(b.id);
      
      if (infoA.cycleOrder !== infoB.cycleOrder) return infoA.cycleOrder - infoB.cycleOrder;
      if (infoA.levelOrder !== infoB.levelOrder) return infoA.levelOrder - infoB.levelOrder;
      return infoA.specialtyName.localeCompare(infoB.specialtyName);
    });

  const getSuggestedSessions = () => {
    if (!calendar || mySessions.length === 0) return [];
    
    const suggestions: { session: ScheduleSession; date: string }[] = [];
    const today = new Date().toISOString().split('T')[0];
    
    mySessions.forEach(session => {
      const startDate = session.semester === 'S1' ? calendar.s1Start : calendar.s2Start;
      const endDate = session.semester === 'S1' ? calendar.s1End : calendar.s2End;
      
      const allDates = getDatesForDay(session.day, startDate, endDate);
      
      allDates.forEach(date => {
        // Only suggest past sessions or today's sessions that haven't been logged yet
        if (date <= today) {
          const isLogged = logs.some(l => l.scheduleSessionId === session.id && l.date === date);
          const isExcluded = isDateExcluded(date, calendar);
          
          if (!isLogged && !isExcluded) {
            suggestions.push({ session, date });
          }
        }
      });
    });
    
    return suggestions.sort((a, b) => b.date.localeCompare(a.date));
  };

  const suggestedSessions = getSuggestedSessions();

  return (
    <div className="space-y-8" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('session_logging')}</h1>
          <p className="text-slate-500">{t('session_logging_desc')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Module Progress Tracking & Suggested Sessions */}
        <div className="space-y-8">
          {/* Suggested Sessions to Log */}
          {suggestedSessions.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-orange-600" />
                {t('suggested_sessions')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {suggestedSessions.map((item, idx) => {
                  const module = modules.find(m => m.id === item.session.moduleId);
                  return (
                    <div key={`${item.session.id}-${item.date}`} className="bg-orange-50 p-4 rounded-2xl border border-orange-100 shadow-sm hover:shadow-md transition-all group">
                      <div className="flex justify-between items-start mb-2">
                        <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold uppercase">
                          {item.date}
                        </span>
                        <button 
                          onClick={() => {
                            setSelectedDate(item.date);
                            setShowLogModal(item.session);
                          }}
                          className="text-orange-600 font-bold text-xs hover:underline flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          {t('log_now')}
                        </button>
                      </div>
                      <h3 className="font-bold text-slate-900 text-sm">{module?.name}</h3>
                      <p className="text-[10px] text-slate-500 mt-1">{item.session.type} - {item.session.period}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Module Progress Tracking */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-emerald-600" />
                {t('module_progress')}
              </h2>
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button 
                  onClick={() => setActiveSemester('S1')}
                  className={cn(
                    "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                    activeSemester === 'S1' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                  )}
                >S1</button>
                <button 
                  onClick={() => setActiveSemester('S2')}
                  className={cn(
                    "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                    activeSemester === 'S2' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                  )}
                >S2</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myModules.length > 0 ? myModules.map(module => (
                <div key={module.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{module.name}</h4>
                      <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                        {cycles.find(c => c.id === levels.find(l => l.id === specialties.find(s => s.id === module.specialtyId)?.levelId)?.cycleId)?.name} - {levels.find(l => l.id === specialties.find(s => s.id === module.specialtyId)?.levelId)?.name} - {specialties.find(s => s.id === module.specialtyId)?.name}
                      </p>
                    </div>
                    <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                      {module.progress || 0}%
                    </span>
                  </div>
                  
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 transition-all duration-500" 
                      style={{ width: `${module.progress || 0}%` }}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      step="5"
                      disabled={updatingProgress === module.id}
                      defaultValue={module.progress || 0}
                      onMouseUp={(e) => handleUpdateProgress(module.id, parseInt((e.target as HTMLInputElement).value))}
                      className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                    />
                    <span className="text-[10px] text-slate-400 font-bold">{t('update')}</span>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-slate-400 italic text-center py-4 col-span-full">{t('no_modules_assigned')}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">{t('log_session_modal_title')}</h2>
              <button onClick={() => setShowLogModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><XCircle className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleLogSession} className="p-6 space-y-4">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase">{t('selected_module')}</p>
                    <p className="font-bold text-slate-900">{modules.find(m => m.id === showLogModal.moduleId)?.name}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('session_date')}</label>
                  <input 
                    type="date" 
                    name="date" 
                    required 
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('session_status')}</label>
                  <select name="status" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="taught">{t('taught')}</option>
                    <option value="student_absence">{t('student_absence')}</option>
                    <option value="technical_problem">{t('technical_problem')}</option>
                    <option value="internship">{t('internship')}</option>
                  </select>
                </div>
              </div>

              {isDateExcluded(selectedDate, calendar) && (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 leading-relaxed font-bold">
                    {t('calendar_exclusion_warning')}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">{t('session_content_label')}</label>
                <textarea name="content" required rows={3} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" placeholder={t('session_content_placeholder')}></textarea>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">{t('additional_observations')}</label>
                <textarea name="observations" rows={2} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"></textarea>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">{t('confirm_log')}</button>
                <button type="button" onClick={() => setShowLogModal(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">{t('cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
