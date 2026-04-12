import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, query, where, orderBy, Timestamp, limit } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import { ScheduleSession, SessionLog, Module, Room, User, PedagogicalCalendar } from '../types';
import { CheckCircle2, XCircle, AlertTriangle, Info, Clock, MapPin, BookOpen, Plus, AlertCircle, BarChart2 } from 'lucide-react';
import { cn, isDateExcluded, getDatesForDay } from '../lib/utils';
import { doc, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';

export default function SessionLogging() {
  const { user, isAdmin, isViceAdmin } = useAuth();
  const { selectedYear } = useAcademicYear();
  const [mySessions, setMySessions] = useState<ScheduleSession[]>([]);
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [calendar, setCalendar] = useState<PedagogicalCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState<ScheduleSession | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [updatingProgress, setUpdatingProgress] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!auth.currentUser) return;

      try {
        const logsQuery = (isAdmin || isViceAdmin)
          ? query(collection(db, 'sessionLogs'), where('academicYear', '==', selectedYear), orderBy('date', 'desc'))
          : query(collection(db, 'sessionLogs'), where('teacherId', '==', auth.currentUser.uid), where('academicYear', '==', selectedYear), orderBy('date', 'desc'));

        const [sessionsSnap, logsSnap, modulesSnap, roomsSnap, teachersSnap, calendarSnap] = await Promise.all([
          getDocs(query(collection(db, 'scheduleSessions'), where('teacherId', '==', auth.currentUser.uid), where('academicYear', '==', selectedYear))),
          getDocs(logsQuery),
          getDocs(query(collection(db, 'modules'), where('academicYear', '==', selectedYear))),
          getDocs(collection(db, 'rooms')),
          getDocs(collection(db, 'users')),
          getDocs(query(collection(db, 'pedagogicalCalendars'), where('academicYear', '==', selectedYear), limit(1)))
        ]);

        setMySessions(sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleSession)));
        setLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SessionLog)));
        setModules(modulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Module)));
        setRooms(roomsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Room)));
        setTeachers(teachersSnap.docs.map(d => ({ ...d.data() } as User)));
        
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
  }, [isAdmin, isViceAdmin, selectedYear]);

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
    setUpdatingProgress(moduleId);
    try {
      await updateDoc(doc(db, 'modules', moduleId), { progress });
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, progress } : m));
      toast.success('تم تحديث نسبة التقدم');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `modules/${moduleId}`);
    } finally {
      setUpdatingProgress(null);
    }
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  const myModules = modules.filter(m => m.teacherId === auth.currentUser?.uid || mySessions.some(s => s.moduleId === m.id));

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
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">تسجيل الحصص</h1>
          <p className="text-slate-500">متابعة الحصص المنجزة والغيابات والمشاكل التقنية</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* My Weekly Sessions & Progress */}
        <div className="lg:col-span-1 space-y-8">
          {/* Suggested Sessions to Log */}
          {suggestedSessions.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-orange-600" />
                حصص بانتظار التسجيل
              </h2>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
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
                          تسجيل الآن
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

          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              حصصي الأسبوعية
            </h2>
            <div className="space-y-3">
              {mySessions.length > 0 ? mySessions.map(session => {
                const module = modules.find(m => m.id === session.moduleId);
                const room = rooms.find(r => r.id === session.roomId);
                return (
                  <div key={session.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                    <div className="flex justify-between items-start mb-2">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                        session.type === 'Cours' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                      )}>{session.type}</span>
                      <button 
                        onClick={() => setShowLogModal(session)}
                        className="text-blue-600 font-bold text-xs hover:underline opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        تسجيل إنجاز
                      </button>
                    </div>
                    <h3 className="font-bold text-slate-900">{module?.name}</h3>
                    <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {room?.name}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {session.day} - {session.period}</span>
                    </div>
                  </div>
                );
              }) : (
                <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center">
                  <p className="text-sm text-slate-400">لا توجد حصص مسجلة في جدولك</p>
                </div>
              )}
            </div>
          </div>

          {/* Module Progress Tracking */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-emerald-600" />
              نسبة تقدم المقاييس
            </h2>
            <div className="space-y-4">
              {myModules.length > 0 ? myModules.map(module => (
                <div key={module.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="font-bold text-slate-900 text-sm">{module.name}</h4>
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
                    <span className="text-[10px] text-slate-400 font-bold">تحديث</span>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-slate-400 italic text-center py-4">لا توجد مقاييس مرتبطة بك</p>
              )}
            </div>
          </div>
        </div>

        {/* Recent Logs */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            آخر التسجيلات
          </h2>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="p-4 text-sm font-bold text-slate-500">التاريخ</th>
                    {(isAdmin || isViceAdmin) && <th className="p-4 text-sm font-bold text-slate-500">الأستاذ</th>}
                    <th className="p-4 text-sm font-bold text-slate-500">المقياس</th>
                    <th className="p-4 text-sm font-bold text-slate-500">الحالة</th>
                    <th className="p-4 text-sm font-bold text-slate-500">المحتوى</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length > 0 ? logs.map(log => {
                    const module = modules.find(m => m.id === log.moduleId);
                    const teacher = teachers.find(t => t.uid === log.teacherId);
                    return (
                      <tr key={log.id} className="border-b border-slate-50 last:border-0">
                        <td className="p-4 text-sm font-medium text-slate-900">{log.date}</td>
                        {(isAdmin || isViceAdmin) && (
                          <td className="p-4 text-sm text-slate-600 font-bold">{teacher?.displayName}</td>
                        )}
                        <td className="p-4 text-sm text-slate-600">{module?.name}</td>
                        <td className="p-4">
                          <span className={cn(
                            "flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-lg w-fit",
                            log.status === 'taught' ? "bg-emerald-50 text-emerald-600" :
                            log.status === 'student_absence' ? "bg-red-50 text-red-600" :
                            log.status === 'technical_problem' ? "bg-orange-50 text-orange-600" :
                            "bg-blue-50 text-blue-600"
                          )}>
                            {log.status === 'taught' && <CheckCircle2 className="w-3 h-3" />}
                            {log.status === 'student_absence' && <XCircle className="w-3 h-3" />}
                            {log.status === 'technical_problem' && <AlertTriangle className="w-3 h-3" />}
                            {log.status === 'internship' && <Info className="w-3 h-3" />}
                            {log.status === 'taught' ? 'تم التدريس' :
                             log.status === 'student_absence' ? 'غياب' :
                             log.status === 'technical_problem' ? 'مشكل تقني' : 'تربص'}
                          </span>
                        </td>
                        <td className="p-4 text-sm text-slate-500 max-w-xs truncate">{log.content}</td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-sm text-slate-400 italic">لا توجد تسجيلات سابقة</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">تسجيل إنجاز حصة</h2>
              <button onClick={() => setShowLogModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><XCircle className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleLogSession} className="p-6 space-y-4">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase">المقياس المختار</p>
                    <p className="font-bold text-slate-900">{modules.find(m => m.id === showLogModal.moduleId)?.name}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تاريخ الحصة</label>
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
                  <label className="text-sm font-bold text-slate-700">حالة الحصة</label>
                  <select name="status" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="taught">تم التدريس</option>
                    <option value="student_absence">غياب الطلبة</option>
                    <option value="technical_problem">مشكل تقني (قاعة، كهرباء...)</option>
                    <option value="internship">مهمة علمية / تربص</option>
                  </select>
                </div>
              </div>

              {isDateExcluded(selectedDate, calendar) && (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 leading-relaxed font-bold">
                    تنبيه: هذا التاريخ مسجل كعطلة أو فترة مستثناة في الرزنامة البيداغوجية.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">محتوى الحصة (الدرس المنجز)</label>
                <textarea name="content" required rows={3} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" placeholder="مثلاً: الفصل الأول - مقدمة في علم المواد"></textarea>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">ملاحظات إضافية</label>
                <textarea name="observations" rows={2} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"></textarea>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">تأكيد التسجيل</button>
                <button type="button" onClick={() => setShowLogModal(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
