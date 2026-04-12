import React, { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc, query, where, deleteDoc, writeBatch } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, handleFirestoreError, OperationType, firebaseConfig } from '../lib/firebase';
import { User, Rank, EmploymentType, UserRole, Specialty, Level, Cycle } from '../types';
import { 
  Users, Search, Shield, Mail, Key, Copy, Check, 
  UserCheck, UserX, MoreVertical, ExternalLink, ShieldCheck, AlertCircle,
  Edit2, X, Calendar, GraduationCap, Briefcase, Trash2
} from 'lucide-react';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';

export default function TeacherManagement() {
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
        const uniqueTeachers = Array.from(new Map(usersSnap.docs.map(d => {
          const teacher = { uid: d.id, ...d.data() } as User;
          return [teacher.email, teacher];
        })).values());
        setTeachers(uniqueTeachers);
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

  const handleActivate = async (teacher: User) => {
    const { username, password } = generateCredentials(teacher.email);
    const loadingToast = toast.loading(`جاري تفعيل حساب ${teacher.displayName}...`);
    
    // Create a secondary app instance to create the user in Auth without logging out the admin
    const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
    const secondaryAuth = getAuth(secondaryApp);

    try {
      // 1. Create user in Firebase Auth
      try {
        await createUserWithEmailAndPassword(secondaryAuth, teacher.email, password);
      } catch (authErr: any) {
        // If user already exists in Auth, we just continue to update Firestore
        if (authErr.code !== 'auth/email-already-in-use') {
          throw authErr;
        }
      }

      // 2. Update Firestore
      const batch = writeBatch(db);
      
      // Update user doc
      batch.update(doc(db, 'users', teacher.uid), {
        isActive: true,
        username,
        password,
        lastEmailSent: null
      });
      
      // Update username mapping
      batch.set(doc(db, 'usernames', username.toLowerCase()), { email: teacher.email });
      
      await batch.commit();
      
      setTeachers(prev => prev.map(t => t.uid === teacher.uid ? { ...t, isActive: true, username, password } : t));
      toast.dismiss(loadingToast);
      toast.success(`تم تفعيل حساب ${teacher.displayName} بنجاح`);
    } catch (err: any) {
      toast.dismiss(loadingToast);
      console.error('Activation error:', err);
      if (err.code === 'auth/operation-not-allowed') {
        toast.error('خطأ: يجب تفعيل خيار "Email/Password" في إعدادات Firebase Authentication.');
      } else {
        handleFirestoreError(err, OperationType.UPDATE, `users/${teacher.uid}`);
        toast.error('فشل تفعيل الحساب');
      }
    } finally {
      // Clean up secondary app
      await deleteApp(secondaryApp);
    }
  };

  const handleUpdateTeacher = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTeacher) return;
    const formData = new FormData(e.currentTarget);
    
    const rank = formData.get('rank') as Rank;
    const employmentType = formData.get('employmentType') as EmploymentType;
    const role = formData.get('role') as UserRole;
    const displayName = formData.get('displayName') as string;
    
    const updateData: any = {
      rank,
      employmentType,
      role,
      displayName
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
      await updateDoc(doc(db, 'users', editingTeacher.uid), updateData);
      setTeachers(prev => prev.map(t => t.uid === editingTeacher.uid ? { ...t, ...updateData } : t));
      setEditingTeacher(null);
      toast.success('تم تحديث بيانات الأستاذ بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${editingTeacher.uid}`);
    }
  };

  const handleDeactivate = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { isActive: false });
      setTeachers(prev => prev.map(t => t.uid === uid ? { ...t, isActive: false } : t));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const handleDeleteTeacher = async () => {
    if (!teacherToDelete) return;
    const { uid, name } = teacherToDelete;
    
    try {
      await deleteDoc(doc(db, 'users', uid));
      setTeachers(prev => prev.filter(t => t.uid !== uid));
      toast.success(`تم حذف الأستاذ ${name} بنجاح`);
      setTeacherToDelete(null);
    } catch (err) {
      console.error('Delete teacher error:', err);
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
    }
  };

  const handleAddTeacher = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const displayName = formData.get('displayName') as string;
    const rank = formData.get('rank') as Rank;
    const employmentType = formData.get('employmentType') as EmploymentType;
    const role = formData.get('role') as UserRole;

    if (!email || !displayName) {
      toast.error('يرجى ملء كافة الحقول المطلوبة');
      return;
    }

    // Check if email already exists
    if (teachers.some(t => t.email.toLowerCase() === email.toLowerCase())) {
      toast.error('هذا البريد الإلكتروني مسجل مسبقاً');
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
        isActive: false,
        createdAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, 'users'), newTeacher);
      setTeachers(prev => [{ uid: docRef.id, ...newTeacher } as User, ...prev]);
      setShowAddModal(false);
      toast.success('تم إضافة الأستاذ بنجاح. يمكنك الآن تفعيل حسابه.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'users');
    }
  };

  const getSpecialtyGroups = () => {
    // Group specialties by name to handle L3, M1, M2 together
    const groups: { [name: string]: { l3?: Specialty, master?: Specialty[] } } = {};
    specialties.forEach(s => {
      const level = levels.find(l => l.id === s.levelId);
      const cycle = cycles.find(c => c?.id === level?.cycleId);
      
      const isL3 = level?.name.includes('3') && (cycle?.name === 'Licence' || cycle?.name === 'ليسانس');
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
  };

  const filteredTeachers = teachers.filter(t => 
    (t.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
    (t.email?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  const getAllEmails = () => teachers.map(t => t.email).join(', ');
  const getSpecialtyManagerEmails = () => teachers.filter(t => t.role === 'specialty_manager').map(t => t.email).join(', ');
  const getTemporaryTeacherEmails = () => teachers.filter(t => t.employmentType === 'temporary' || t.rank === 'Vacataire').map(t => t.email).join(', ');

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">إدارة الأساتذة</h1>
          <p className="text-slate-500">تفعيل الحسابات وإدارة صلاحيات الوصول</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 font-bold"
          >
            <Users className="w-4 h-4" />
            <span>إضافة أستاذ جديد</span>
          </button>
          <div className="flex items-center gap-4 bg-blue-50 px-4 py-2 rounded-2xl border border-blue-100">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-bold text-blue-700">إجمالي الأساتذة: {teachers.length}</span>
          </div>
        </div>
      </div>

      {/* Search & Email Collection */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="relative flex-1 w-full">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="البحث بالاسم أو البريد الإلكتروني..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl pr-12 pl-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
          />
        </div>
        
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={() => copyToClipboard(getAllEmails(), 'all-emails')}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all shadow-sm font-bold text-sm"
          >
            {copiedId === 'all-emails' ? <Check className="w-4 h-4 text-emerald-600" /> : <Mail className="w-4 h-4 text-blue-600" />}
            <span>نسخ إيميلات الكل</span>
          </button>
          <button 
            onClick={() => copyToClipboard(getSpecialtyManagerEmails(), 'manager-emails')}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all shadow-sm font-bold text-sm"
          >
            {copiedId === 'manager-emails' ? <Check className="w-4 h-4 text-emerald-600" /> : <Shield className="w-4 h-4 text-purple-600" />}
            <span>نسخ إيميلات مسؤولي التخصصات</span>
          </button>
          <button 
            onClick={() => copyToClipboard(getTemporaryTeacherEmails(), 'temp-emails')}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all shadow-sm font-bold text-sm"
          >
            {copiedId === 'temp-emails' ? <Check className="w-4 h-4 text-emerald-600" /> : <Briefcase className="w-4 h-4 text-orange-600" />}
            <span>نسخ إيميلات الأساتذة المؤقتين</span>
          </button>
        </div>
      </div>

      {/* Teachers List */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {filteredTeachers.map(teacher => (
          <div key={teacher.uid} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col md:flex-row">
            <div className="p-6 flex-1 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                    <Users className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{teacher.displayName}</h3>
                    <p className="text-sm text-slate-500 flex items-center gap-1 mb-2"><Mail className="w-3 h-3" /> {teacher.email}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        teacher.role === 'admin' ? "bg-red-100 text-red-700" :
                        teacher.role === 'vice_admin' ? "bg-purple-100 text-purple-700" :
                        teacher.role === 'specialty_manager' ? "bg-blue-100 text-blue-700" :
                        "bg-slate-100 text-slate-600"
                      )}>
                        {teacher.role === 'admin' ? 'مدير' : 
                         teacher.role === 'vice_admin' ? 'نائب رئيس قسم' : 
                         teacher.role === 'specialty_manager' ? 'مسؤول تخصص' : 'أستاذ'}
                      </span>
                      {teacher.rank && (
                        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          {teacher.rank}
                        </span>
                      )}
                      {teacher.employmentType && (
                        <span className="px-3 py-1 bg-orange-50 text-orange-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          {teacher.employmentType === 'internal' ? 'داخلي' : 
                           teacher.employmentType === 'external' ? 'خارجي' : 'مؤقت'}
                        </span>
                      )}
                    </div>
                    {teacher.role === 'specialty_manager' && teacher.appointmentDate && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-2xl border border-blue-100 space-y-1">
                        <p className="text-[10px] font-bold text-blue-700 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          فترة التعيين: {teacher.appointmentDate} إلى {teacher.appointmentEndDate}
                        </p>
                        {teacher.specialtyIds && teacher.specialtyIds.length > 0 && (
                          <p className="text-[10px] font-medium text-blue-600">
                            التخصصات: {teacher.specialtyIds.map(id => specialties.find(s => s.id === id)?.name).filter(Boolean).join('، ')}
                          </p>
                        )}
                      </div>
                    )}
                    {teacher.isActive && (
                      <div className={cn(
                        "mt-2 flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg w-fit",
                        teacher.lastEmailSent ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
                      )}>
                        <Mail className="w-3 h-3" />
                        {teacher.lastEmailSent ? `آخر إرسال: ${new Date(teacher.lastEmailSent).toLocaleString('ar-DZ', { dateStyle: 'short', timeStyle: 'short' })}` : 'لم يتم الإرسال بعد'}
                      </div>
                    )}
                  </div>
                </div>
                <span className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  teacher.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                )}>
                  {teacher.isActive ? 'نشط' : 'غير نشط'}
                </span>
              </div>

              {teacher.isActive && teacher.username ? (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
                      <Key className="w-3 h-3" /> بيانات الدخول
                    </div>
                    <button 
                      onClick={() => copyToClipboard(`Username: ${teacher.username}\nPassword: ${teacher.password}`, teacher.uid)}
                      className="text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      {copiedId === teacher.uid ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">اسم المستخدم</p>
                      <p className="text-sm font-mono font-bold text-slate-700">{teacher.username}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">كلمة المرور</p>
                      <p className="text-sm font-mono font-bold text-slate-700">{teacher.password}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-2">
                  <AlertCircle className="w-6 h-6 text-slate-300" />
                  <p className="text-sm text-slate-400 italic">الحساب لم يتم تفعيله بعد</p>
                </div>
              )}
            </div>

              <div className="bg-slate-50 p-4 md:w-48 border-t md:border-t-0 md:border-r border-slate-100 flex flex-row md:flex-col gap-2 justify-center">
                <button 
                  onClick={() => setEditingTeacher(teacher)}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all text-sm"
                >
                  <Edit2 className="w-4 h-4" />
                  تعديل البيانات
                </button>
                <button 
                  type="button"
                  onClick={() => setTeacherToDelete({ uid: teacher.uid, name: teacher.displayName || '' })}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold hover:bg-red-100 transition-all text-sm z-10"
                >
                  <Trash2 className="w-4 h-4" />
                  حذف الأستاذ
                </button>
                {!teacher.isActive ? (
                <button 
                  onClick={() => handleActivate(teacher)}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all text-sm"
                >
                  <UserCheck className="w-4 h-4" />
                  تفعيل الحساب
                </button>
              ) : (
                <button 
                  onClick={() => handleDeactivate(teacher.uid)}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold hover:bg-red-100 transition-all text-sm"
                >
                  <UserX className="w-4 h-4" />
                  تعطيل الحساب
                </button>
              )}
              {teacher.isActive && (
                <button 
                  onClick={async () => {
                    const subject = 'بيانات حسابك في نظام إدارة القسم - جامعة الأغواط';
                    const html = `
                      <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #334155; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                        <div style="background-color: #2563eb; padding: 24px; text-align: center;">
                          <h1 style="color: white; margin: 0; font-size: 20px;">نظام إدارة قسم الهندسة الميكانيكية</h1>
                        </div>
                        <div style="padding: 32px; line-height: 1.6;">
                          <h2 style="color: #1e293b; margin-top: 0;">مرحباً ${teacher.displayName}،</h2>
                          <p>تم إنشاء حساب لك في المنصة الرقمية لقسم الهندسة الميكانيكية. إليك بيانات الدخول الخاصة بك:</p>
                          
                          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #f1f5f9; margin: 24px 0;">
                            <p style="margin: 8px 0;"><strong>اسم المستخدم:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${teacher.username}</code></p>
                            <p style="margin: 8px 0;"><strong>كلمة المرور:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${teacher.password}</code></p>
                          </div>
                          
                          <p style="color: #64748b; font-size: 14px;">ملاحظة: يرجى تغيير كلمة المرور بعد تسجيل الدخول لأول مرة لضمان أمان حسابك.</p>
                          
                          <div style="text-align: center; margin-top: 32px;">
                            <a href="${window.location.origin}" style="background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">الدخول إلى المنصة</a>
                          </div>
                        </div>
                        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
                          هذا البريد مرسل تلقائياً من نظام إدارة القسم - جامعة عمار ثليجي بالأغواط
                        </div>
                      </div>
                    `;
                    
                    const loadingToast = toast.loading('جاري إرسال البيانات...');
                    try {
                      const response = await fetch('/api/send-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          to: teacher.email, 
                          subject, 
                          body: `مرحباً ${teacher.displayName}، بيانات حسابك هي: اسم المستخدم: ${teacher.username}، كلمة المرور: ${teacher.password}`,
                          html 
                        })
                      });
                      
                      const result = await response.json();
                      
                      if (response.ok && result.success) {
                        // Update Firestore with last email sent timestamp
                        const now = new Date().toISOString();
                        await updateDoc(doc(db, 'users', teacher.uid), {
                          lastEmailSent: now
                        });
                        setTeachers(prev => prev.map(t => t.uid === teacher.uid ? { ...t, lastEmailSent: now } : t));
                        toast.success('تم إرسال البيانات بنجاح', { id: loadingToast });
                      } else {
                        throw new Error(result.message || 'Failed to send');
                      }
                    } catch (err) {
                      toast.error('فشل إرسال البيانات عبر البريد', { id: loadingToast });
                    }
                  }}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all text-sm"
                >
                  <Mail className="w-4 h-4" />
                  إرسال البيانات
                </button>
              )}
              <button className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all text-sm">
                <ExternalLink className="w-4 h-4" />
                الملف الشخصي
              </button>
            </div>
          </div>
        ))}
      </div>
      {/* Edit Teacher Modal */}
      {editingTeacher && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">تعديل بيانات الأستاذ</h2>
              <button onClick={() => setEditingTeacher(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleUpdateTeacher} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الاسم الكامل</label>
                  <input name="displayName" defaultValue={editingTeacher.displayName} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الرتبة (Rank)</label>
                  <select name="rank" defaultValue={editingTeacher.rank} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="Pr">Pr (أستاذ)</option>
                    <option value="MCA">MCA (أستاذ محاضر أ)</option>
                    <option value="MCB">MCB (أستاذ محاضر ب)</option>
                    <option value="MAA">MAA (أستاذ مساعد أ)</option>
                    <option value="MAB">MAB (أستاذ مساعد ب)</option>
                    <option value="Vacataire">Vacataire (مؤقت)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">نوع التوظيف</label>
                  <select name="employmentType" defaultValue={editingTeacher.employmentType} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="internal">دائم بقسم الهندسة الميكانيكية</option>
                    <option value="external">دائم خارج القسم</option>
                    <option value="temporary">أستاذ مؤقت</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الدور (Role)</label>
                  <select name="role" defaultValue={editingTeacher.role} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="teacher">أستاذ</option>
                    <option value="specialty_manager">مسؤول تخصص</option>
                    <option value="vice_admin">نائب رئيس قسم</option>
                    <option value="admin">رئيس قسم</option>
                  </select>
                </div>
              </div>

              {/* Specialty Manager Specific Fields */}
              {editingTeacher.role === 'specialty_manager' && (
                <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 space-y-4">
                  <h4 className="font-bold text-blue-900 flex items-center gap-2">
                    <GraduationCap className="w-5 h-5" />
                    تفاصيل مسؤول التخصص
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">تاريخ بداية التعيين</label>
                      <input type="date" name="appointmentDate" defaultValue={editingTeacher.appointmentDate} className="w-full bg-white border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="flex items-center gap-2 pt-8">
                      <input type="checkbox" name="isRenewed" defaultChecked={editingTeacher.isRenewed} className="w-4 h-4 text-blue-600 rounded" />
                      <label className="text-sm font-bold text-slate-700">تجديد التعيين (مرة واحدة)</label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">التخصص المسؤول عنه (L3, M1, M2)</label>
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
                                ليسانس (L3) - {name}
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
                                ماستر (M1+M2) - {name}
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
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">حفظ التغييرات</button>
                {editingTeacher.isActive && (
                  <button 
                    type="button"
                    onClick={async () => {
                      const subject = 'بيانات حسابك في نظام إدارة القسم - جامعة الأغواط';
                      const html = `
                        <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #334155; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                          <div style="background-color: #2563eb; padding: 24px; text-align: center;">
                            <h1 style="color: white; margin: 0; font-size: 20px;">نظام إدارة قسم الهندسة الميكانيكية</h1>
                          </div>
                          <div style="padding: 32px; line-height: 1.6;">
                            <h2 style="color: #1e293b; margin-top: 0;">مرحباً ${editingTeacher.displayName}،</h2>
                            <p>تم تحديث/إرسال بيانات حسابك في المنصة الرقمية لقسم الهندسة الميكانيكية. إليك بيانات الدخول الخاصة بك:</p>
                            
                            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #f1f5f9; margin: 24px 0;">
                              <p style="margin: 8px 0;"><strong>اسم المستخدم:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${editingTeacher.username}</code></p>
                              <p style="margin: 8px 0;"><strong>كلمة المرور:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${editingTeacher.password}</code></p>
                            </div>
                            
                            <p style="color: #64748b; font-size: 14px;">ملاحظة: يرجى تغيير كلمة المرور بعد تسجيل الدخول لأول مرة لضمان أمان حسابك.</p>
                            
                            <div style="text-align: center; margin-top: 32px;">
                              <a href="${window.location.origin}" style="background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">الدخول إلى المنصة</a>
                            </div>
                          </div>
                          <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
                            هذا البريد مرسل تلقائياً من نظام إدارة القسم - جامعة عمار ثليجي بالأغواط
                          </div>
                        </div>
                      `;
                      
                    const loadingToast = toast.loading('جاري إرسال البيانات...');
                    try {
                      const response = await fetch('/api/send-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          to: editingTeacher.email, 
                          subject, 
                          body: `مرحباً ${editingTeacher.displayName}، بيانات حسابك هي: اسم المستخدم: ${editingTeacher.username}، كلمة المرور: ${editingTeacher.password}`,
                          html 
                        })
                      });
                      
                      const result = await response.json();
                      
                      if (response.ok && result.success) {
                        const now = new Date().toISOString();
                        await updateDoc(doc(db, 'users', editingTeacher.uid), {
                          lastEmailSent: now
                        });
                        setTeachers(prev => prev.map(t => t.uid === editingTeacher.uid ? { ...t, lastEmailSent: now } : t));
                        toast.success('تم إرسال البيانات بنجاح', { id: loadingToast });
                      } else {
                        throw new Error(result.message || 'Failed to send');
                      }
                    } catch (err) {
                      toast.error('فشل إرسال البيانات عبر البريد', { id: loadingToast });
                    }
                  }}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all"
                  >
                    <Mail className="w-5 h-5" />
                    إرسال البيانات
                  </button>
                )}
                <button type="button" onClick={() => setEditingTeacher(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
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
              <h2 className="text-xl font-bold text-slate-900">إضافة أستاذ جديد</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddTeacher} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الاسم الكامل</label>
                  <input name="displayName" placeholder="مثال: محمد علي" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">البريد الإلكتروني</label>
                  <input name="email" type="email" placeholder="example@univ.dz" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الرتبة (Rank)</label>
                  <select name="rank" defaultValue="MAA" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="Pr">Pr (أستاذ)</option>
                    <option value="MCA">MCA (أستاذ محاضر أ)</option>
                    <option value="MCB">MCB (أستاذ محاضر ب)</option>
                    <option value="MAA">MAA (أستاذ مساعد أ)</option>
                    <option value="MAB">MAB (أستاذ مساعد ب)</option>
                    <option value="Vacataire">Vacataire (مؤقت)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">نوع التوظيف</label>
                  <select name="employmentType" defaultValue="internal" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="internal">دائم بقسم الهندسة الميكانيكية</option>
                    <option value="external">دائم خارج القسم</option>
                    <option value="temporary">أستاذ مؤقت</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الدور (Role)</label>
                  <select name="role" defaultValue="teacher" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="teacher">أستاذ</option>
                    <option value="specialty_manager">مسؤول تخصص</option>
                    <option value="vice_admin">نائب رئيس قسم</option>
                    <option value="admin">رئيس قسم</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">إضافة الأستاذ</button>
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
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
              <h3 className="text-xl font-bold text-slate-900">تأكيد الحذف</h3>
              <p className="text-slate-500 mt-2">هل أنت متأكد من حذف الأستاذ <span className="font-bold text-slate-900">{teacherToDelete.name}</span>؟ لا يمكن التراجع عن هذه العملية.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={handleDeleteTeacher}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                تأكيد الحذف
              </button>
              <button 
                onClick={() => setTeacherToDelete(null)}
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
