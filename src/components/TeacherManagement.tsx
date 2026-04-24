import React, { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc, query, where, deleteDoc, writeBatch } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser, updatePassword } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType, firebaseConfig } from '../lib/firebase';
import { User, Rank, EmploymentType, UserRole, Specialty, Level, Cycle } from '../types';
import { 
  Users, Search, Shield, Mail, Key, Copy, Check, 
  UserCheck, UserX, MoreVertical, ExternalLink, ShieldCheck, AlertCircle,
  Edit2, X, Calendar, GraduationCap, Briefcase, Trash2, User as UserIcon, Plus, Clock, MessageSquare, Copy as CopyIcon
} from 'lucide-react';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';

export default function TeacherManagement() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [teachers, setTeachers] = useState<User[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingTeacher, setEditingTeacher] = useState<User | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [teacherToDelete, setTeacherToDelete] = useState<{ uid: string, name: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersSnap, specialtiesSnap, levelsSnap, cyclesSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', 'in', ['admin', 'vice_admin', 'teacher', 'specialty_manager']))),
          getDocs(collection(db, 'specialties')),
          getDocs(collection(db, 'levels')),
          getDocs(collection(db, 'cycles'))
        ]);
        const teachersList = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as User));
        // Sort teachers alphabetically by display name
        teachersList.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', i18n.language));
        setTeachers(teachersList);
        setSpecialties(specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty)));
        setLevels(levelsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Level)));
        setCycles(cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle)));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'teacher_management_data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const generateCredentials = (email: string) => {
    const username = email.split('@')[0];
    const password = Math.random().toString(36).slice(-8) + '2024!';
    return { username, password };
  };

  const handleUpdateTeacher = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTeacher) return;
    const formData = new FormData(e.currentTarget);
    
    const rank = formData.get('rank') as Rank;
    const employmentType = formData.get('employmentType') as EmploymentType;
    const role = formData.get('role') as UserRole;
    const displayName = (formData.get('displayName') as string).trim();
    const email = (formData.get('email') as string).trim();
    
    const updateData: any = {
      rank,
      employmentType,
      role,
      displayName,
      email
    };

    if (role === 'specialty_manager') {
      let selectedSpecialtyIds = Array.from(formData.getAll('specialtyIds')) as string[];
      
      // Auto-include M1/M2 counterparts
      const additionalIds: string[] = [];
      selectedSpecialtyIds.forEach(id => {
        const specialty = specialties.find(s => s.id === id);
        if (specialty) {
          const level = levels.find(l => l.id === specialty.levelId);
          const cycle = cycles.find(c => c?.id === level?.cycleId);
          const isMaster = cycle?.name === 'Master' || cycle?.name === 'ماستر';
          
          if (isMaster) {
            const counterpart = specialties.find(s => 
              s.name === specialty.name && 
              s.id !== specialty.id &&
              levels.find(l => l.id === s.levelId)?.cycleId === cycle.id
            );
            if (counterpart && !selectedSpecialtyIds.includes(counterpart.id)) {
              additionalIds.push(counterpart.id);
            }
          }
        }
      });
      selectedSpecialtyIds = [...new Set([...selectedSpecialtyIds, ...additionalIds])];

      const appointmentDate = formData.get('appointmentDate') as string;
      const isRenewed = formData.get('isRenewed') === 'on';
      
      if (appointmentDate) {
        const startDate = new Date(appointmentDate);
        const endDate = new Date(startDate);
        endDate.setFullYear(startDate.getFullYear() + 3);
        
        updateData.appointmentDate = appointmentDate;
        updateData.appointmentEndDate = endDate.toISOString().split('T')[0];
        updateData.isRenewed = isRenewed;
        updateData.specialtyIds = selectedSpecialtyIds;
      }
    }

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', editingTeacher.uid), updateData);
      
      await batch.commit();
      
      setTeachers(prev => prev.map(t => t.uid === editingTeacher.uid ? { ...t, ...updateData } : t));
      setEditingTeacher(null);
      toast.success(t('update_success'));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${editingTeacher.uid}`);
      toast.error(t('update_error'));
    }
  };

  const handleDeleteTeacher = async () => {
    if (!teacherToDelete) return;
    const { uid } = teacherToDelete;
    
    try {
      await deleteDoc(doc(db, 'users', uid));
      setTeachers(prev => prev.filter(t => t.uid !== uid));
      toast.success(t('delete_success'));
      setTeacherToDelete(null);
    } catch (err) {
      console.error('Delete teacher error:', err);
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
      toast.error(t('delete_error'));
    }
  };

  const handleAddTeacher = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = (formData.get('email') as string).trim();
    const displayName = (formData.get('displayName') as string).trim();
    const rank = formData.get('rank') as Rank;
    const employmentType = formData.get('employmentType') as EmploymentType;
    const role = formData.get('role') as UserRole;

    if (!email || !displayName) {
      toast.error(t('fill_required'));
      return;
    }

    // Check if email already exists
    if (teachers.some(t => t.email.toLowerCase() === email.toLowerCase())) {
      toast.error(t('email_exists'));
      return;
    }

    try {
      const { addDoc } = await import('firebase/firestore');
      const newTeacher = {
        email,
        displayName,
        rank,
        employmentType,
        role,
        createdAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, 'users'), newTeacher);
      setTeachers(prev => [{ uid: docRef.id, ...newTeacher } as User, ...prev]);
      setShowAddModal(false);
      toast.success(t('add_success'));
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'users');
      toast.error(t('add_error'));
    }
  };

  const getSpecialtyGroups = () => {
    const groups: { [name: string]: { l3?: Specialty, master?: Specialty[] } } = {};
    specialties.forEach(s => {
      const level = levels.find(l => l.id === s.levelId);
      const cycle = cycles.find(c => c?.id === level?.cycleId);
      
      const isL3 = level?.name.includes('Third') && (cycle?.name === 'Licence' || cycle?.name === 'ليسانس');
      const isMaster = cycle?.name === 'Master' || cycle?.name === 'ماستر';
      
      if (isL3 || isMaster) {
        if (!groups[s.name]) groups[s.name] = {};
        if (isL3) groups[s.name].l3 = s;
        if (isMaster) {
          if (!groups[s.name].master) groups[s.name].master = [];
          groups[s.name].master.push(s);
        }
      }
    });
    return groups;
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(t('copy_success'));
  };

  const filteredTeachers = React.useMemo(() => {
    return teachers
      .filter(t => 
        (t.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
        (t.email?.toLowerCase() || '').includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', i18n.language));
  }, [teachers, searchTerm, i18n.language]);

  const getAllEmails = () => teachers.map(t => t.email).join(', ');
  const getSpecialtyManagerEmails = () => teachers.filter(t => t.role === 'specialty_manager').map(t => t.email).join(', ');

  const [showDuplicateCleanup, setShowDuplicateCleanup] = useState(false);

  const duplicates = React.useMemo(() => {
    const nameMap = new Map<string, User[]>();
    teachers.forEach(t => {
      const name = (t.displayName || '').trim().toLowerCase();
      if (!name) return;
      if (!nameMap.has(name)) nameMap.set(name, []);
      nameMap.get(name)!.push(t);
    });
    return Array.from(nameMap.entries()).filter(([_, users]) => users.length > 1);
  }, [teachers]);

  const handleCleanupDuplicates = async (name: string, keepUid: string) => {
    const usersToDelete = teachers.filter(t => (t.displayName || '').trim().toLowerCase() === name.toLowerCase() && t.uid !== keepUid);
    if (usersToDelete.length === 0) return;

    try {
      const toastId = toast.loading('جاري حذف الحسابات المكررة...');
      const batch = writeBatch(db);
      usersToDelete.forEach(u => {
        batch.delete(doc(db, 'users', u.uid));
      });
      await batch.commit();
      
      setTeachers(prev => prev.filter(t => !usersToDelete.some(ut => ut.uid === t.uid)));
      toast.success(`تم حذف ${usersToDelete.length} حساب مكرر لـ ${name}`, { id: toastId });
    } catch (err) {
      console.error('Cleanup duplicates error:', err);
      toast.error('فشل حذف التكرارات');
    }
  };

  if (loading) return <div className="p-8 text-center">{t('loading')}</div>;

  return (
    <div className="space-y-10 pb-12" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Duplicate Warning */}
      {duplicates.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 border border-amber-200 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-amber-900">تم اكتشاف تكرار في أسماء الأساتذة</h3>
              <p className="text-sm text-amber-700">يوجد {duplicates.length} اسماً مكرراً في النظام. يمكنك حذف النسخ الزائدة من هنا.</p>
            </div>
          </div>
          <button 
            onClick={() => setShowDuplicateCleanup(!showDuplicateCleanup)}
            className="px-6 py-2 bg-amber-600 text-white rounded-xl font-bold text-sm hover:bg-amber-700 transition-all shadow-sm shadow-amber-200"
          >
            {showDuplicateCleanup ? 'إخفاء الأداة' : 'معالجة التكرارات'}
          </button>
        </motion.div>
      )}

      {showDuplicateCleanup && duplicates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
          {duplicates.map(([name, users]) => (
            <div key={name} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 capitalize">{name}</h4>
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold">{users.length} نسخ</span>
              </div>
              <div className="space-y-2">
                {users.map(u => (
                  <div key={u.uid} className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-xl text-xs">
                    <div className="truncate">
                      <p className="font-bold truncate">{u.email}</p>
                      <p className="text-slate-400 text-[10px]">{u.role}</p>
                    </div>
                    <button 
                      onClick={() => handleCleanupDuplicates(name, u.uid)}
                      className="whitespace-nowrap px-3 py-1 bg-white border border-red-100 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all text-[10px] font-black"
                    >
                      إبقاء هذا وحذف الآخرين
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100 mb-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] font-black uppercase tracking-widest">{t('administration')}</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-none">{t('teacher_management')}</h1>
          <p className="text-slate-500 font-medium text-lg">{t('settings_desc')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowAddModal(true)}
            className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 flex items-center gap-3 group"
          >
            <Plus className="w-5 h-5 transition-transform group-hover:rotate-90" />
            <span>{t('add_teacher')}</span>
          </motion.button>
          
          <div className="bg-white px-6 py-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">{t('total_teachers')}</p>
              <p className="text-2xl font-black text-slate-900 leading-none">{teachers.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Quick Actions Bento */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 relative group">
          <div className={cn(
            "absolute top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-slate-300 transition-colors group-focus-within:text-blue-500",
            isRTL ? "right-2" : "left-2"
          )}>
            <Search className="w-6 h-6" />
          </div>
          <input 
            type="text" 
            placeholder={t('search_teachers_placeholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={cn(
              "w-full bg-white border border-slate-100 rounded-[2rem] py-6 focus:ring-8 focus:ring-blue-500/5 focus:border-blue-500 outline-none shadow-sm transition-all text-xl font-medium placeholder:text-slate-300",
              isRTL ? "pr-14 pl-8" : "pl-14 pr-8"
            )}
          />
        </div>
        
        <div className="lg:col-span-5 grid grid-cols-2 gap-4">
          <motion.button 
            whileHover={{ y: -2 }}
            onClick={() => copyToClipboard(getAllEmails(), 'all-emails')}
            className="flex items-center justify-center gap-3 px-4 py-4 bg-white border border-slate-100 text-slate-700 rounded-[2rem] hover:bg-blue-50 hover:border-blue-100 transition-all shadow-sm font-black text-[10px] uppercase tracking-widest group"
          >
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all">
              {copiedId === 'all-emails' ? <Check className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
            </div>
            <span>{t('copy_all_emails')}</span>
          </motion.button>
          <motion.button 
            whileHover={{ y: -2 }}
            onClick={() => copyToClipboard(getSpecialtyManagerEmails(), 'manager-emails')}
            className="flex items-center justify-center gap-3 px-4 py-4 bg-white border border-slate-100 text-slate-700 rounded-[2rem] hover:bg-purple-50 hover:border-purple-100 transition-all shadow-sm font-black text-[10px] uppercase tracking-widest group"
          >
            <div className="w-8 h-8 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-all">
              {copiedId === 'manager-emails' ? <Check className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
            </div>
            <span>{t('copy_manager_emails')}</span>
          </motion.button>
        </div>
      </div>

      {/* Teachers Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <AnimatePresence mode="popLayout">
          {filteredTeachers.map((teacher, i) => (
            <motion.div 
              key={teacher.uid}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3, delay: i * 0.03 }}
              className="group bg-white rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-blue-500/10 transition-all duration-500 overflow-hidden flex flex-col md:flex-row"
            >
              <div className="p-10 flex-1 space-y-8">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-6">
                    <div className="relative">
                      <div className="w-24 h-24 rounded-[2rem] bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all duration-500 shadow-sm overflow-hidden">
                        {teacher.photoURL ? (
                          <img src={teacher.photoURL} alt={teacher.displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <UserIcon className="w-12 h-12" />
                        )}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-3xl font-black text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors leading-tight">{teacher.displayName}</h3>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
                          <Mail className="w-3.5 h-3.5" />
                          {teacher.email}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <div className={cn(
                    "px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm border",
                    teacher.role === 'admin' ? "bg-red-50 text-red-600 border-red-100" :
                    teacher.role === 'vice_admin' ? "bg-purple-50 text-purple-600 border-purple-100" :
                    teacher.role === 'specialty_manager' ? "bg-blue-50 text-blue-600 border-blue-100" :
                    "bg-slate-50 text-slate-600 border-slate-100"
                  )}>
                    {teacher.role === 'admin' ? t('role_admin') : 
                     teacher.role === 'vice_admin' ? t('role_vice_admin') : 
                     teacher.role === 'specialty_manager' ? t('role_specialty_manager') : t('role_teacher')}
                  </div>
                  {teacher.rank && (
                    <div className="px-5 py-2.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm">
                      {teacher.rank}
                    </div>
                  )}
                  {teacher.employmentType && (
                    <div className="px-5 py-2.5 bg-orange-50 text-orange-600 border border-orange-100 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-sm">
                      {teacher.employmentType === 'internal' ? t('internal_dept') : 
                       teacher.employmentType === 'external' ? t('external_dept') : t('temporary_teacher')}
                    </div>
                  )}
                </div>

                {teacher.role === 'specialty_manager' && teacher.appointmentDate && (
                  <div className="p-6 bg-blue-50/30 rounded-[2rem] border border-blue-100/50 space-y-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-blue-700">
                        <div className="w-10 h-10 rounded-2xl bg-white border border-blue-100 flex items-center justify-center shadow-sm">
                          <Calendar className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest opacity-50 leading-none mb-1">{t('appointment_period')}</p>
                          <p className="text-xs font-black text-blue-900">
                            {teacher.appointmentDate} <span className="mx-2 opacity-30">→</span> {teacher.appointmentEndDate}
                          </p>
                        </div>
                      </div>
                      {teacher.isRenewed && (
                        <div className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[8px] font-black uppercase tracking-widest">
                          {t('renewed')}
                        </div>
                      )}
                    </div>
                    {teacher.specialtyIds && teacher.specialtyIds.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {teacher.specialtyIds.map(id => {
                          const spec = specialties.find(s => s.id === id);
                          return spec ? (
                            <div key={id} className="px-4 py-2 bg-white border border-blue-100 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm">
                              {spec.name}
                            </div>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className={cn(
                "bg-slate-50/30 p-10 md:w-72 border-t md:border-t-0 border-slate-100 flex flex-row md:flex-col gap-4 justify-center items-stretch",
                isRTL ? "md:border-r" : "md:border-l"
              )}>
                <motion.button 
                  whileHover={{ x: isRTL ? -5 : 5 }}
                  onClick={() => setEditingTeacher(teacher)}
                  className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-white border border-slate-200 text-slate-700 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-all shadow-sm group/btn"
                >
                  <Edit2 className="w-5 h-5 transition-transform group-hover/btn:scale-110" />
                  <span>{t('edit')}</span>
                </motion.button>
                
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setTeacherToDelete({ uid: teacher.uid, name: teacher.displayName || '' })}
                  className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-white border border-slate-200 text-slate-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all shadow-sm group/btn"
                >
                  <Trash2 className="w-5 h-5 transition-transform group-hover/btn:scale-110" />
                  <span>{t('delete')}</span>
                </motion.button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Edit Teacher Modal */}
      {editingTeacher && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">{t('edit_teacher')}</h2>
              <button onClick={() => setEditingTeacher(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleUpdateTeacher} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('full_name')}</label>
                  <input name="displayName" defaultValue={editingTeacher.displayName} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('email')}</label>
                  <input name="email" type="email" defaultValue={editingTeacher.email} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('rank')}</label>
                  <select name="rank" defaultValue={editingTeacher.rank} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="Pr">Pr</option>
                    <option value="MCA">MCA</option>
                    <option value="MCB">MCB</option>
                    <option value="MAA">MAA</option>
                    <option value="MAB">MAB</option>
                    <option value="Vacataire">Vacataire</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('employment_type')}</label>
                  <select name="employmentType" defaultValue={editingTeacher.employmentType} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="internal">{t('internal_dept')}</option>
                    <option value="external">{t('external_dept')}</option>
                    <option value="temporary">{t('temporary_teacher')}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('role')}</label>
                  <select name="role" defaultValue={editingTeacher.role} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="teacher">{t('role_teacher')}</option>
                    <option value="specialty_manager">{t('role_specialty_manager')}</option>
                    <option value="vice_admin">{t('role_vice_admin')}</option>
                    <option value="admin">{t('role_admin')}</option>
                  </select>
                </div>
              </div>

              {editingTeacher.role === 'specialty_manager' && (
                <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 space-y-4">
                  <h4 className="font-bold text-blue-900 flex items-center gap-2">
                    <GraduationCap className="w-5 h-5" />
                    {t('specialty_manager_details')}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">{t('appointment_start')}</label>
                      <input type="date" name="appointmentDate" defaultValue={editingTeacher.appointmentDate} className="w-full bg-white border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="flex items-center gap-2 pt-8">
                      <input type="checkbox" name="isRenewed" defaultChecked={editingTeacher.isRenewed} className="w-4 h-4 text-blue-600 rounded" />
                      <label className="text-sm font-bold text-slate-700">{t('renewal')}</label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">{t('responsible_specialty')}</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 bg-white rounded-xl border border-blue-100">
                      {Object.entries(getSpecialtyGroups()).map(([name, group]) => (
                        <div key={name} className="space-y-1 p-2 border-b border-slate-50 last:border-0">
                          <p className="text-xs font-bold text-blue-600">{name}</p>
                          {group.l3 && (
                            <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                              <input 
                                type="radio" 
                                name="specialtyIds" 
                                value={group.l3.id} 
                                defaultChecked={editingTeacher.specialtyIds?.includes(group.l3.id)}
                                className="w-3 h-3 text-blue-600 rounded-full" 
                              />
                                <span className="text-[10px] font-medium text-slate-600">
                                  {t('cycle_licence')} (Third Year) - {name}
                                </span>
                            </label>
                          )}
                          {group.master && group.master.length > 0 && (
                            <label className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                              <input 
                                type="radio" 
                                name="specialtyIds" 
                                value={group.master[0].id} 
                                defaultChecked={group.master.some(s => editingTeacher.specialtyIds?.includes(s.id))}
                                className="w-3 h-3 text-blue-600 rounded-full" 
                              />
                                <span className="text-[10px] font-medium text-slate-600">
                                  {t('cycle_master')} (Master 1 & 2) - {name}
                                </span>
                            </label>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">{t('save_changes')}</button>
                <button type="button" onClick={() => setEditingTeacher(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">{t('cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Teacher Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">{t('add_teacher')}</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddTeacher} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('full_name')}</label>
                  <input name="displayName" placeholder={t('full_name')} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('email')}</label>
                  <input name="email" type="email" placeholder="example@univ.dz" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('rank')}</label>
                  <select name="rank" defaultValue="MAA" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="Pr">Pr</option>
                    <option value="MCA">MCA</option>
                    <option value="MCB">MCB</option>
                    <option value="MAA">MAA</option>
                    <option value="MAB">MAB</option>
                    <option value="Vacataire">Vacataire</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('employment_type')}</label>
                  <select name="employmentType" defaultValue="internal" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="internal">{t('internal_dept')}</option>
                    <option value="external">{t('external_dept')}</option>
                    <option value="temporary">{t('temporary_teacher')}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('role')}</label>
                  <select name="role" defaultValue="teacher" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="teacher">{t('role_teacher')}</option>
                    <option value="specialty_manager">{t('role_specialty_manager')}</option>
                    <option value="vice_admin">{t('role_vice_admin')}</option>
                    <option value="admin">{t('role_admin')}</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">{t('add')}</button>
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">{t('cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {teacherToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 space-y-6 text-center">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-10 h-10 text-red-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">{t('delete_confirm_title')}</h3>
              <p className="text-slate-500 mt-2">{t('delete_confirm_desc', { name: teacherToDelete.name })}</p>
              <div className="mt-4 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-700 text-xs font-medium space-y-2 text-right">
                <p className="font-bold flex items-center gap-1 justify-end">
                  {t('important_note')}
                  <AlertCircle className="w-4 h-4" />
                </p>
                <p>{t('delete_auth_manual_warning')}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={handleDeleteTeacher}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                {t('delete')}
              </button>
              <button 
                onClick={() => setTeacherToDelete(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
