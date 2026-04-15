import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { FieldVisit, Specialty, Level, Module, User, Cycle } from '../types';
import { 
  Bus, Plus, Search, Filter, Calendar, User as UserIcon, 
  CheckCircle2, Clock, AlertCircle, X, MapPin,
  Building2, Users, FileText, MoreVertical, Trash2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import toast from 'react-hot-toast';
import { useNotifications } from '../contexts/NotificationContext';
import { motion, AnimatePresence } from 'motion/react';

export default function FieldVisits() {
  const { user, isAdmin, isViceAdmin, isSpecialtyManager, isTeacher } = useAuth();
  const { sendNotification } = useNotifications();
  const { selectedYear } = useAcademicYear();
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FieldVisit['status'] | 'All'>('All');
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  // Form states
  const [selectedCycle, setSelectedCycle] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('');
  const [selectedModule, setSelectedModule] = useState('');
  const [selectedSupervisors, setSelectedSupervisors] = useState<string[]>([]);
  const [customSupervisor, setCustomSupervisor] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [visitsSnap, specialtiesSnap, levelsSnap, cyclesSnap, modulesSnap, usersSnap] = await Promise.all([
          getDocs(query(collection(db, 'fieldVisits'), where('academicYear', '==', selectedYear), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'specialties')),
          getDocs(collection(db, 'levels')),
          getDocs(collection(db, 'cycles')),
          getDocs(collection(db, 'modules')),
          getDocs(query(collection(db, 'users'), where('role', 'in', ['admin', 'vice_admin', 'teacher', 'specialty_manager'])))
        ]);

        setVisits(visitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as FieldVisit)));
        setSpecialties(specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty)));
        setLevels(levelsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Level)));
        setCycles(cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle)));
        setModules(modulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Module)));
        setTeachers(usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as User)));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'fieldVisits');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleAddVisit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const visitData: Omit<FieldVisit, 'id'> = {
      teacherId: user?.uid || '',
      destination: formData.get('destination') as string,
      moduleId: selectedModule,
      specialtyId: selectedSpecialty,
      levelId: selectedLevel,
      proposedDate: formData.get('proposedDate') as string,
      studentCount: Number(formData.get('studentCount')),
      supervisors: selectedSupervisors,
      status: 'Pending',
      academicYear: selectedYear,
      createdAt: new Date().toISOString(),
    };

    try {
      const docRef = await addDoc(collection(db, 'fieldVisits'), visitData);
      setVisits(prev => [{ id: docRef.id, ...visitData } as FieldVisit, ...prev]);
      setShowAddModal(false);
      
      // Notify admins
      const adminSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
      adminSnap.docs.forEach(adminDoc => {
        sendNotification(
          adminDoc.id,
          'طلب زيارة ميدانية جديد',
          `قام الأستاذ ${user?.displayName} بطلب زيارة ميدانية إلى ${visitData.destination}.`,
          'info',
          '/field_visits'
        );
      });

      setSelectedCycle('');
      setSelectedLevel('');
      setSelectedSpecialty('');
      setSelectedModule('');
      setSelectedSupervisors([]);
      setCustomSupervisor('');
      toast.success('تم إرسال طلب الزيارة بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'fieldVisits');
    }
  };

  const handleUpdateStatus = async (visitId: string, newStatus: FieldVisit['status']) => {
    try {
      await updateDoc(doc(db, 'fieldVisits', visitId), { status: newStatus });
      setVisits(prev => prev.map(v => v.id === visitId ? { ...v, status: newStatus } : v));
      toast.success('تم تحديث حالة الطلب');

      // Notify teacher
      const visit = visits.find(v => v.id === visitId);
      if (visit) {
        sendNotification(
          visit.teacherId,
          newStatus === 'Approved' ? 'تمت الموافقة على الزيارة الميدانية' : 'تم رفض الزيارة الميدانية',
          `طلبك للزيارة الميدانية إلى ${visit.destination} قد تم ${newStatus === 'Approved' ? 'قبوله' : 'رفضه'}.`,
          newStatus === 'Approved' ? 'success' : 'error',
          '/field_visits'
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'fieldVisits/' + visitId);
    }
  };

  const handleDeleteVisit = async (visitId: string) => {
    try {
      await deleteDoc(doc(db, 'fieldVisits', visitId));
      setVisits(prev => prev.filter(v => v.id !== visitId));
      setItemToDelete(null);
      toast.success('تم حذف الطلب بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'fieldVisits/' + visitId);
    }
  };

  const filteredVisits = visits.filter(v => {
    const matchesStatus = filterStatus === 'All' || v.status === filterStatus;
    
    if (isAdmin || isViceAdmin) return matchesStatus;
    if (isSpecialtyManager) {
      return matchesStatus && (user?.specialtyIds?.includes(v.specialtyId) || v.teacherId === user?.uid);
    }
    return matchesStatus && v.teacherId === user?.uid;
  });

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-10 pb-12" dir="rtl">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">طلبات الزيارات الميدانية</h1>
          <p className="text-slate-500 font-medium">تنظيم ومتابعة الزيارات العلمية للمؤسسات الصناعية</p>
        </div>
        {(isTeacher || isSpecialtyManager) && (
          <button 
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span>طلب زيارة جديدة</span>
          </button>
        )}
      </div>

      {/* Filters Bento */}
      <div className="bg-white p-2 rounded-3xl border border-slate-100 shadow-sm flex flex-wrap gap-2">
        {['All', 'Pending', 'Approved', 'Rejected'].map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status as any)}
            className={cn(
              "px-6 py-3 rounded-2xl text-sm font-black transition-all whitespace-nowrap uppercase tracking-widest",
              filterStatus === status 
                ? "bg-blue-600 text-white shadow-xl shadow-blue-100" 
                : "bg-transparent text-slate-500 hover:bg-slate-50"
            )}
          >
            {status === 'All' ? 'الكل' : status === 'Pending' ? 'قيد الانتظار' : status === 'Approved' ? 'مقبولة' : 'مرفوضة'}
          </button>
        ))}
      </div>

      {/* Visits Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {filteredVisits.map((visit, i) => {
          const specialty = specialties.find(s => s.id === visit.specialtyId);
          const level = levels.find(l => l.id === visit.levelId);
          const module = modules.find(m => m.id === visit.moduleId);
          const teacher = teachers.find(t => t.uid === visit.teacherId);

          return (
            <motion.div 
              key={visit.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="group bg-white rounded-4xl border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-slate-200/50 transition-all duration-500 overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-5">
                    <div className={cn(
                      "w-16 h-16 rounded-3xl flex items-center justify-center transition-transform duration-500 group-hover:scale-110",
                      visit.status === 'Approved' ? "bg-emerald-50 text-emerald-600" :
                      visit.status === 'Rejected' ? "bg-red-50 text-red-600" :
                      "bg-amber-50 text-amber-600"
                    )}>
                      <Building2 className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="text-xl font-extrabold text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors">{visit.destination}</h3>
                      <div className="flex items-center gap-2 text-sm text-slate-400 font-bold mt-1">
                        <Calendar className="w-4 h-4" />
                        <span>{visit.proposedDate}</span>
                      </div>
                    </div>
                  </div>
                  <div className={cn(
                    "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest",
                    visit.status === 'Approved' ? "bg-emerald-100 text-emerald-700" :
                    visit.status === 'Rejected' ? "bg-red-100 text-red-700" :
                    "bg-amber-100 text-amber-700"
                  )}>
                    {visit.status === 'Pending' ? 'قيد الانتظار' : visit.status === 'Approved' ? 'مقبولة' : 'مرفوضة'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="space-y-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المقياس والتخصص</span>
                    <p className="text-sm font-extrabold text-slate-700 leading-tight">{module?.name || '---'}</p>
                    <p className="text-xs font-bold text-slate-500">{specialty?.name} • {level?.name}</p>
                  </div>
                  <div className="space-y-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">تعداد الطلبة</span>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                        <Users className="w-4 h-4" />
                      </div>
                      <p className="text-lg font-black text-slate-900">{visit.studentCount} <span className="text-xs text-slate-400 font-bold">طالب</span></p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" /> المرافقون
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {visit.supervisors.map((s, i) => (
                      <span key={i} className="px-4 py-2 bg-white border border-slate-100 text-slate-600 rounded-2xl text-xs font-bold shadow-sm group-hover:border-blue-100 transition-colors">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:border-blue-100 group-hover:text-blue-500 transition-all">
                      <UserIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">صاحب الطلب</p>
                      <p className="text-sm font-black text-slate-700">{teacher?.displayName}</p>
                    </div>
                  </div>
                  
                  {(isAdmin || isViceAdmin || isSpecialtyManager) && (
                    <div className="flex gap-2">
                      {visit.status === 'Pending' && (
                        <>
                          <button 
                            onClick={() => handleUpdateStatus(visit.id, 'Approved')}
                            className="w-12 h-12 flex items-center justify-center bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                            title="قبول"
                          >
                            <CheckCircle2 className="w-6 h-6" />
                          </button>
                          <button 
                            onClick={() => handleUpdateStatus(visit.id, 'Rejected')}
                            className="w-12 h-12 flex items-center justify-center bg-red-50 text-red-600 rounded-2xl hover:bg-red-600 hover:text-white transition-all shadow-sm"
                            title="رفض"
                          >
                            <X className="w-6 h-6" />
                          </button>
                        </>
                      )}
                      {(isAdmin || isViceAdmin) && (
                        <button 
                          onClick={() => setItemToDelete(visit.id)}
                          className="w-12 h-12 flex items-center justify-center bg-slate-50 text-slate-400 rounded-2xl hover:bg-red-600 hover:text-white transition-all shadow-sm"
                          title="حذف"
                        >
                          <Trash2 className="w-6 h-6" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <Bus className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">طلب زيارة ميدانية</h2>
                  <p className="text-xs text-slate-500">أدخل تفاصيل الزيارة المقترحة</p>
                </div>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            
            <form onSubmit={handleAddVisit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الجهة المستقبلة</label>
                  <div className="relative">
                    <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      name="destination" 
                      required 
                      placeholder="اسم الشركة أو المؤسسة"
                      className="w-full pr-10 pl-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">التاريخ المقترح</label>
                  <input 
                    type="date" 
                    name="proposedDate" 
                    required 
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الطور</label>
                  <select 
                    required 
                    value={selectedCycle}
                    onChange={(e) => {
                      setSelectedCycle(e.target.value);
                      setSelectedLevel('');
                      setSelectedSpecialty('');
                      setSelectedModule('');
                    }}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">اختر الطور</option>
                    {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">المستوى الدراسي</label>
                  <select 
                    required 
                    value={selectedLevel}
                    onChange={(e) => {
                      setSelectedLevel(e.target.value);
                      setSelectedSpecialty('');
                      setSelectedModule('');
                    }}
                    disabled={!selectedCycle}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">اختر المستوى</option>
                    {levels.filter(l => l.cycleId === selectedCycle).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">التخصص</label>
                  <select 
                    required 
                    value={selectedSpecialty}
                    onChange={(e) => {
                      setSelectedSpecialty(e.target.value);
                      setSelectedModule('');
                    }}
                    disabled={!selectedLevel}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">اختر التخصص</option>
                    {specialties.filter(s => s.levelId === selectedLevel).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">المقياس (Module)</label>
                  <select 
                    required 
                    value={selectedModule}
                    onChange={(e) => setSelectedModule(e.target.value)}
                    disabled={!selectedSpecialty}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">اختر المقياس</option>
                    {modules.filter(m => m.specialtyId === selectedSpecialty).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تعداد الطلبة</label>
                  <div className="relative">
                    <Users className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="number" 
                      name="studentCount" 
                      required 
                      min="1"
                      placeholder="عدد الطلبة"
                      className="w-full pr-10 pl-4 py-3 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-500" 
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-sm font-bold text-slate-700">المرافقون</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedSupervisors.map((s, i) => (
                    <span key={i} className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-bold flex items-center gap-2 border border-blue-100">
                      {s}
                      <button 
                        type="button"
                        onClick={() => setSelectedSupervisors(prev => prev.filter((_, idx) => idx !== i))}
                        className="hover:text-blue-800"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">اختر من القائمة</label>
                    <select 
                      onChange={(e) => {
                        if (e.target.value && !selectedSupervisors.includes(e.target.value)) {
                          setSelectedSupervisors(prev => [...prev, e.target.value]);
                        }
                        e.target.value = '';
                      }}
                      className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">اختر أستاذاً...</option>
                      {teachers.map(t => <option key={t.uid} value={t.displayName}>{t.displayName}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">أو أضف يدوياً</label>
                    <div className="flex gap-2">
                      <input 
                        value={customSupervisor}
                        onChange={(e) => setCustomSupervisor(e.target.value)}
                        placeholder="اسم المرافق..."
                        className="flex-1 bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          if (customSupervisor.trim() && !selectedSupervisors.includes(customSupervisor.trim())) {
                            setSelectedSupervisors(prev => [...prev, customSupervisor.trim()]);
                            setCustomSupervisor('');
                          }
                        }}
                        className="p-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-all"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">إرسال الطلب</button>
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-10 h-10 text-red-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900">تأكيد الحذف</h3>
              <p className="text-slate-500">هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع عن هذا الإجراء.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => handleDeleteVisit(itemToDelete)}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                نعم، احذف
              </button>
              <button 
                onClick={() => setItemToDelete(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
