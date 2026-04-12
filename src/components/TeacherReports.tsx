import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { TeacherReport, User } from '../types';
import { 
  MessageSquare, Plus, Send, Clock, CheckCircle2, 
  AlertCircle, X, User as UserIcon, Filter, Search
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNotifications } from '../contexts/NotificationContext';

export default function TeacherReports() {
  const { t } = useTranslation();
  const { user, isAdmin, isViceAdmin } = useAuth();
  const { sendNotification } = useNotifications();
  const { selectedYear } = useAcademicYear();
  const [reports, setReports] = useState<TeacherReport[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<TeacherReport['status'] | 'All'>('All');
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [adminResponse, setAdminResponse] = useState('');

  useEffect(() => {
    if (!user) return;

    const q = (isAdmin || isViceAdmin)
      ? query(collection(db, 'teacherReports'), where('academicYear', '==', selectedYear), orderBy('createdAt', 'desc'))
      : query(collection(db, 'teacherReports'), where('teacherId', '==', user.uid), where('academicYear', '==', selectedYear), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as TeacherReport)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'teacherReports');
      setLoading(false);
    });

    if (isAdmin || isViceAdmin) {
      getDocs(collection(db, 'users')).then(snap => {
        setTeachers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as User)));
      });
    }

    return () => unsubscribe();
  }, [user, selectedYear, isAdmin, isViceAdmin]);

  const handleAddReport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const reportData: Omit<TeacherReport, 'id'> = {
      teacherId: user?.uid || '',
      type: formData.get('type') as TeacherReport['type'],
      subject: formData.get('subject') as string,
      content: formData.get('content') as string,
      status: 'Pending',
      academicYear: selectedYear,
      createdAt: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, 'teacherReports'), reportData);
      setShowAddModal(false);
      toast.success(t('report_sent_success', 'تم إرسال البلاغ/الطلب بنجاح'));

      // Notify admins
      const adminSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
      adminSnap.docs.forEach(adminDoc => {
        sendNotification(
          adminDoc.id,
          'بلاغ جديد من أستاذ',
          `قام الأستاذ ${user?.displayName} بإرسال بلاغ جديد: ${reportData.subject}`,
          'warning',
          '/reports'
        );
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'teacherReports');
    }
  };

  const handleUpdateStatus = async (reportId: string, newStatus: TeacherReport['status'], response?: string) => {
    try {
      const updateData: any = { status: newStatus };
      if (response !== undefined) updateData.response = response;
      
      await updateDoc(doc(db, 'teacherReports', reportId), updateData);
      
      // Notify teacher
      const report = reports.find(r => r.id === reportId);
      if (report) {
        sendNotification(
          report.teacherId,
          'تحديث حالة بلاغك',
          `تم تحديث حالة بلاغك بخصوص: ${report.subject} إلى ${newStatus}`,
          newStatus === 'Resolved' ? 'success' : 'info',
          '/reports'
        );
      }

      setRespondingTo(null);
      setAdminResponse('');
      toast.success(t('status_updated', 'تم تحديث حالة البلاغ'));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'teacherReports/' + reportId);
    }
  };

  const filteredReports = reports.filter(r => filterStatus === 'All' || r.status === filterStatus);

  if (loading) return <div className="p-8 text-center">{t('loading')}</div>;

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('reports')}</h1>
          <p className="text-slate-500">{t('reports_description', 'تبليغ عن مشكلة أو تقديم طلب للإدارة')}</p>
        </div>
        {!isAdmin && !isViceAdmin && (
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
          >
            <Plus className="w-4 h-4" />
            <span>{t('new_report')}</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {['All', 'Pending', 'InProgress', 'Resolved'].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status as any)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap border",
              filterStatus === status 
                ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100" 
                : "bg-white text-slate-500 border-slate-200 hover:border-blue-200"
            )}
          >
            {status === 'All' ? t('all', 'الكل') : 
             status === 'Pending' ? t('pending') : 
             status === 'InProgress' ? t('in_progress') : 
             t('resolved')}
          </button>
        ))}
      </div>

      {/* Reports List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredReports.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-dashed border-slate-200 text-center">
            <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">{t('no_reports', 'لا توجد بلاغات أو طلبات حالياً')}</p>
          </div>
        ) : (
          filteredReports.map((report) => {
            const teacher = teachers.find(t => t.uid === report.teacherId);
            return (
              <div key={report.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-all">
                <div className="p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center",
                        report.type === 'Problem' ? "bg-red-50 text-red-600" :
                        report.type === 'Request' ? "bg-blue-50 text-blue-600" :
                        "bg-slate-50 text-slate-600"
                      )}>
                        {report.type === 'Problem' ? <AlertCircle className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">{report.subject}</h3>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(report.createdAt).toLocaleString('ar-DZ')}</span>
                          {(isAdmin || isViceAdmin) && (
                            <>
                              <span className="mx-1">•</span>
                              <UserIcon className="w-3 h-3" />
                              <span>{teacher?.displayName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      report.status === 'Resolved' ? "bg-emerald-100 text-emerald-700" :
                      report.status === 'InProgress' ? "bg-blue-100 text-blue-700" :
                      "bg-amber-100 text-amber-700"
                    )}>
                      {report.status === 'Pending' ? t('pending') : 
                       report.status === 'InProgress' ? t('in_progress') : 
                       t('resolved')}
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-xl text-sm text-slate-700 leading-relaxed">
                    {report.content}
                  </div>

                  {report.response && respondingTo !== report.id && (
                    <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-2">
                      <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                        <CheckCircle2 className="w-4 h-4" />
                        {t('report_response')}:
                      </div>
                      <p className="text-sm text-emerald-800">{report.response}</p>
                    </div>
                  )}

                  {(isAdmin || isViceAdmin) && (
                    <div className="space-y-4 pt-2">
                      {respondingTo === report.id ? (
                        <div className="space-y-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                          <label className="text-xs font-bold text-blue-600 uppercase">{t('report_response')}</label>
                          <textarea 
                            value={adminResponse}
                            onChange={(e) => setAdminResponse(e.target.value)}
                            placeholder={t('write_response_placeholder', 'اكتب الرد هنا...')}
                            className="w-full bg-white border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-sm"
                            rows={3}
                          />
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleUpdateStatus(report.id, 'Resolved', adminResponse)}
                              disabled={!adminResponse.trim()}
                              className="flex-1 bg-emerald-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all disabled:opacity-50"
                            >
                              {t('resolve_with_response', 'تم الحل مع الرد')}
                            </button>
                            <button 
                              onClick={() => { setRespondingTo(null); setAdminResponse(''); }}
                              className="px-4 bg-white text-slate-600 py-2 rounded-xl text-sm font-bold border border-slate-200 hover:bg-slate-50 transition-all"
                            >
                              {t('cancel')}
                            </button>
                          </div>
                        </div>
                      ) : report.status !== 'Resolved' && (
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              setRespondingTo(report.id);
                              setAdminResponse(report.response || '');
                            }}
                            className="flex-1 bg-emerald-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all"
                          >
                            {report.response ? t('edit_response', 'تعديل الرد') : t('add_response', 'إضافة رد وحل')}
                          </button>
                          {report.status === 'Pending' && (
                            <button 
                              onClick={() => handleUpdateStatus(report.id, 'InProgress')}
                              className="flex-1 bg-blue-600 text-white py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all"
                            >
                              {t('start_processing', 'بدء المعالجة')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">{t('new_report')}</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            
            <form onSubmit={handleAddReport} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">{t('report_type')}</label>
                <select name="type" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                  <option value="Problem">{t('problem')}</option>
                  <option value="Request">{t('request')}</option>
                  <option value="Other">{t('other')}</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">{t('report_subject')}</label>
                <input name="subject" required placeholder={t('subject_placeholder', 'عنوان مختصر...')} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">{t('report_content')}</label>
                <textarea name="content" required placeholder={t('content_placeholder', 'اشرح المشكلة أو الطلب بالتفصيل...')} rows={4} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"></textarea>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">{t('send_data')}</button>
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">{t('cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

