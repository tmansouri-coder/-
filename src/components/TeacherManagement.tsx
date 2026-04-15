import React, { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc, query, where, deleteDoc, writeBatch } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, deleteUser, updatePassword } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType, firebaseConfig } from '../lib/firebase';
import { User, Rank, EmploymentType, UserRole, Specialty, Level, Cycle } from '../types';
import { 
  Users, Search, Shield, Mail, Key, Copy, Check, 
  UserCheck, UserX, MoreVertical, ExternalLink, ShieldCheck, AlertCircle,
  Edit2, X, Calendar, GraduationCap, Briefcase, Trash2, User as UserIcon
} from 'lucide-react';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

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

  const handleActivate = async (teacher: User) => {
    const username = teacher.email.split('@')[0].toLowerCase();
    const loadingToast = toast.loading(t('activation_in_progress', { name: teacher.displayName }));
    
    try {
      // Update Firestore
      const batch = writeBatch(db);
      
      const updateData: any = {
        isActive: true,
        username,
        lastEmailSent: null
      };
      
      batch.update(doc(db, 'users', teacher.uid), updateData);
      batch.set(doc(db, 'usernames', username), { email: teacher.email });
      
      await batch.commit();
      
      setTeachers(prev => prev.map(t => t.uid === teacher.uid ? { ...t, ...updateData } : t));
      toast.dismiss(loadingToast);
      toast.success(t('activation_success', { name: teacher.displayName }));
    } catch (err: any) {
      toast.dismiss(loadingToast);
      console.error('Activation error:', err);
      toast.error(t('activation_error') + ': ' + (err.message || 'Unknown error'));
    }
  };

  // handleResetPassword is no longer needed with Google login

  const handleUpdateTeacher = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTeacher) return;
    const formData = new FormData(e.currentTarget);
    
    const rank = formData.get('rank') as Rank;
    const employmentType = formData.get('employmentType') as EmploymentType;
    const role = formData.get('role') as UserRole;
    const displayName = formData.get('displayName') as string;
    const email = formData.get('email') as string;
    
    const updateData: any = {
      rank,
      employmentType,
      role,
      displayName,
      email
    };

    // If email changed, we need to update username mapping if user is active
    const emailChanged = email !== editingTeacher.email;
    if (emailChanged && editingTeacher.isActive) {
      const newUsername = email.split('@')[0].toLowerCase();
      updateData.username = newUsername;
    }

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
      
      if (emailChanged && editingTeacher.isActive) {
        const oldUsername = editingTeacher.username?.toLowerCase();
        const newUsername = updateData.username.toLowerCase();
        
        if (oldUsername) {
          batch.delete(doc(db, 'usernames', oldUsername));
        }
        batch.set(doc(db, 'usernames', newUsername), { email });
      }
      
      await batch.commit();
      
      setTeachers(prev => prev.map(t => t.uid === editingTeacher.uid ? { ...t, ...updateData } : t));
      setEditingTeacher(null);
      toast.success(t('update_success'));
      if (emailChanged) {
        alert(t('email_change_auth_warning'));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${editingTeacher.uid}`);
      toast.error(t('update_error'));
    }
  };

  const handleDeactivate = async (uid: string) => {
    try {
      const teacher = teachers.find(t => t.uid === uid);
      await updateDoc(doc(db, 'users', uid), { isActive: false });
      setTeachers(prev => prev.map(t => t.uid === uid ? { ...t, isActive: false } : t));
      toast.success(t('deactivation_success', { name: teacher?.displayName }));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
      toast.error(t('deactivation_error'));
    }
  };

  const handleDeleteTeacher = async () => {
    if (!teacherToDelete) return;
    const { uid } = teacherToDelete;
    const teacher = teachers.find(t => t.uid === uid);
    
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'users', uid));
      if (teacher?.username) {
        batch.delete(doc(db, 'usernames', teacher.username.toLowerCase()));
      }
      await batch.commit();
      
      setTeachers(prev => prev.filter(t => t.uid !== uid));
      toast.success(t('delete_success'));
      setTeacherToDelete(null);
    } catch (err) {
      console.error('Delete teacher error:', err);
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
      toast.error(t('delete_error'));
    }
  };

  const handleSendEmail = async (teacher: User) => {
    if (!teacher.username) return;
    
    const loadingToast = toast.loading(t('sending_data'));
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: teacher.email,
          subject: t('email_subject'),
          html: `
            <div style="font-family: Arial, sans-serif; direction: ${isRTL ? 'rtl' : 'ltr'}; text-align: ${isRTL ? 'right' : 'left'}; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #1e40af;">${t('mechanical_engineering')}</h2>
              <p>${t('email_hello')} <strong>${teacher.displayName}</strong>،</p>
              <p>${t('email_credentials_desc_google')}</p>
              <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>${t('username')}:</strong> ${teacher.username}</p>
                <p style="margin: 5px 0; color: #1e40af; font-size: 0.9em;">* ${t('use_google_login_note')}</p>
              </div>
              <p>${t('email_access_link')}</p>
              <a href="${window.location.origin}" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">${t('access_system')}</a>
              <p style="margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 10px; font-size: 0.8em; color: #6b7280;">
                ${t('email_automated_footer')}
              </p>
            </div>
          `
        })
      });

      if (!response.ok) throw new Error('Failed to send email');

      await updateDoc(doc(db, 'users', teacher.uid), {
        lastEmailSent: new Date().toISOString()
      });
      
      setTeachers(prev => prev.map(t => t.uid === teacher.uid ? { ...t, lastEmailSent: new Date().toISOString() } : t));
      toast.dismiss(loadingToast);
      toast.success(t('send_success'));
    } catch (err) {
      toast.dismiss(loadingToast);
      toast.error(t('send_error'));
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
        isActive: false,
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
    toast.success(t('copy_success'));
  };

  const filteredTeachers = teachers.filter(t => 
    (t.displayName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
    (t.email?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  const getAllEmails = () => teachers.map(t => t.email).join(', ');
  const getSpecialtyManagerEmails = () => teachers.filter(t => t.role === 'specialty_manager').map(t => t.email).join(', ');
  const getTemporaryTeacherEmails = () => teachers.filter(t => t.employmentType === 'temporary' || t.rank === 'Vacataire').map(t => t.email).join(', ');

  if (loading) return <div className="p-8 text-center">{t('loading')}</div>;

  return (
    <div className="space-y-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('teacher_management')}</h1>
          <p className="text-slate-500">{t('settings_desc')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 font-bold"
          >
            <Users className="w-4 h-4" />
            <span>{t('add_teacher')}</span>
          </button>
          <div className="flex items-center gap-4 bg-blue-50 px-4 py-2 rounded-2xl border border-blue-100">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-bold text-blue-700">{t('total_teachers')}: {teachers.length}</span>
          </div>
        </div>
      </div>

      {/* Search & Email Collection */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="relative flex-1 w-full">
          <Search className={cn("absolute top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400", isRTL ? "right-4" : "left-4")} />
          <input 
            type="text" 
            placeholder={t('search_teachers_placeholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={cn(
              "w-full bg-white border border-slate-200 rounded-2xl py-3 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm",
              isRTL ? "pr-12 pl-4" : "pl-12 pr-4"
            )}
          />
        </div>
        
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={() => copyToClipboard(getAllEmails(), 'all-emails')}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all shadow-sm font-bold text-sm"
          >
            {copiedId === 'all-emails' ? <Check className="w-4 h-4 text-emerald-600" /> : <Mail className="w-4 h-4 text-blue-600" />}
            <span>{t('copy_all_emails')}</span>
          </button>
          <button 
            onClick={() => copyToClipboard(getSpecialtyManagerEmails(), 'manager-emails')}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all shadow-sm font-bold text-sm"
          >
            {copiedId === 'manager-emails' ? <Check className="w-4 h-4 text-emerald-600" /> : <Shield className="w-4 h-4 text-purple-600" />}
            <span>{t('copy_manager_emails')}</span>
          </button>
          <button 
            onClick={() => copyToClipboard(getTemporaryTeacherEmails(), 'temp-emails')}
            className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl hover:bg-slate-50 transition-all shadow-sm font-bold text-sm"
          >
            {copiedId === 'temp-emails' ? <Check className="w-4 h-4 text-emerald-600" /> : <Briefcase className="w-4 h-4 text-orange-600" />}
            <span>{t('copy_temp_emails')}</span>
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
                        {teacher.role === 'admin' ? t('role_admin') : 
                         teacher.role === 'vice_admin' ? t('role_vice_admin') : 
                         teacher.role === 'specialty_manager' ? t('role_specialty_manager') : t('role_teacher')}
                      </span>
                      {teacher.rank && (
                        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          {teacher.rank}
                        </span>
                      )}
                      {teacher.employmentType && (
                        <span className="px-3 py-1 bg-orange-50 text-orange-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          {teacher.employmentType === 'internal' ? t('internal_dept') : 
                           teacher.employmentType === 'external' ? t('external_dept') : t('temporary_teacher')}
                        </span>
                      )}
                    </div>
                    {teacher.role === 'specialty_manager' && teacher.appointmentDate && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-2xl border border-blue-100 space-y-1">
                        <p className="text-[10px] font-bold text-blue-700 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {t('appointment_period')} {teacher.appointmentDate} {t('to')} {teacher.appointmentEndDate}
                        </p>
                        {teacher.specialtyIds && teacher.specialtyIds.length > 0 && (
                          <p className="text-[10px] font-medium text-blue-600">
                            {t('specialties')}: {teacher.specialtyIds.map(id => specialties.find(s => s.id === id)?.name).filter(Boolean).join('، ')}
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
                        {teacher.lastEmailSent ? `${t('last_sent')} ${new Date(teacher.lastEmailSent).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}` : t('not_sent_yet')}
                      </div>
                    )}
                  </div>
                </div>
                <span className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                  teacher.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                )}>
                  {teacher.isActive ? t('active') : t('inactive')}
                </span>
              </div>

              {teacher.isActive && teacher.username ? (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest">
                      <UserIcon className="w-3 h-3" /> {t('account_info')}
                    </div>
                    <button 
                      onClick={() => copyToClipboard(`Username: ${teacher.username}`, teacher.uid)}
                      className="text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      {copiedId === teacher.uid ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">{t('username')}</p>
                      <p className="text-sm font-mono font-bold text-slate-700">{teacher.username}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-2">
                  <AlertCircle className="w-6 h-6 text-slate-300" />
                  <p className="text-sm text-slate-400 italic">{t('account_not_activated')}</p>
                </div>
              )}
            </div>

              <div className={cn(
                "bg-slate-50 p-4 md:w-48 border-t md:border-t-0 border-slate-100 flex flex-row md:flex-col gap-2 justify-center",
                isRTL ? "md:border-r" : "md:border-l"
              )}>
                <button 
                  onClick={() => setEditingTeacher(teacher)}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all text-sm"
                >
                  <Edit2 className="w-4 h-4" />
                  {t('edit')}
                </button>
                <button 
                  type="button"
                  onClick={() => setTeacherToDelete({ uid: teacher.uid, name: teacher.displayName || '' })}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold hover:bg-red-100 transition-all text-sm z-10"
                >
                  <Trash2 className="w-4 h-4" />
                  {t('delete')}
                </button>
                {!teacher.isActive ? (
                <button 
                  onClick={() => handleActivate(teacher)}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all text-sm"
                >
                  <UserCheck className="w-4 h-4" />
                  {t('activate')}
                </button>
              ) : (
                <button 
                  onClick={() => handleDeactivate(teacher.uid)}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold hover:bg-red-100 transition-all text-sm"
                >
                  <UserX className="w-4 h-4" />
                  {t('deactivate')}
                </button>
              )}
              {teacher.isActive && (
                <button 
                  onClick={() => handleSendEmail(teacher)}
                  className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all text-sm"
                >
                  <Mail className="w-4 h-4" />
                  {t('send_data')}
                </button>
              )}
              <button className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all text-sm">
                <ExternalLink className="w-4 h-4" />
                {t('profile')}
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

              {/* Specialty Manager Specific Fields */}
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
                                {t('cycle_licence')} (L3) - {name}
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
                                {t('cycle_master')} (M1+M2) - {name}
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
                {editingTeacher.isActive && (
                  <button 
                    type="button"
                    onClick={() => handleSendEmail(editingTeacher)}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all"
                  >
                    <Mail className="w-5 h-5" />
                    {t('send_data')}
                  </button>
                )}
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
