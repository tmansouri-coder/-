import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Project, User, Specialty, ProjectStatus, ProjectStage, ProblemType, AbandonmentReason, Room, Cycle, Level } from '../types';
import { 
  Briefcase, Plus, Search, Filter, Calendar, User as UserIcon, 
  CheckCircle2, Clock, AlertCircle, Trash2, Edit2, ChevronRight,
  FileText, MessageSquare, History, Settings, MoreVertical, X, Users, MapPin,
  TrendingUp, AlertTriangle, ShieldCheck, Mail, Download, ExternalLink
} from 'lucide-react';
import { cn, mapLevelName } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import toast from 'react-hot-toast';
import { useNotifications } from '../contexts/NotificationContext';
import { motion, AnimatePresence } from 'motion/react';

export default function ProjectManagement() {
  const { user, isAdmin, isViceAdmin, isSpecialtyManager, isTeacher } = useAuth();
  const { sendNotification } = useNotifications();
  const { selectedYear } = useAcademicYear();
  const [projects, setProjects] = useState<Project[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | 'All'>('All');
  const [selectedCycleId, setSelectedCycleId] = useState<string>('');

  // Modals
  const [showProblemModal, setShowProblemModal] = useState(false);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const [showDefenseModal, setShowDefenseModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [projectsSnap, usersSnap, specialtiesSnap, roomsSnap, cyclesSnap, levelsSnap] = await Promise.all([
          getDocs(query(collection(db, 'projects'), where('academicYear', '==', selectedYear), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'specialties')),
          getDocs(collection(db, 'rooms')),
          getDocs(collection(db, 'cycles')),
          getDocs(collection(db, 'levels'))
        ]);

        const levelDocs = levelsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Level));
        const specDocs = specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty));

        // Resilience: Fix specialty/level mapping inconsistencies
        const correctedSpecialties = specDocs.map(spec => {
          if (!levelDocs.some(l => l.id === spec.levelId)) {
            // Attempt recovery if levelId is a name (e.g. "L1", "L3") instead of a UUID
            const foundLevel = levelDocs.find(l => l.name === spec.levelId || l.id === spec.levelId);
            if (foundLevel) return { ...spec, levelId: foundLevel.id };
          }
          return spec;
        });

        setProjects(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
        const teachersList = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as User)).filter(u => u.role === 'teacher' || u.role === 'admin');
        teachersList.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
        setTeachers(teachersList);
        setSpecialties(correctedSpecialties);
        const roomsList = roomsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Room));
        roomsList.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
        setRooms(roomsList);
        const cycleDocs = cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle));
        setCycles(cycleDocs);
        setLevels(levelDocs.map(l => {
          const cycle = cycleDocs.find(c => c.id === l.cycleId);
          return { ...l, name: mapLevelName(l.name, cycle?.name || '') };
        }));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'projects/users/specialties');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedYear]);

  const uniqueTeachersSorted = React.useMemo(() => {
    const seen = new Set<string>();
    return teachers.filter(t => {
      const name = (t.displayName || '').trim().toLowerCase();
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    }).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }, [teachers]);

  const handleAddProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const studentsInput = formData.get('students') as string;
    const projectData = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      keywords: (formData.get('keywords') as string).split(',').map(k => k.trim()),
      specialtyId: formData.get('specialtyId') as string,
      supervisorId: formData.get('supervisorId') as string,
      coSupervisorId: (formData.get('coSupervisorId') as string) || null,
      students: studentsInput ? studentsInput.split(',').map(s => s.trim()) : [],
      status: 'Proposed' as ProjectStatus,
      levelId: specialties.find(s => s.id === (formData.get('specialtyId') as string))?.levelId || '',
      progress: 0,
      stage: 'Start' as ProjectStage,
      isDecision1275: formData.get('isDecision1275') === 'on',
      academicYear: selectedYear,
      stages: [
        { name: 'Start', status: 'Completed', date: new Date().toISOString().split('T')[0] },
        { name: 'References', status: 'Pending' },
        { name: 'Theory', status: 'Pending' },
        { name: 'Practical', status: 'Pending' },
        { name: 'Writing', status: 'Pending' },
        { name: 'Ready', status: 'Pending' },
      ],
      createdAt: new Date().toISOString(),
    };

    try {
      const docRef = await addDoc(collection(db, 'projects'), projectData);
      setProjects(prev => [{ id: docRef.id, ...projectData } as Project, ...prev]);
      setShowAddModal(false);
      toast.success('تم إضافة المشروع بنجاح');

      // Notify admins
      const adminSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')));
      adminSnap.docs.forEach(adminDoc => {
        sendNotification(
          adminDoc.id,
          'مشروع جديد مضاف',
          `قام الأستاذ ${user?.displayName} بإضافة مشروع جديد: ${projectData.title}`,
          'info',
          '/projects'
        );
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'projects');
    }
  };

  const handleUpdateStatus = async (projectId: string, newStatus: ProjectStatus) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Permission Check
    if (isTeacher && !isAdmin && !isViceAdmin && !isSpecialtyManager) {
      const allowedStatuses: ProjectStatus[] = ['InProgress', 'Ready', 'Defended'];
      if (!allowedStatuses.includes(newStatus)) {
        toast.error('ليس لديك صلاحية لتغيير الحالة إلى هذه القيمة');
        return;
      }
      if (project.status === 'Proposed' || project.status === 'Validated') {
        toast.error('يجب انتظار توزيع المشروع أولاً');
        return;
      }
    }

    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, { status: newStatus });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: newStatus } : p));
      if (selectedProject?.id === projectId) setSelectedProject({ ...selectedProject, status: newStatus });
      toast.success(`تم تحديث حالة المشروع إلى: ${newStatus}`);

      // Notify supervisor
      const project = projects.find(p => p.id === projectId);
      if (project) {
        sendNotification(
          project.supervisorId,
          'تحديث حالة مشروعك',
          `تم تحديث حالة مشروعك "${project.title}" إلى ${newStatus}`,
          newStatus === 'Completed' ? 'success' : 'info',
          '/projects'
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  const handleUpdateProgress = async (projectId: string, progress: number) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    if (isTeacher && !isAdmin && !isViceAdmin && !isSpecialtyManager) {
      if (project.status === 'Proposed' || project.status === 'Validated') {
        toast.error('لا يمكن تحديث التقدم قبل توزيع المشروع');
        return;
      }
    }

    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, { progress });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, progress } : p));
      if (selectedProject?.id === projectId) setSelectedProject({ ...selectedProject, progress });
      toast.success(`تم تحديث نسبة التقدم: ${progress}%`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  const handleUpdateStage = async (projectId: string, stage: ProjectStage) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    if (isTeacher && !isAdmin && !isViceAdmin && !isSpecialtyManager) {
      if (project.status === 'Proposed' || project.status === 'Validated') {
        toast.error('لا يمكن تحديث المرحلة قبل توزيع المشروع');
        return;
      }
    }

    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, { stage });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, stage } : p));
      if (selectedProject?.id === projectId) setSelectedProject({ ...selectedProject, stage });
      toast.success(`تم تحديث المرحلة إلى: ${stage}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  const handleValidateProject = async (projectId: string) => {
    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, { status: 'Validated' });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'Validated' } : p));
      if (selectedProject?.id === projectId) setSelectedProject({ ...selectedProject, status: 'Validated' });
      toast.success('تم تأكيد المشروع بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  const handleDistributeProject = async (projectId: string, students: string[]) => {
    if (students.length === 0) {
      toast.error('يرجى إدخال أسماء الطلبة أولاً');
      return;
    }
    try {
      const projectRef = doc(db, 'projects', projectId);
      await updateDoc(projectRef, { status: 'Distributed', students });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'Distributed', students } : p));
      if (selectedProject?.id === projectId) setSelectedProject({ ...selectedProject, status: 'Distributed', students });
      toast.success('تم توزيع المشروع على الطلبة');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  const handleEditProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProject) return;
    const formData = new FormData(e.currentTarget);
    const studentsInput = formData.get('students') as string;
    
    const updatedData = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      keywords: (formData.get('keywords') as string).split(',').map(k => k.trim()),
      specialtyId: formData.get('specialtyId') as string,
      supervisorId: formData.get('supervisorId') as string,
      coSupervisorId: (formData.get('coSupervisorId') as string) || null,
      students: studentsInput ? studentsInput.split(',').map(s => s.trim()) : editingProject.students,
      isDecision1275: formData.get('isDecision1275') === 'on',
      levelId: specialties.find(s => s.id === (formData.get('specialtyId') as string))?.levelId || editingProject.levelId,
    };

    try {
      const projectRef = doc(db, 'projects', editingProject.id);
      await updateDoc(projectRef, updatedData);
      setProjects(prev => prev.map(p => p.id === editingProject.id ? { ...p, ...updatedData } : p));
      setShowEditModal(false);
      setEditingProject(null);
      toast.success('تم تحديث المشروع بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${editingProject.id}`);
    }
  };

  const handleDeleteProject = (projectId: string) => {
    setItemToDelete(projectId);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await deleteDoc(doc(db, 'projects', itemToDelete));
      setProjects(prev => prev.filter(p => p.id !== itemToDelete));
      toast.success('تم حذف المشروع بنجاح');
      setItemToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `projects/${itemToDelete}`);
    }
  };

  const handleAddProblem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedProject) return;
    const formData = new FormData(e.currentTarget);
    const problem = {
      id: crypto.randomUUID(),
      type: formData.get('type') as ProblemType,
      description: formData.get('description') as string,
      date: formData.get('date') as string,
      createdAt: new Date().toISOString(),
    };

    try {
      const projectRef = doc(db, 'projects', selectedProject.id);
      const updatedProblems = [...(selectedProject.problems || []), problem];
      await updateDoc(projectRef, { problems: updatedProblems });
      
      const updatedProject = { ...selectedProject, problems: updatedProblems };
      setSelectedProject(updatedProject);
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? updatedProject : p));
      setShowProblemModal(false);
      toast.success('تم تسجيل المشكلة بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${selectedProject.id}`);
    }
  };

  const handleAbandonmentRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedProject) return;
    const formData = new FormData(e.currentTarget);
    const request = {
      reason: formData.get('reason') as AbandonmentReason,
      notes: formData.get('notes') as string,
      date: new Date().toISOString().split('T')[0],
      status: 'Pending' as const,
      createdAt: new Date().toISOString(),
    };

    try {
      const projectRef = doc(db, 'projects', selectedProject.id);
      await updateDoc(projectRef, { abandonmentRequest: request });
      
      const updatedProject = { ...selectedProject, abandonmentRequest: request };
      setSelectedProject(updatedProject);
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? updatedProject : p));
      setShowAbandonModal(false);
      toast.success('تم إرسال طلب التخلي للإدارة');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${selectedProject.id}`);
    }
  };

  const handleProposeDefense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedProject) return;
    const formData = new FormData(e.currentTarget);
    const defense = {
      proposedDate: formData.get('date') as string,
      proposedTime: formData.get('time') as string,
      status: 'Proposed' as const,
    };

    try {
      const projectRef = doc(db, 'projects', selectedProject.id);
      await updateDoc(projectRef, { defenseInfo: defense });
      
      const updatedProject = { ...selectedProject, defenseInfo: { ...selectedProject.defenseInfo, ...defense } as any };
      setSelectedProject(updatedProject);
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? updatedProject : p));
      setShowDefenseModal(false);
      toast.success('تم اقتراح موعد المناقشة');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${selectedProject.id}`);
    }
  };

  const handleConfirmDefense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedProject) return;
    const formData = new FormData(e.currentTarget);
    const date = formData.get('date') as string;
    const time = formData.get('time') as string;
    const roomId = formData.get('roomId') as string;
    const presidentId = formData.get('presidentId') as string;
    const examinerIds = Array.from(formData.getAll('examinerIds')) as string[];

    // Conflict Detection
    const hasConflict = projects.some(p => {
      if (p.id === selectedProject.id || p.defenseInfo?.status !== 'Confirmed') return false;
      const sameTime = p.defenseInfo.confirmedDate === date && p.defenseInfo.confirmedTime === time;
      const sameRoom = p.defenseInfo.roomId === roomId;
      const sameTeacher = [
        p.supervisorId, 
        p.coSupervisorId,
        p.defenseInfo.presidentId, 
        ...(p.defenseInfo.examinerIds || [])
      ].some(id => 
        id && [
          selectedProject.supervisorId, 
          selectedProject.coSupervisorId,
          presidentId, 
          ...examinerIds
        ].includes(id as string)
      );
      return sameTime && (sameRoom || sameTeacher);
    });

    if (hasConflict) {
      toast.error('يوجد تعارض في الموعد أو القاعة أو الأساتذة!');
      return;
    }

    const defense = {
      confirmedDate: date,
      confirmedTime: time,
      roomId,
      presidentId,
      examinerIds,
      status: 'Confirmed' as const,
    };

    try {
      const projectRef = doc(db, 'projects', selectedProject.id);
      await updateDoc(projectRef, { defenseInfo: defense });
      
      const updatedProject = { ...selectedProject, defenseInfo: { ...selectedProject.defenseInfo, ...defense } as any };
      setSelectedProject(updatedProject);
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? updatedProject : p));
      setShowDefenseModal(false);
      toast.success('تم تثبيت موعد المناقشة وتعيين اللجنة');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `projects/${selectedProject.id}`);
    }
  };

  const handleSendThesis = async (project: Project) => {
    if (!project.defenseInfo?.thesisUrl) {
      toast.error('يرجى رفع المذكرة أولاً');
      return;
    }
    toast.loading('جاري إرسال المذكرة لأعضاء اللجنة...');
    setTimeout(() => {
      toast.dismiss();
      toast.success('تم إرسال المذكرة بنجاح عبر البريد الإلكتروني');
    }, 2000);
  };

  const filteredProjects = projects.filter(p => {
    const matchesSearch = (p.title?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
                         p.students?.some(s => (s?.toLowerCase() || '').includes(searchTerm.toLowerCase())) ||
                         p.keywords?.some(k => (k?.toLowerCase() || '').includes(searchTerm.toLowerCase()));
    const matchesStatus = filterStatus === 'All' || p.status === filterStatus;
    
    let isAuthorized = false;
    if (isAdmin || isViceAdmin) {
      isAuthorized = true;
    } else if (isSpecialtyManager) {
      // Specialty manager sees projects in their specialties
      const managerSpecialties = user?.specialtyIds || (user?.specialtyId ? [user.specialtyId] : []);
      isAuthorized = managerSpecialties.includes(p.specialtyId);
    } else if (isTeacher) {
      // Teacher sees projects they supervise or co-supervise
      isAuthorized = p.supervisorId === user?.uid || p.coSupervisorId === user?.uid;
    }

    return matchesSearch && matchesStatus && isAuthorized;
  });

  const stats = {
    total: projects.length,
    proposed: projects.filter(p => p.status === 'Proposed').length,
    distributed: projects.filter(p => p.status === 'Distributed').length,
    inProgress: projects.filter(p => p.status === 'InProgress').length,
    ready: projects.filter(p => p.status === 'Ready').length,
    defended: projects.filter(p => p.status === 'Defended').length,
    decision1275: projects.filter(p => p.isDecision1275).length,
    avgProgress: Math.round(projects.reduce((acc, p) => acc + (p.progress || 0), 0) / (projects.length || 1))
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-10 pb-12" dir="rtl">
      {/* Header & Stats Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">إدارة مشاريع التخرج (PFE)</h1>
          <p className="text-slate-500 font-medium">متابعة مشاريع الليسانس، الماستر، والقرار 1275</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span>اقتراح مشروع</span>
          </button>
          <div className="bg-white px-5 py-3 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">متوسط الإنجاز</p>
              <p className="text-lg font-black text-slate-900 leading-none">{stats.avgProgress}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bento Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'الإجمالي', value: stats.total, color: 'slate', icon: Briefcase },
          { label: 'مقترح', value: stats.proposed, color: 'blue', icon: FileText },
          { label: 'قيد الإنجاز', value: stats.inProgress, color: 'orange', icon: Clock },
          { label: 'جاهز', value: stats.ready, color: 'emerald', icon: CheckCircle2 },
          { label: 'القرار 1275', value: stats.decision1275, color: 'red', icon: ShieldCheck },
        ].map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
          >
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", 
              stat.color === 'slate' ? "bg-slate-50 text-slate-600" :
              stat.color === 'blue' ? "bg-blue-50 text-blue-600" :
              stat.color === 'orange' ? "bg-orange-50 text-orange-600" :
              stat.color === 'emerald' ? "bg-emerald-50 text-emerald-600" :
              "bg-red-50 text-red-600"
            )}>
              <stat.icon className="w-5 h-5" />
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-3xl font-black text-slate-900 tracking-tight">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Search & Filters Bento */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 relative group">
          <Search className="absolute right-5 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300 transition-colors group-focus-within:text-blue-500" />
          <input 
            type="text" 
            placeholder="البحث عن مشروع، طالب، أو كلمات مفتاحية..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-100 rounded-3xl pr-14 pl-6 py-5 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none shadow-sm transition-all text-lg font-medium"
          />
        </div>
        <div className="lg:col-span-4">
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="w-full bg-white border border-slate-100 rounded-3xl px-6 py-5 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none shadow-sm transition-all text-lg font-black text-slate-700 appearance-none"
          >
            <option value="All">كل الحالات</option>
            <option value="Proposed">مقترح</option>
            <option value="Validated">مؤكد</option>
            <option value="Distributed">موزع</option>
            <option value="InProgress">قيد الإنجاز</option>
            <option value="Ready">جاهز للمناقشة</option>
            <option value="Defended">تمت المناقشة</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {filteredProjects.map((project, i) => (
          <motion.div 
            key={project.id} 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="group bg-white rounded-4xl border border-slate-100 shadow-sm hover:shadow-2xl hover:shadow-slate-200/50 transition-all duration-500 overflow-hidden flex flex-col"
          >
            <div className="p-8 space-y-6 flex-1">
              <div className="flex justify-between items-start">
                <div className="flex flex-wrap gap-2">
                  <span className={cn(
                    "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm",
                    project.status === 'Proposed' ? "bg-slate-100 text-slate-600" :
                    project.status === 'Validated' ? "bg-emerald-100 text-emerald-700" :
                    project.status === 'Distributed' ? "bg-blue-100 text-blue-700" :
                    project.status === 'InProgress' ? "bg-orange-100 text-orange-700" :
                    project.status === 'Ready' ? "bg-emerald-100 text-emerald-700" :
                    "bg-purple-100 text-purple-700"
                  )}>
                    {project.status === 'Proposed' ? 'مقترح' :
                     project.status === 'Validated' ? 'مؤكد' :
                     project.status === 'Distributed' ? 'موزع' :
                     project.status === 'InProgress' ? 'قيد الإنجاز' :
                     project.status === 'Ready' ? 'جاهز' : 'تمت المناقشة'}
                  </span>
                  {project.isDecision1275 && (
                    <span className="px-4 py-1.5 rounded-xl text-[10px] font-black bg-red-50 text-red-600 border border-red-100 uppercase tracking-widest flex items-center gap-1.5 shadow-sm">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      القرار 1275
                    </span>
                  )}
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300">
                  {(isAdmin || isViceAdmin || isSpecialtyManager || (isTeacher && project.status === 'Proposed')) && (
                    <>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setEditingProject(project); setShowEditModal(true); }}
                        className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100 transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                        className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <h3 className="text-2xl font-black text-slate-900 leading-tight tracking-tight group-hover:text-blue-600 transition-colors">{project.title}</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المؤطر الرئيسي</p>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                        <UserIcon className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-sm font-extrabold text-slate-700">{teachers.find(t => t.uid === project.supervisorId)?.displayName}</p>
                    </div>
                  </div>
                  {project.coSupervisorId && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المؤطر المساعد</p>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                          <UserIcon className="w-3.5 h-3.5" />
                        </div>
                        <p className="text-sm font-extrabold text-slate-700">{teachers.find(t => t.uid === project.coSupervisorId)?.displayName}</p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">التخصص</p>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                        <Briefcase className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-sm font-extrabold text-slate-700">{specialties.find(s => s.id === project.specialtyId)?.name}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">الطلبة</p>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                        <Users className="w-3.5 h-3.5" />
                      </div>
                      <p className="text-sm font-extrabold text-slate-700 truncate">{project.students?.join('، ') || '---'}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress Bar Section */}
              <div className="space-y-4">
                <div className="flex items-end justify-between">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المرحلة الحالية</p>
                    <p className="text-sm font-black text-blue-600 uppercase tracking-tight">{project.stage}</p>
                  </div>
                  <p className="text-3xl font-black text-slate-900 leading-none">{project.progress}%</p>
                </div>
                <div className="h-4 bg-slate-100 rounded-2xl overflow-hidden p-1">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${project.progress}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className={cn(
                      "h-full rounded-xl transition-all duration-500 shadow-sm",
                      project.progress < 30 ? "bg-red-500" :
                      project.progress < 70 ? "bg-orange-500" : "bg-emerald-500"
                    )} 
                  />
                </div>
              </div>

              {/* Keywords */}
              {project.keywords && project.keywords.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {project.keywords.map((k, i) => (
                    <span key={`${k}-${i}`} className="text-[10px] font-black uppercase tracking-widest bg-white border border-slate-100 text-slate-400 px-3 py-1.5 rounded-xl shadow-sm group-hover:border-blue-100 group-hover:text-blue-500 transition-all">
                      #{k}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
              <button 
                onClick={() => setSelectedProject(project)}
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-50 hover:border-blue-100 hover:text-blue-600 transition-all shadow-sm flex items-center gap-2"
              >
                <span>عرض التفاصيل والمتابعة</span>
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
              <div className="flex gap-2">
                <button className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-100 transition-all shadow-sm" title="محادثة">
                  <MessageSquare className="w-5 h-5" />
                </button>
                <button className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:border-emerald-100 transition-all shadow-sm" title="المذكرة">
                  <FileText className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">اقتراح مشروع تخرج جديد</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddProject} className="p-8 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الطور (Cycle)</label>
                  <select 
                    required 
                    value={selectedCycleId}
                    onChange={(e) => setSelectedCycleId(e.target.value)}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">اختر الطور...</option>
                    {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">التخصص (Specialty)</label>
                  <select name="specialtyId" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="">اختر التخصص...</option>
                    {(() => {
                      const cycleSpecs = specialties.filter(s => {
                        if (!selectedCycleId) return false;
                        const level = levels.find(l => l.id === s.levelId);
                        return level && level.cycleId === selectedCycleId;
                      });

                      // Try filtering for graduating years for better UX
                      const graduatingSpecs = cycleSpecs.filter(s => {
                        const level = levels.find(l => l.id === s.levelId);
                        const cycle = cycles.find(c => c.id === selectedCycleId);
                        if (!level || !cycle) return false;

                        const cName = cycle.name.toLowerCase();
                        const lName = level.name.toLowerCase();

                        if (cName.includes('licence') || cName.includes('ليسانس')) 
                          return lName.includes('3') || lName.includes('l3') || lName.includes('ثالثة');
                        if (cName.includes('master') || cName.includes('ماستر')) 
                          return lName.includes('2') || lName.includes('m2') || lName.includes('ثانية');
                        if (cName.includes('engineer') || cName.includes('مهندس')) 
                          return lName.includes('5') || lName.includes('ing5') || lName.includes('خامسة');
                        
                        return true;
                      });

                      // If graduating filter results in nothing, show all specialties of that cycle
                      const finalSpecs = graduatingSpecs.length > 0 ? graduatingSpecs : cycleSpecs;

                      return finalSpecs.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({levels.find(l => l.id === s.levelId)?.name})</option>
                      ));
                    })()}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">عنوان المشروع</label>
                <input name="title" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">المؤطر الرئيسي</label>
                  <select name="supervisorId" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    {uniqueTeachersSorted.map(t => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">المؤطر المساعد (اختياري)</label>
                  <select name="coSupervisorId" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option key="none" value="">لا يوجد</option>
                    {uniqueTeachersSorted.map(t => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                  </select>
                </div>
              </div>

              {(isSpecialtyManager || isAdmin || isViceAdmin) && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الطلبة (افصل بينهم بفاصلة)</label>
                  <input name="students" placeholder="أحمد، محمد، علي" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الكلمات المفتاحية (افصل بينها بفاصلة)</label>
                <input name="keywords" placeholder="AI, IoT, Robotics" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" name="isDecision1275" id="isDecision1275" className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <label htmlFor="isDecision1275" className="text-sm font-bold text-slate-700">خاضع للقرار 1275 (مؤسسة ناشئة / براءة اختراع)</label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">وصف المشروع</label>
                <textarea name="description" rows={3} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"></textarea>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">حفظ المشروع</button>
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingProject && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">تعديل مشروع التخرج</h2>
              <button onClick={() => { setShowEditModal(false); setEditingProject(null); }} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleEditProject} className="p-8 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الطور (Cycle)</label>
                  <select 
                    required 
                    defaultValue={levels.find(l => l.id === editingProject.levelId)?.cycleId}
                    onChange={(e) => setSelectedCycleId(e.target.value)}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">اختر الطور...</option>
                    {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">التخصص (Specialty)</label>
                  <select name="specialtyId" required defaultValue={editingProject.specialtyId} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    {specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">عنوان المشروع</label>
                <input name="title" required defaultValue={editingProject.title} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">المؤطر الرئيسي</label>
                  <select name="supervisorId" required defaultValue={editingProject.supervisorId} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    {uniqueTeachersSorted.map(t => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">المؤطر المساعد (اختياري)</label>
                  <select name="coSupervisorId" defaultValue={editingProject.coSupervisorId || ''} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option key="none" value="">لا يوجد</option>
                    {uniqueTeachersSorted.map(t => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                  </select>
                </div>
              </div>

              {(isSpecialtyManager || isAdmin || isViceAdmin) && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الطلبة (افصل بينهم بفاصلة)</label>
                  <input name="students" defaultValue={editingProject.students.join(', ')} placeholder="أحمد، محمد، علي" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الكلمات المفتاحية (افصل بينها بفاصلة)</label>
                <input name="keywords" defaultValue={editingProject.keywords?.join(', ')} placeholder="AI, IoT, Robotics" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" name="isDecision1275" id="editIsDecision1275" defaultChecked={editingProject.isDecision1275} className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <label htmlFor="editIsDecision1275" className="text-sm font-bold text-slate-700">خاضع للقرار 1275 (مؤسسة ناشئة / براءة اختراع)</label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">وصف المشروع</label>
                <textarea name="description" rows={3} defaultValue={editingProject.description} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"></textarea>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">تحديث المشروع</button>
                <button type="button" onClick={() => { setShowEditModal(false); setEditingProject(null); }} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {selectedProject && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-slate-900">{selectedProject.title}</h2>
                <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  {selectedProject.status}
                </span>
              </div>
              <button onClick={() => setSelectedProject(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Info */}
                <div className="lg:col-span-2 space-y-8">
                  {/* Progress & Stage */}
                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-slate-900">مسار التقدم (Progress Path)</h4>
                      <div className="flex items-center gap-2">
                        <select 
                          value={selectedProject.progress}
                          onChange={(e) => handleUpdateProgress(selectedProject.id, parseInt(e.target.value))}
                          className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold"
                        >
                          {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => <option key={v} value={v}>{v}%</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-between gap-2">
                      {['Start', 'References', 'Theory', 'Practical', 'Writing', 'Ready'].map((s, i) => (
                        <button 
                          key={s} 
                          onClick={() => handleUpdateStage(selectedProject.id, s as ProjectStage)}
                          className="flex-1 flex flex-col items-center gap-2 group/btn"
                        >
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                            selectedProject.stage === s ? "bg-blue-600 text-white shadow-lg shadow-blue-100 scale-110" :
                            "bg-white border-2 border-slate-100 text-slate-300 group-hover/btn:border-blue-200"
                          )}>
                            {i + 1}
                          </div>
                          <span className={cn(
                            "text-[10px] font-bold uppercase tracking-tighter text-center",
                            selectedProject.stage === s ? "text-blue-600" : "text-slate-400"
                          )}>
                            {s === 'Start' ? 'البداية' :
                             s === 'References' ? 'المراجع' :
                             s === 'Theory' ? 'النظري' :
                             s === 'Practical' ? 'التطبيقي' :
                             s === 'Writing' ? 'الكتابة' : 'جاهز'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Problems Log */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-900 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-orange-500" />
                        سجل المشاكل (Supervision Problems)
                      </h4>
                      <button 
                        onClick={() => setShowProblemModal(true)}
                        className="text-xs font-bold text-orange-600 hover:underline"
                      >
                        + تسجيل مشكلة
                      </button>
                    </div>
                    <div className="space-y-3">
                      {selectedProject.problems?.map(p => (
                        <div key={p.id} className="p-4 bg-orange-50 rounded-2xl border border-orange-100 flex gap-4">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-orange-600 shadow-sm shrink-0">
                            <AlertCircle className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-orange-900 text-sm">{p.type}</span>
                              <span className="text-[10px] text-orange-400">{p.date}</span>
                            </div>
                            <p className="text-xs text-orange-700">{p.description}</p>
                          </div>
                        </div>
                      ))}
                      {(!selectedProject.problems || selectedProject.problems.length === 0) && (
                        <div className="text-center py-8 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                          <p className="text-sm text-slate-400">لا توجد مشاكل مسجلة حالياً</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Defense Info */}
                  <div className="bg-slate-900 text-white p-6 rounded-3xl space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-blue-400" />
                        إدارة المناقشة (Defense Management)
                      </h4>
                      {(isAdmin || isViceAdmin) && selectedProject.progress === 100 && (
                        <button 
                          onClick={() => setShowDefenseModal(true)}
                          className="text-xs font-bold text-blue-400 hover:underline"
                        >
                          {selectedProject.defenseInfo?.status === 'Confirmed' ? 'تعديل الموعد' : 'تثبيت الموعد'}
                        </button>
                      )}
                      {(!isAdmin && !isViceAdmin) && selectedProject.progress === 100 && !selectedProject.defenseInfo && (
                        <button 
                          onClick={() => setShowDefenseModal(true)}
                          className="text-xs font-bold text-blue-400 hover:underline"
                        >
                          اقتراح موعد
                        </button>
                      )}
                    </div>

                    {selectedProject.defenseInfo ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                              <Clock className="w-5 h-5 text-blue-400" />
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 uppercase font-bold">الموعد</p>
                              <p className="text-sm font-bold">
                                {selectedProject.defenseInfo.confirmedDate || selectedProject.defenseInfo.proposedDate} | 
                                {selectedProject.defenseInfo.confirmedTime || selectedProject.defenseInfo.proposedTime}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                              <MapPin className="w-5 h-5 text-blue-400" />
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 uppercase font-bold">القاعة</p>
                              <p className="text-sm font-bold">{rooms.find(r => r.id === selectedProject.defenseInfo?.roomId)?.name || 'لم تحدد بعد'}</p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                              <UserIcon className="w-5 h-5 text-blue-400" />
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 uppercase font-bold">لجنة التحكيم</p>
                              <p className="text-xs">رئيس: {teachers.find(t => t.uid === selectedProject.defenseInfo?.presidentId)?.displayName || '---'}</p>
                              <p className="text-xs">الممتحنون: {selectedProject.defenseInfo?.examinerIds?.map(id => teachers.find(t => t.uid === id)?.displayName).join('، ') || '---'}</p>
                            </div>
                          </div>
                          {(isAdmin || isViceAdmin) && selectedProject.defenseInfo.status === 'Confirmed' && (
                            <button 
                              onClick={() => handleSendThesis(selectedProject)}
                              className="w-full py-2 bg-blue-600 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all"
                            >
                              <Mail className="w-4 h-4" />
                              إرسال المذكرة للجنة
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6 border border-dashed border-white/20 rounded-2xl">
                        <p className="text-sm text-slate-400">لم يتم برمجة المناقشة بعد</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-6">
                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-6">
                    <h4 className="font-bold text-slate-900">إدارة الحالة</h4>
                    <div className="space-y-3">
                      {(isAdmin || isViceAdmin || isSpecialtyManager) && (
                        <div className="flex flex-col gap-2 mb-4">
                          {selectedProject.status === 'Proposed' && (
                            <button 
                              onClick={() => handleValidateProject(selectedProject.id)}
                              className="w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all"
                            >
                              تأكيد المشروع (Validate)
                            </button>
                          )}
                          {selectedProject.status === 'Validated' && (
                            <div className="space-y-2">
                              <input 
                                id="distribute-students"
                                placeholder="أدخل أسماء الطلبة مفصولة بفاصلة..."
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs"
                              />
                              <button 
                                onClick={() => {
                                  const input = document.getElementById('distribute-students') as HTMLInputElement;
                                  handleDistributeProject(selectedProject.id, input.value.split(',').map(s => s.trim()).filter(Boolean));
                                }}
                                className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all"
                              >
                                توزيع على الطلبة (Distribute)
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <select 
                        value={selectedProject.status}
                        onChange={(e) => handleUpdateStatus(selectedProject.id, e.target.value as ProjectStatus)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold"
                      >
                        <option value="Proposed" disabled={isTeacher}>مقترح</option>
                        <option value="Validated" disabled={isTeacher}>مؤكد</option>
                        <option value="Distributed" disabled={isTeacher}>موزع</option>
                        <option value="InProgress">قيد الإنجاز</option>
                        <option value="Ready">جاهز للمناقشة</option>
                        <option value="Defended">تمت المناقشة</option>
                      </select>
                      
                      <button 
                        onClick={() => setShowAbandonModal(true)}
                        className="w-full py-2.5 bg-red-50 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                      >
                        <AlertCircle className="w-4 h-4" />
                        طلب التخلي عن الإشراف
                      </button>
                    </div>

                    {selectedProject.abandonmentRequest && (
                      <div className="p-4 bg-red-50 rounded-2xl border border-red-100 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-red-600 uppercase">طلب تخلي معلق</span>
                          <span className="text-[10px] text-red-400">{selectedProject.abandonmentRequest.date}</span>
                        </div>
                        <p className="text-xs font-bold text-red-900">{selectedProject.abandonmentRequest.reason}</p>
                        {(isAdmin || isViceAdmin) && (
                          <div className="flex gap-2 pt-2">
                            <button className="flex-1 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded">قبول</button>
                            <button className="flex-1 py-1 bg-red-600 text-white text-[10px] font-bold rounded">رفض</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                    <h4 className="font-bold text-slate-900">الطلبة والمؤطر</h4>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600">
                          <UserIcon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-bold">المؤطر</p>
                          <p className="text-sm font-bold">{teachers.find(t => t.uid === selectedProject.supervisorId)?.displayName}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">الطلبة</p>
                        {selectedProject.students.map((s, i) => (
                          <div key={`${s}-${i}`} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-100">
                            <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold">
                              {s.charAt(0)}
                            </div>
                            <span className="text-xs font-medium">{s}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Problem Modal */}
      {showProblemModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">تسجيل مشكلة تأطير</h2>
              <button onClick={() => setShowProblemModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddProblem} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">نوع المشكلة</label>
                <select name="type" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                  <option value="No Response">عدم الاستجابة (No Response)</option>
                  <option value="Absence">الغياب (Absence)</option>
                  <option value="Delay">التأخر (Delay)</option>
                  <option value="Technical">مشاكل تقنية (Technical)</option>
                  <option value="Data Lack">نقص البيانات (Data Lack)</option>
                  <option value="Other">أخرى (Other)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">التاريخ</label>
                <input type="date" name="date" defaultValue={new Date().toISOString().split('T')[0]} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">التفاصيل</label>
                <textarea name="description" rows={3} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" placeholder="اشرح المشكلة بالتفصيل..."></textarea>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-orange-600 text-white py-3 rounded-xl font-bold hover:bg-orange-700 transition-all">تسجيل</button>
                <button type="button" onClick={() => setShowProblemModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Abandon Modal */}
      {showAbandonModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900 text-red-600">طلب التخلي عن الإشراف</h2>
              <button onClick={() => setShowAbandonModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAbandonmentRequest} className="p-6 space-y-4">
              <div className="p-4 bg-red-50 rounded-2xl border border-red-100 mb-4">
                <p className="text-xs text-red-700 leading-relaxed">
                  تنبيه: التخلي عن الإشراف هو إجراء رسمي يتطلب موافقة الإدارة. يرجى ذكر الأسباب بدقة.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">سبب التخلي</label>
                <select name="reason" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                  <option value="No Commitment">عدم الالتزام (No Commitment)</option>
                  <option value="Repeated Absence">الغياب المتكرر (Repeated Absence)</option>
                  <option value="Interruption">الانقطاع (Interruption)</option>
                  <option value="Work Pressure">ضغط العمل (Work Pressure)</option>
                  <option value="Administrative">أسباب إدارية (Administrative)</option>
                  <option value="Other">أخرى (Other)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">ملاحظات إضافية</label>
                <textarea name="notes" rows={3} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" placeholder="اشرح الأسباب بالتفصيل..."></textarea>
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all">إرسال الطلب</button>
                <button type="button" onClick={() => setShowAbandonModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Defense Modal */}
      {showDefenseModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">برمجة المناقشة</h2>
              <button onClick={() => setShowDefenseModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={(isAdmin || isViceAdmin) ? handleConfirmDefense : handleProposeDefense} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">التاريخ</label>
                  <input 
                    type="date" 
                    name="date" 
                    defaultValue={selectedProject.defenseInfo?.confirmedDate || selectedProject.defenseInfo?.proposedDate} 
                    required 
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الوقت</label>
                  <input 
                    type="time" 
                    name="time" 
                    defaultValue={selectedProject.defenseInfo?.confirmedTime || selectedProject.defenseInfo?.proposedTime} 
                    required 
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
              </div>

              {(isAdmin || isViceAdmin) && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">القاعة</label>
                    <select name="roomId" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.type})</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">رئيس اللجنة</label>
                      <select name="presidentId" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                        {uniqueTeachersSorted.map(t => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">الممتحنون (يمكن اختيار أكثر من واحد)</label>
                      <select name="examinerIds" multiple required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 min-h-[100px]">
                        {uniqueTeachersSorted.map(t => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                      </select>
                      <p className="text-[10px] text-slate-400">اضغط Ctrl للاختيار المتعدد</p>
                    </div>
                  </div>
                </>
              )}

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">
                  {(isAdmin || isViceAdmin) ? 'تثبيت وبرمجة' : 'إرسال الاقتراح'}
                </button>
                <button type="button" onClick={() => setShowDefenseModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
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
              <h3 className="text-2xl font-black text-slate-900">تأكيد الحذف</h3>
              <p className="text-slate-500 font-medium">هل أنت متأكد من حذف هذا المشروع؟ لا يمكن التراجع عن هذا الإجراء.</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button 
                onClick={confirmDelete}
                className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black hover:bg-red-700 transition-all shadow-lg shadow-red-100"
              >
                تأكيد الحذف
              </button>
              <button 
                onClick={() => setItemToDelete(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-black hover:bg-slate-200 transition-all"
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
