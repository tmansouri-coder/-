import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { User, ScheduleSession, SessionLog, Module, OvertimeRequest } from '../types';
import { 
  Clock, Calculator, Download, User as UserIcon, BookOpen, 
  AlertCircle, CheckCircle2, Plus, Trash2, Edit2, X, Send, Check, AlertTriangle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import toast from 'react-hot-toast';

export default function OvertimeCalc() {
  const { user: currentUser, isAdmin, isViceAdmin } = useAuth();
  const { selectedYear } = useAcademicYear();
  const [teachers, setTeachers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<OvertimeRequest | null>(null);
  const [filterSemester, setFilterSemester] = useState<'All' | 'S1' | 'S2'>('All');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [usersSnap, sessionsSnap, logsSnap, modulesSnap, requestsSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', 'in', ['teacher', 'specialty_manager']))),
          getDocs(query(collection(db, 'scheduleSessions'), where('academicYear', '==', selectedYear))),
          getDocs(query(collection(db, 'sessionLogs'), where('academicYear', '==', selectedYear))),
          getDocs(query(collection(db, 'modules'), where('academicYear', '==', selectedYear))),
          getDocs(query(collection(db, 'overtimeRequests'), where('academicYear', '==', selectedYear)))
        ]);

        setTeachers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as User)));
        setSessions(sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleSession)));
        setLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SessionLog)));
        setModules(modulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Module)));
        setOvertimeRequests(requestsSnap.docs.map(d => ({ id: d.id, ...d.data() } as OvertimeRequest)));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'overtime_data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const calculateHours = (teacherId: string, semester: 'S1' | 'S2') => {
    const teacherSessions = sessions.filter(s => s.teacherId === teacherId && s.semester === semester);
    
    // Quota Logic: Lecture = 2.25, TD/TP = 1.5
    let weeklyHours = 0;
    teacherSessions.forEach(s => {
      if (s.type === 'Cours') weeklyHours += 2.25;
      else weeklyHours += 1.5;
    });

    const taughtLogs = logs.filter(l => l.teacherId === teacherId && l.status === 'taught');
    let totalTaughtHours = 0;
    taughtLogs.forEach(l => {
      const session = sessions.find(s => s.id === l.scheduleSessionId);
      if (session && session.semester === semester) {
        if (session.type === 'Cours') totalTaughtHours += 2.25;
        else totalTaughtHours += 1.5;
      }
    });
    
    const baseWeeklyQuota = 9;
    const overtimeWeekly = Math.max(0, weeklyHours - baseWeeklyQuota);
    
    return { weeklyHours, totalTaughtHours, overtimeWeekly, baseWeeklyQuota };
  };

  const handleAddRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser) return;
    const formData = new FormData(e.currentTarget);
    const semester = formData.get('semester') as 'S1' | 'S2';
    
    const { weeklyHours, overtimeWeekly, baseWeeklyQuota } = calculateHours(currentUser.uid, semester);
    
    const requestData = {
      teacherId: currentUser.uid,
      month: formData.get('month') as string,
      semester: formData.get('semester') as 'S1' | 'S2',
      weeklyQuota: baseWeeklyQuota,
      actualWeeklyHours: weeklyHours,
      overtimeHours: overtimeWeekly * 4, // Assuming 4 weeks in a month for simplicity or user input
      status: 'Pending' as const,
      academicYear: selectedYear,
      createdAt: new Date().toISOString()
    };

    try {
      if (editingRequest) {
        await updateDoc(doc(db, 'overtimeRequests', editingRequest.id), requestData);
        setOvertimeRequests(prev => prev.map(r => r.id === editingRequest.id ? { ...r, ...requestData } : r));
        toast.success('تم تحديث الطلب بنجاح');
      } else {
        const docRef = await addDoc(collection(db, 'overtimeRequests'), requestData);
        setOvertimeRequests(prev => [...prev, { id: docRef.id, ...requestData } as OvertimeRequest]);
        toast.success('تم إرسال طلب الساعات الإضافية بنجاح');
      }
      setShowRequestModal(false);
      setEditingRequest(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'overtimeRequests');
    }
  };

  const handleApproveRequest = async (id: string) => {
    try {
      await updateDoc(doc(db, 'overtimeRequests', id), { status: 'Approved' });
      setOvertimeRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'Approved' } : r));
      toast.success('تم قبول الطلب');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `overtimeRequests/${id}`);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الطلب؟')) return;
    try {
      await deleteDoc(doc(db, 'overtimeRequests', id));
      setOvertimeRequests(prev => prev.filter(r => r.id !== id));
      toast.success('تم حذف الطلب');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `overtimeRequests/${id}`);
    }
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  const filteredRequests = overtimeRequests
    .filter(r => (isAdmin || isViceAdmin) ? true : r.teacherId === currentUser?.uid)
    .filter(r => filterSemester === 'All' || r.semester === filterSemester);

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">حساب الساعات الإضافية</h1>
          <p className="text-slate-500">متابعة النصاب الساعي والتعويضات للأساتذة</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowRequestModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 font-bold"
          >
            <Plus className="w-4 h-4" />
            <span>تقديم طلب ساعات</span>
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 font-bold">
            <Download className="w-4 h-4" />
            <span>تصدير كشف الساعات</span>
          </button>
        </div>
      </div>

      {/* Teacher's Personal Status (If not admin) */}
      {(!isAdmin && !isViceAdmin && currentUser) && (
        <div className="space-y-6">
          <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <label className="text-sm font-bold text-slate-700">عرض السداسي:</label>
            <select 
              value={filterSemester === 'All' ? 'S1' : filterSemester} 
              onChange={(e) => setFilterSemester(e.target.value as any)}
              className="bg-slate-50 border-none rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500"
            >
              <option value="S1">السداسي الأول (S1)</option>
              <option value="S2">السداسي الثاني (S2)</option>
            </select>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(() => {
              const sem = filterSemester === 'All' ? 'S1' : filterSemester;
              const { weeklyHours, overtimeWeekly, baseWeeklyQuota } = calculateHours(currentUser.uid, sem);
              const hasMetQuota = weeklyHours >= baseWeeklyQuota;
              
              return (
                <>
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-2">
                    <p className="text-sm font-bold text-slate-400 uppercase">النصاب الأسبوعي الحالي ({sem})</p>
                    <div className="flex items-end justify-between">
                      <h3 className="text-3xl font-black text-slate-900">{weeklyHours} <span className="text-sm font-bold text-slate-400">سا/أسبوع</span></h3>
                      <span className="text-xs font-bold text-slate-400">النصاب المطلوب: {baseWeeklyQuota} سا</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full transition-all", hasMetQuota ? "bg-emerald-500" : "bg-orange-500")} 
                        style={{ width: `${Math.min(100, (weeklyHours / baseWeeklyQuota) * 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className={cn(
                    "p-6 rounded-3xl border shadow-sm flex flex-col justify-center",
                    hasMetQuota ? "bg-emerald-50 border-emerald-100" : "bg-orange-50 border-orange-100"
                  )}>
                    <div className="flex items-center gap-3">
                      {hasMetQuota ? <CheckCircle2 className="w-8 h-8 text-emerald-600" /> : <AlertTriangle className="w-8 h-8 text-orange-600" />}
                      <div>
                        <h4 className={cn("font-bold", hasMetQuota ? "text-emerald-900" : "text-orange-900")}>
                          {hasMetQuota ? "مستوفي النصاب" : "لم يستوفِ النصاب"}
                        </h4>
                        <p className={cn("text-xs font-medium", hasMetQuota ? "text-emerald-700" : "text-orange-700")}>
                          {hasMetQuota ? `لديك ${overtimeWeekly} ساعة إضافية أسبوعياً` : `ينقصك ${baseWeeklyQuota - weeklyHours} ساعة للوصول للنصاب`}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-600 p-6 rounded-3xl shadow-lg shadow-blue-100 text-white flex flex-col justify-center">
                    <p className="text-xs font-bold text-blue-100 uppercase mb-1">إجمالي الساعات الإضافية (شهرياً)</p>
                    <h3 className="text-3xl font-black">{overtimeWeekly * 4} <span className="text-sm font-bold opacity-60">سا</span></h3>
                    <p className="text-[10px] opacity-80 mt-1">* تقدير مبني على 4 أسابيع عمل</p>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Requests Table (Admin View or Teacher's Own Requests) */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Calculator className="w-6 h-6 text-blue-600" />
          {isAdmin || isViceAdmin ? "طلبات الساعات الإضافية المعلقة" : "طلباتي السابقة"}
        </h2>
        
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {(isAdmin || isViceAdmin) && <th className="p-4 text-sm font-bold text-slate-500">الأستاذ</th>}
                  <th className="p-4 text-sm font-bold text-slate-500">الشهر</th>
                  <th className="p-4 text-sm font-bold text-slate-500 text-center">السداسي</th>
                  <th className="p-4 text-sm font-bold text-slate-500 text-center">الساعات الإضافية</th>
                  <th className="p-4 text-sm font-bold text-slate-500">الحالة</th>
                  <th className="p-4 text-sm font-bold text-slate-500">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map(request => {
                    const teacher = teachers.find(t => t.uid === request.teacherId);
                    return (
                      <tr key={request.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                        {(isAdmin || isViceAdmin) && (
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                                <UserIcon className="w-4 h-4" />
                              </div>
                              <span className="font-bold text-slate-700 text-sm">{teacher?.displayName}</span>
                            </div>
                          </td>
                        )}
                        <td className="p-4 text-sm font-bold text-slate-600">{request.month}</td>
                        <td className="p-4 text-center text-sm font-medium">{request.semester}</td>
                        <td className="p-4 text-center">
                          <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-black">
                            {request.overtimeHours} سا
                          </span>
                        </td>
                        <td className="p-4">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold",
                            request.status === 'Approved' ? "bg-emerald-100 text-emerald-700" :
                            request.status === 'Rejected' ? "bg-red-100 text-red-700" :
                            "bg-orange-100 text-orange-700"
                          )}>
                            {request.status === 'Approved' ? 'تم القبول' : 
                             request.status === 'Rejected' ? 'مرفوض' : 'قيد المراجعة'}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            {(isAdmin || isViceAdmin) && request.status === 'Pending' && (
                              <>
                                <button 
                                  onClick={() => handleApproveRequest(request.id)}
                                  className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                  title="قبول"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => setEditingRequest(request)}
                                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                  title="تعديل"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {(request.status === 'Pending' || isAdmin || isViceAdmin) && (
                              <button 
                                onClick={() => handleDeleteRequest(request.id)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                title="حذف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                {overtimeRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 italic">لا توجد طلبات مسجلة</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Quota Summary Table (Admin Only) */}
      {(isAdmin || isViceAdmin) && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-600" />
            متابعة نصاب الأساتذة
          </h2>
          <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm mb-4">
            <label className="text-sm font-bold text-slate-700">عرض السداسي:</label>
            <select 
              value={filterSemester} 
              onChange={(e) => setFilterSemester(e.target.value as any)}
              className="bg-slate-50 border-none rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">الكل</option>
              <option value="S1">السداسي الأول (S1)</option>
              <option value="S2">السداسي الثاني (S2)</option>
            </select>
          </div>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="p-4 text-sm font-bold text-slate-500">الأستاذ</th>
                    <th className="p-4 text-sm font-bold text-slate-500 text-center">النصاب الأسبوعي</th>
                    <th className="p-4 text-sm font-bold text-slate-500 text-center">الساعات المنجزة</th>
                    <th className="p-4 text-sm font-bold text-slate-500 text-center">الساعات الإضافية</th>
                    <th className="p-4 text-sm font-bold text-slate-500">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map(teacher => {
                    const sem = filterSemester === 'All' ? 'S1' : filterSemester;
                    const { weeklyHours, totalTaughtHours, overtimeWeekly, baseWeeklyQuota } = calculateHours(teacher.uid, sem);
                    const hasMetQuota = weeklyHours >= baseWeeklyQuota;
                    return (
                      <tr key={teacher.uid} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                              <UserIcon className="w-5 h-5" />
                            </div>
                            <span className="font-bold text-slate-900">{teacher.displayName}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center font-bold text-slate-700">{weeklyHours} سا ({sem})</td>
                        <td className="p-4 text-center font-bold text-emerald-600">{totalTaughtHours} سا</td>
                        <td className="p-4 text-center">
                          <span className={cn(
                            "px-3 py-1 rounded-lg text-sm font-black",
                            overtimeWeekly > 0 ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-400"
                          )}>
                            +{overtimeWeekly} سا
                          </span>
                        </td>
                        <td className="p-4">
                          {hasMetQuota ? (
                            <div className="flex items-center gap-2 text-xs font-bold text-emerald-600">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>مستوفي النصاب</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs font-bold text-orange-600">
                              <AlertTriangle className="w-4 h-4" />
                              <span>لم يستوفِ النصاب</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Request Modal */}
      {(showRequestModal || editingRequest) && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">{editingRequest ? 'تعديل طلب' : 'تقديم طلب ساعات إضافية'}</h2>
              <button onClick={() => { setShowRequestModal(false); setEditingRequest(null); }} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddRequest} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الشهر</label>
                <input type="month" name="month" required defaultValue={editingRequest?.month || new Date().toISOString().slice(0, 7)} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">السداسي</label>
                <select name="semester" required defaultValue={editingRequest?.semester || 'S1'} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                  <option value="S1">السداسي الأول (S1)</option>
                  <option value="S2">السداسي الثاني (S2)</option>
                </select>
              </div>
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <p className="text-xs text-blue-700 leading-relaxed">
                  * سيتم حساب الساعات الإضافية تلقائياً بناءً على جدول حصصك الحالي (النصاب: 9 ساعات).
                </p>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                  <Send className="w-4 h-4" />
                  <span>{editingRequest ? 'تحديث' : 'إرسال الطلب'}</span>
                </button>
                <button type="button" onClick={() => { setShowRequestModal(false); setEditingRequest(null); }} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 flex items-start gap-4">
        <AlertCircle className="w-6 h-6 text-blue-600 mt-1" />
        <div>
          <h4 className="font-bold text-blue-900 mb-1">معلومات حول الحساب</h4>
          <p className="text-sm text-blue-700 leading-relaxed">
            النصاب الأسبوعي القانوني هو 9 ساعات. يتم احتساب المحاضرة بـ 2.25 ساعة، والأعمال الموجهة والتطبيقية بـ 1.5 ساعة. الساعات الإضافية هي ما زاد عن النصاب الأسبوعي.
          </p>
        </div>
      </div>
    </div>
  );
}

function Users(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
