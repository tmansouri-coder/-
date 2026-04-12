import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, addDoc, deleteDoc, doc, updateDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { User, CertificateRequest, Project, SessionType, Cycle, Level, Specialty, Module } from '../types';
import { FileText, Download, User as UserIcon, ShieldCheck, Award, Printer, Plus, Trash2, Check, X, Calendar, MapPin, BookOpen, Users as UsersIcon, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { jsPDF } from 'jspdf';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import toast from 'react-hot-toast';
import { useNotifications } from '../contexts/NotificationContext';

export default function Certificates() {
  const { user, isAdmin, isViceAdmin } = useAuth();
  const { sendNotification } = useNotifications();
  const { selectedYear } = useAcademicYear();
  const [requests, setRequests] = useState<CertificateRequest[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestType, setRequestType] = useState<'Teaching' | 'Supervision' | null>(null);

  // Form states
  const [teachingData, setTeachingData] = useState({
    dateOfBirth: '',
    placeOfBirth: '',
    years: [{ year: '', moduleName: '', type: 'Cours' as SessionType, cycleId: '', levelId: '', specialtyId: '' }]
  });
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const canApprove = user?.role === 'admin' || user?.role === 'vice_admin';
  const canRequest = user?.role === 'teacher' || user?.role === 'specialty_manager';

  useEffect(() => {
    if (!user) return;

    // Fetch requests
    const q = canApprove
      ? query(collection(db, 'certificateRequests'), where('academicYear', '==', selectedYear), orderBy('createdAt', 'desc'))
      : query(collection(db, 'certificateRequests'), where('teacherId', '==', user.uid), where('academicYear', '==', selectedYear), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as CertificateRequest)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching requests:", error);
      setLoading(false);
    });

    // Fetch teachers for admin
    if (canApprove) {
      getDocs(collection(db, 'users')).then(snap => {
        setTeachers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as User)));
      });
    }

    // Fetch teacher's projects for supervision certificate
    if (canRequest) {
      const pq = query(collection(db, 'projects'), where('supervisorId', '==', user.uid), where('academicYear', '==', selectedYear));
      getDocs(pq).then(snap => {
        setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      });

      // Fetch metadata for teaching certificate
      Promise.all([
        getDocs(collection(db, 'cycles')),
        getDocs(collection(db, 'levels')),
        getDocs(collection(db, 'specialties')),
        getDocs(collection(db, 'modules'))
      ]).then(([cyclesSnap, levelsSnap, specialtiesSnap, modulesSnap]) => {
        setCycles(cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle)));
        setLevels(levelsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Level)));
        setSpecialties(specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty)));
        setModules(modulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Module)));
      });
    }

    return () => unsubscribe();
  }, [user, isAdmin, isViceAdmin]);

  const handleAddYear = () => {
    setTeachingData(prev => ({
      ...prev,
      years: [...prev.years, { year: '', moduleName: '', type: 'Cours', cycleId: '', levelId: '', specialtyId: '' }]
    }));
  };

  const handleRemoveYear = (index: number) => {
    setTeachingData(prev => ({
      ...prev,
      years: prev.years.filter((_, i) => i !== index)
    }));
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !requestType) return;

    try {
      const newRequest: Partial<CertificateRequest> = {
        teacherId: user.uid,
        type: requestType,
        status: 'Pending',
        academicYear: selectedYear,
        createdAt: new Date().toISOString(),
      };

      if (requestType === 'Teaching') {
        newRequest.teachingData = teachingData;
      } else {
        const project = projects.find(p => p.id === selectedProjectId);
        if (!project) {
          toast.error('يرجى اختيار المشروع');
          return;
        }
        newRequest.supervisionData = {
          projectId: project.id,
          projectTitle: project.title,
          students: project.students,
          academicYear: new Date(project.createdAt).getFullYear().toString()
        };
      }

      await addDoc(collection(db, 'certificateRequests'), newRequest);
      toast.success('تم إرسال الطلب بنجاح');
      setShowRequestModal(false);

      // Notify admins
      const adminSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
      adminSnap.docs.forEach(adminDoc => {
        sendNotification(
          adminDoc.id,
          'طلب شهادة جديد',
          `قام الأستاذ ${user.displayName} بطلب شهادة ${requestType === 'Teaching' ? 'تدريس' : 'تأطير'}.`,
          'info',
          '/certificates'
        );
      });
      setRequestType(null);
      setTeachingData({
        dateOfBirth: '',
        placeOfBirth: '',
        years: [{ year: '', moduleName: '', type: 'Cours', cycleId: '', levelId: '', specialtyId: '' }]
      });
    } catch (error) {
      toast.error('فشل في إرسال الطلب');
    }
  };

  const handleUpdateStatus = async (id: string, status: 'Approved' | 'Rejected') => {
    try {
      await updateDoc(doc(db, 'certificateRequests', id), { status });
      toast.success(`تم ${status === 'Approved' ? 'قبول' : 'رفض'} الطلب`);

      // Notify teacher
      const request = requests.find(r => r.id === id);
      if (request) {
        sendNotification(
          request.teacherId,
          status === 'Approved' ? 'تمت الموافقة على طلب الشهادة' : 'تم رفض طلب الشهادة',
          `طلبك للحصول على شهادة ${request.type === 'Teaching' ? 'تدريس' : 'تأطير'} قد تم ${status === 'Approved' ? 'قبوله' : 'رفضه'}.`,
          status === 'Approved' ? 'success' : 'error',
          '/certificates'
        );
      }
    } catch (error) {
      toast.error('فشل في تحديث الحالة');
    }
  };

  const generatePDF = (request: CertificateRequest) => {
    const teacher = teachers.find(t => t.uid === request.teacherId) || user;
    const doc = new jsPDF('p', 'mm', 'a4');
    
    // Add Arabic font support would be needed here for real Arabic PDF
    // For now using standard text as placeholder
    doc.setFontSize(20);
    doc.text('الجمهورية الجزائرية الديمقراطية الشعبية', 105, 20, { align: 'center' });
    doc.text('وزارة التعليم العالي والبحث العلمي', 105, 30, { align: 'center' });
    doc.text('جامعة عمار ثليجي - الأغواط', 105, 40, { align: 'center' });
    
    doc.setFontSize(24);
    doc.text(request.type === 'Teaching' ? 'شهادة تدريس' : 'شهادة تأطير', 105, 70, { align: 'center' });
    
    doc.setFontSize(14);
    if (request.type === 'Teaching' && request.teachingData) {
      doc.text(`يشهد رئيس قسم الهندسة الميكانيكية أن السيد(ة): ${teacher?.displayName}`, 20, 100);
      doc.text(`المولود(ة) بتاريخ: ${request.teachingData.dateOfBirth} بـ: ${request.teachingData.placeOfBirth}`, 20, 110);
      doc.text(`قد قام بتدريس المقاييس التالية:`, 20, 120);
      
      let y = 130;
      request.teachingData.years.forEach((item, i) => {
        doc.text(`${i+1}. السنة: ${item.year} - المقياس: ${item.moduleName} (${item.type})`, 30, y);
        y += 10;
      });
    } else if (request.type === 'Supervision' && request.supervisionData) {
      doc.text(`يشهد رئيس قسم الهندسة الميكانيكية أن السيد(ة): ${teacher?.displayName}`, 20, 100);
      doc.text(`قد أشرف على مذكرة التخرج لنيل شهادة الليسانس:`, 20, 110);
      doc.text(`عنوان المشروع: ${request.supervisionData.projectTitle}`, 20, 120);
      doc.text(`الطلبة: ${request.supervisionData.students.join(' - ')}`, 20, 130);
      doc.text(`السنة الجامعية: ${request.supervisionData.academicYear}`, 20, 140);
    }

    doc.text(`حرر بـ: الأغواط في ${new Date().toLocaleDateString()}`, 140, 250);
    doc.text('رئيس القسم', 150, 260);
    
    doc.save(`${request.type}-Certificate-${teacher?.displayName}.pdf`);
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">بوابة الشهادات</h1>
          <p className="text-slate-500">طلب واستخراج شهادات التدريس والتأطير</p>
        </div>
        {canRequest && (
          <button 
            onClick={() => setShowRequestModal(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
          >
            <Plus className="w-5 h-5" />
            طلب شهادة جديدة
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6">
        {requests.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-dashed border-slate-200 text-center space-y-4">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium">لا توجد طلبات شهادات حالياً</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-4 text-sm font-bold text-slate-600">نوع الشهادة</th>
                  {canApprove && <th className="px-6 py-4 text-sm font-bold text-slate-600">الأستاذ</th>}
                  <th className="px-6 py-4 text-sm font-bold text-slate-600">التاريخ</th>
                  <th className="px-6 py-4 text-sm font-bold text-slate-600">الحالة</th>
                  <th className="px-6 py-4 text-sm font-bold text-slate-600">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {requests.map(request => (
                  <tr key={request.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center",
                          request.type === 'Teaching' ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
                        )}>
                          {request.type === 'Teaching' ? <BookOpen className="w-5 h-5" /> : <Award className="w-5 h-5" />}
                        </div>
                        <span className="font-bold text-slate-700">
                          {request.type === 'Teaching' ? 'شهادة تدريس' : 'شهادة تأطير'}
                        </span>
                      </div>
                    </td>
                    {canApprove && (
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-slate-600">
                          {teachers.find(t => t.uid === request.teacherId)?.displayName || 'غير معروف'}
                        </span>
                      </td>
                    )}
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-500">
                        {new Date(request.createdAt).toLocaleDateString('ar-DZ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        request.status === 'Approved' ? "bg-emerald-100 text-emerald-700" :
                        request.status === 'Rejected' ? "bg-red-100 text-red-700" :
                        "bg-amber-100 text-amber-700"
                      )}>
                        {request.status === 'Approved' ? 'مقبول' : 
                         request.status === 'Rejected' ? 'مرفوض' : 'قيد الانتظار'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {request.status === 'Approved' && (
                          <button 
                            onClick={() => generatePDF(request)}
                            className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                            title="تحميل الشهادة"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}
                        {canApprove && request.status === 'Pending' && (
                          <>
                            <button 
                              onClick={() => handleUpdateStatus(request.id, 'Approved')}
                              className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
                              title="قبول"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleUpdateStatus(request.id, 'Rejected')}
                              className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                              title="رفض"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Request Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">طلب شهادة جديدة</h2>
              <button onClick={() => { setShowRequestModal(false); setRequestType(null); }} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              {!requestType ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button 
                    onClick={() => setRequestType('Teaching')}
                    className="p-6 rounded-3xl border-2 border-slate-100 hover:border-blue-500 hover:bg-blue-50 transition-all text-center space-y-4 group"
                  >
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                      <BookOpen className="w-8 h-8" />
                    </div>
                    <h3 className="font-bold text-slate-900">شهادة تدريس</h3>
                    <p className="text-xs text-slate-500">طلب شهادة تثبت المقاييس التي قمت بتدريسها</p>
                  </button>
                  <button 
                    onClick={() => setRequestType('Supervision')}
                    className="p-6 rounded-3xl border-2 border-slate-100 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-center space-y-4 group"
                  >
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                      <Award className="w-8 h-8" />
                    </div>
                    <h3 className="font-bold text-slate-900">شهادة تأطير (ليسانس)</h3>
                    <p className="text-xs text-slate-500">طلب شهادة تأطير لمشاريع التخرج</p>
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitRequest} className="space-y-6">
                  {requestType === 'Teaching' ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4" /> تاريخ الازدياد
                          </label>
                          <input 
                            type="date" 
                            required 
                            value={teachingData.dateOfBirth}
                            onChange={(e) => setTeachingData(prev => ({ ...prev, dateOfBirth: e.target.value }))}
                            className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <MapPin className="w-4 h-4" /> مكان الازدياد
                          </label>
                          <input 
                            type="text" 
                            required 
                            placeholder="مثال: الأغواط"
                            value={teachingData.placeOfBirth}
                            onChange={(e) => setTeachingData(prev => ({ ...prev, placeOfBirth: e.target.value }))}
                            className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-bold text-slate-700">المقاييس والسنوات</label>
                          <button 
                            type="button"
                            onClick={handleAddYear}
                            className="text-blue-600 text-xs font-bold flex items-center gap-1 hover:underline"
                          >
                            <Plus className="w-3 h-3" /> إضافة سنة/مقياس
                          </button>
                        </div>
                        <div className="space-y-3">
                          {teachingData.years.map((item, index) => (
                            <div key={index} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3 relative group/item">
                              {teachingData.years.length > 1 && (
                                <button 
                                  type="button"
                                  onClick={() => handleRemoveYear(index)}
                                  className="absolute left-2 top-2 p-1 text-red-400 hover:text-red-600 opacity-0 group-hover/item:opacity-100 transition-opacity"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500">السنة الجامعية</label>
                                  <input 
                                    placeholder="مثال: 2023/2024" 
                                    required 
                                    value={item.year}
                                    onChange={(e) => {
                                      const newYears = [...teachingData.years];
                                      newYears[index].year = e.target.value;
                                      setTeachingData(prev => ({ ...prev, years: newYears }));
                                    }}
                                    className="w-full bg-white border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" 
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500">الطور</label>
                                  <select 
                                    required 
                                    value={item.cycleId}
                                    onChange={(e) => {
                                      const newYears = [...teachingData.years];
                                      newYears[index].cycleId = e.target.value;
                                      newYears[index].levelId = '';
                                      newYears[index].specialtyId = '';
                                      newYears[index].moduleName = '';
                                      setTeachingData(prev => ({ ...prev, years: newYears }));
                                    }}
                                    className="w-full bg-white border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="">اختر الطور...</option>
                                    {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500">المستوى</label>
                                  <select 
                                    required 
                                    value={item.levelId}
                                    onChange={(e) => {
                                      const newYears = [...teachingData.years];
                                      newYears[index].levelId = e.target.value;
                                      newYears[index].specialtyId = '';
                                      newYears[index].moduleName = '';
                                      setTeachingData(prev => ({ ...prev, years: newYears }));
                                    }}
                                    className="w-full bg-white border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                                    disabled={!item.cycleId}
                                  >
                                    <option value="">اختر المستوى...</option>
                                    {levels.filter(l => l.cycleId === item.cycleId).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500">التخصص</label>
                                  <select 
                                    required 
                                    value={item.specialtyId}
                                    onChange={(e) => {
                                      const newYears = [...teachingData.years];
                                      newYears[index].specialtyId = e.target.value;
                                      newYears[index].moduleName = '';
                                      setTeachingData(prev => ({ ...prev, years: newYears }));
                                    }}
                                    className="w-full bg-white border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                                    disabled={!item.levelId}
                                  >
                                    <option value="">اختر التخصص...</option>
                                    {specialties.filter(s => s.levelId === item.levelId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500">المقياس</label>
                                  <select 
                                    required 
                                    value={item.moduleName}
                                    onChange={(e) => {
                                      const newYears = [...teachingData.years];
                                      newYears[index].moduleName = e.target.value;
                                      setTeachingData(prev => ({ ...prev, years: newYears }));
                                    }}
                                    className="w-full bg-white border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                                    disabled={!item.specialtyId}
                                  >
                                    <option value="">اختر المقياس...</option>
                                    {modules.filter(m => m.specialtyId === item.specialtyId).map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-500">نوع الحصة</label>
                                  <select 
                                    value={item.type}
                                    onChange={(e) => {
                                      const newYears = [...teachingData.years];
                                      newYears[index].type = e.target.value as SessionType;
                                      setTeachingData(prev => ({ ...prev, years: newYears }));
                                    }}
                                    className="w-full bg-white border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="Cours">محاضرة</option>
                                    <option value="TD">TD</option>
                                    <option value="TP">TP</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <Award className="w-4 h-4" /> اختر المشروع المراد استخراج شهادة له
                      </label>
                      {projects.length === 0 ? (
                        <div className="p-8 bg-amber-50 border border-amber-100 rounded-2xl text-center">
                          <p className="text-sm text-amber-700 font-medium">لم يتم العثور على مشاريع مسجلة باسمك</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {projects.map(project => (
                            <label key={project.id} className={cn(
                              "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer",
                              selectedProjectId === project.id ? "border-emerald-500 bg-emerald-50" : "border-slate-100 hover:border-slate-200"
                            )}>
                              <input 
                                type="radio" 
                                name="project" 
                                value={project.id} 
                                onChange={() => setSelectedProjectId(project.id)}
                                className="w-4 h-4 text-emerald-600" 
                              />
                              <div className="flex-1">
                                <p className="font-bold text-slate-900">{project.title}</p>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <UsersIcon className="w-3 h-3" /> {project.students.join(' - ')}
                                  </span>
                                  <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> {new Date(project.createdAt).getFullYear()}
                                  </span>
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-4 flex gap-3">
                    <button 
                      type="submit" 
                      disabled={requestType === 'Supervision' && projects.length === 0}
                      className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50"
                    >
                      إرسال الطلب
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setRequestType(null)}
                      className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
                    >
                      رجوع
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
