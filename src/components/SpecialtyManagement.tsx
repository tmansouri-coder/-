import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, writeBatch, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Specialty, Cycle, Level, Module, Student } from '../types';
import { 
  Plus, Search, Settings, Trash2, Edit2, X, 
  GraduationCap, BookOpen, ChevronDown, ChevronRight,
  Layers, Filter, RefreshCw, Database, Users, Download, Upload, FileText
} from 'lucide-react';
import { cn, mapLevelName } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import { seedInitialData } from '../lib/seed';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

export default function SpecialtyManagement() {
  const { user, isAdmin, isViceAdmin } = useAuth();
  const { selectedYear } = useAcademicYear();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCycle, setActiveCycle] = useState<string | 'all'>('all');
  const [expandedSpecialties, setExpandedSpecialties] = useState<Set<string>>(new Set());
  const [showModuleModal, setShowModuleModal] = useState<{ specialtyId: string, semester: 'S1' | 'S2' } | null>(null);
  const [showStudentModal, setShowStudentModal] = useState<Specialty | null>(null);
  const [showAddModal, setShowAddModal] = useState<{ type: 'level' | 'specialty', parentId?: string } | null>(null);
  const [editingEntity, setEditingEntity] = useState<{ id: string, name: string, type: 'level' | 'specialty', cycleId?: string, levelId?: string, field?: string } | null>(null);
  const [editingModule, setEditingModule] = useState<Module | null>(null);

  const getLevelRank = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('1') || lower.includes('first') || lower.includes('أولى')) return 1;
    if (lower.includes('2') || lower.includes('second') || lower.includes('ثانية')) return 2;
    if (lower.includes('3') || lower.includes('third') || lower.includes('ثالثة')) return 3;
    if (lower.includes('4') || lower.includes('fourth') || lower.includes('رابعة')) return 4;
    if (lower.includes('5') || lower.includes('fifth') || lower.includes('خامسة')) return 5;
    return 99;
  };

  const getCycleRank = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('licence') || lower.includes('ليسانس')) return 1;
    if (lower.includes('master') || lower.includes('ماستر')) return 2;
    if (lower.includes('engineer') || lower.includes('مهندس')) return 3;
    return 99;
  };

  const [confirmDelete, setConfirmDelete] = useState<{ id: string, type: 'level' | 'specialty' | 'module' | 'student' | 'seed', name?: string } | null>(null);

  const handleDeleteEntity = async (id: string, type: 'level' | 'specialty' | 'module' | 'student' | 'seed') => {
    if (!id) {
      toast.error('معرف غير صالح');
      return;
    }
    
    if (type === 'module') {
      await handleDeleteModule(id);
      return;
    }

    if (type === 'student') {
      await executeDeleteStudent(id);
      return;
    }

    if (type === 'seed') {
      setSeeding(true);
      setConfirmDelete(null);
      try {
        await seedInitialData(true);
        toast.success('تم توليد البيانات بنجاح!');
        await fetchData();
      } catch (err) {
        console.error('Seed failed:', err);
        toast.error('فشل في توليد البيانات: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setSeeding(false);
      }
      return;
    }
    
    const loadingToast = toast.loading('جاري الحذف...');
    try {
      const collectionName = type === 'specialty' ? 'specialties' : 'levels';
      console.log(`[SpecialtyManagement] Attempting to delete ${type} with ID: ${id} from collection: ${collectionName}`);
      
      await deleteDoc(doc(db, collectionName, id));
      
      if (type === 'level') {
        setLevels(prev => prev.filter(l => l.id !== id));
        setSpecialties(prev => prev.filter(s => s.levelId !== id));
      } else {
        setSpecialties(prev => prev.filter(s => s.id !== id));
      }
      
      toast.success('تم الحذف بنجاح', { id: loadingToast });
      setConfirmDelete(null);
    } catch (err: any) {
      console.error(`[SpecialtyManagement] Error deleting ${type}:`, err);
      toast.error('فشل عملية الحذف: ' + (err?.message || 'خطأ غير معروف'), { id: loadingToast });
    }
  };

  const handleUpdateEntity = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingEntity) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;

    try {
      const collectionName = editingEntity.type === 'specialty' ? 'specialties' : 'levels';
      const updateData: any = { name };
      if (editingEntity.type === 'level') updateData.cycleId = formData.get('cycleId');
      if (editingEntity.type === 'specialty') {
        updateData.levelId = formData.get('levelId');
        updateData.field = formData.get('field');
      }

      await updateDoc(doc(db, collectionName, editingEntity.id), updateData);
      
      if (editingEntity.type === 'level') {
        const updatedLevels = levels.map(l => l.id === editingEntity.id ? { ...l, ...updateData } : l);
        setLevels(updatedLevels.sort((a, b) => {
          const cycleA = cycles.find(c => c.id === a.cycleId);
          const cycleB = cycles.find(c => c.id === b.cycleId);
          const cycleDiff = getCycleRank(cycleA?.name || '') - getCycleRank(cycleB?.name || '');
          if (cycleDiff !== 0) return cycleDiff;
          return getLevelRank(a.name) - getLevelRank(b.name);
        }));
      } else {
        setSpecialties(prev => prev.map(s => s.id === editingEntity.id ? { ...s, ...updateData } : s).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      }
      
      setEditingEntity(null);
      toast.success('تم التحديث بنجاح');
    } catch (err) {
      console.error(`Error updating ${editingEntity.type}:`, err);
      toast.error('فشل عملية التحديث');
    }
  };

  const handleAddEntity = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showAddModal) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;

    try {
      if (showAddModal.type === 'level') {
        const cycleId = formData.get('cycleId') as string;
        const docRef = await addDoc(collection(db, 'levels'), { name, cycleId });
        const newLevel = { id: docRef.id, name, cycleId };
        const updatedLevels = [...levels, newLevel];
        setLevels(updatedLevels.sort((a, b) => {
          const cycleA = cycles.find(c => c.id === a.cycleId);
          const cycleB = cycles.find(c => c.id === b.cycleId);
          const cycleDiff = getCycleRank(cycleA?.name || '') - getCycleRank(cycleB?.name || '');
          if (cycleDiff !== 0) return cycleDiff;
          return getLevelRank(a.name) - getLevelRank(b.name);
        }));
        toast.success('تم إضافة المستوى بنجاح');
      } else if (showAddModal.type === 'specialty') {
        const levelId = formData.get('levelId') as string;
        const field = formData.get('field') as string;
        const docRef = await addDoc(collection(db, 'specialties'), { name, levelId, field });
        const specData = { id: docRef.id, name, levelId, field };
        setSpecialties(prev => [...prev, specData as Specialty].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
        toast.success('تم إضافة التخصص بنجاح');
      }
      setShowAddModal(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, (showAddModal.type === 'specialty' ? 'specialties' : 'levels'));
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [cyclesSnap, levelsSnap, specialtiesSnap, modulesSnap, studentsSnap] = await Promise.all([
        getDocs(collection(db, 'cycles')),
        getDocs(collection(db, 'levels')),
        getDocs(collection(db, 'specialties')),
        getDocs(collection(db, 'modules')),
        getDocs(query(collection(db, 'students'), where('academicYear', '==', selectedYear)))
      ]);

      const fetchedCycles = cyclesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cycle))
        .sort((a, b) => getCycleRank(a.name) - getCycleRank(b.name));
      const fetchedLevels = levelsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Level))
        .sort((a, b) => {
          const cycleA = fetchedCycles.find(c => c.id === a.cycleId);
          const cycleB = fetchedCycles.find(c => c.id === b.cycleId);
          const cycleDiff = getCycleRank(cycleA?.name || '') - getCycleRank(cycleB?.name || '');
          if (cycleDiff !== 0) return cycleDiff;
          return getLevelRank(a.name) - getLevelRank(b.name);
        });
      let fetchedSpecialties = specialtiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Specialty))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      
      // Fetch all modules (shared across years)
      const fetchedModules = modulesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Module));
      const fetchedStudents = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));

      // Filter for specialty managers
      if (user?.role === 'specialty_manager' && user.specialtyIds) {
        fetchedSpecialties = fetchedSpecialties.filter(s => user.specialtyIds?.includes(s.id));
      }

      setCycles(fetchedCycles);
      setLevels(fetchedLevels);
      setSpecialties(fetchedSpecialties);
      setModules(fetchedModules);
      setStudents(fetchedStudents);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'specialty_management_data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedYear]);

  const handleDownloadTemplate = () => {
    const data = [
      ["الاسم الكامل", "رقم التسجيل"],
      ["محمد علي", "2024001"],
      ["أحمد محمود", "2024002"]
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الطلبة");
    
    // Generate buffer and download
    XLSX.writeFile(wb, "student_template.xlsx");
  };

  const handleImportStudents = async (e: React.ChangeEvent<HTMLInputElement>, specialty: Specialty) => {
    const file = e.target.files?.[0];
    if (!file || !specialty) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        // Skip header
        const studentLines = jsonData.slice(1);
        const batch = writeBatch(db);
        const newStudents: Student[] = [];

        for (const row of studentLines) {
          const name = row[0]?.toString().trim();
          const regNum = row[1]?.toString().trim();
          
          if (!name) continue;

          const studentData: Omit<Student, 'id'> = {
            name,
            registrationNumber: regNum || '',
            specialtyId: specialty.id,
            levelId: specialty.levelId,
            cycleId: levels.find(l => l.id === specialty.levelId)?.cycleId || '',
            academicYear: selectedYear,
            createdAt: new Date().toISOString()
          };

          const docRef = doc(collection(db, 'students'));
          batch.set(docRef, studentData);
          newStudents.push({ id: docRef.id, ...studentData });
        }

        if (newStudents.length === 0) {
          toast.error('لم يتم العثور على بيانات صالحة في الملف');
          return;
        }

        await batch.commit();
        setStudents(prev => [...prev, ...newStudents]);
        toast.success(`تم استيراد ${newStudents.length} طالب بنجاح`);
      } catch (err) {
        console.error('Import error:', err);
        toast.error('فشل استيراد الطلبة. يرجى التأكد من صحة الملف.');
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset input
    e.target.value = '';
  };

  const handleDeleteStudent = async (id: string) => {
    setConfirmDelete({ id, type: 'student', name: students.find(s => s.id === id)?.name || '' });
  };

  const executeDeleteStudent = async (id: string) => {
    const loadingToast = toast.loading('جاري الحذف...');
    try {
      await deleteDoc(doc(db, 'students', id));
      setStudents(prev => prev.filter(s => s.id !== id));
      toast.success('تم حذف الطالب', { id: loadingToast });
      setConfirmDelete(null);
    } catch (err) {
      console.error('Error deleting student:', err);
      toast.error('فشل حذف الطالب', { id: loadingToast });
    }
  };

  const handleSeed = async () => {
    setConfirmDelete({ id: 'seed', type: 'seed', name: 'قاعدة البيانات' });
  };

  const toggleSpecialty = (id: string) => {
    const newSet = new Set(expandedSpecialties);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedSpecialties(newSet);
  };

  const handleAddModule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showModuleModal) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;

    try {
      const docRef = await addDoc(collection(db, 'modules'), {
        name,
        specialtyId: showModuleModal.specialtyId,
        semester: showModuleModal.semester,
        credits: 4,
        coefficient: 2,
        academicYear: selectedYear
      });
      setModules(prev => [...prev, { 
        id: docRef.id, 
        name, 
        specialtyId: showModuleModal.specialtyId, 
        semester: showModuleModal.semester,
        credits: 4,
        coefficient: 2,
        academicYear: selectedYear
      }]);
      setShowModuleModal(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'modules');
    }
  };

  const handleEditModule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingModule) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;

    try {
      await updateDoc(doc(db, 'modules', editingModule.id), { name });
      setModules(prev => prev.map(m => m.id === editingModule.id ? { ...m, name } : m));
      setEditingModule(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'modules/' + editingModule.id);
    }
  };

  const handleDeleteModule = async (id: string) => {
    const loadingToast = toast.loading('جاري الحذف...');
    try {
      await deleteDoc(doc(db, 'modules', id));
      setModules(prev => prev.filter(m => m.id !== id));
      toast.success('تم حذف المقياس بنجاح', { id: loadingToast });
    } catch (err) {
      console.error('Error deleting module:', err);
      toast.error('فشل حذف المقياس', { id: loadingToast });
    }
  };

  if (loading) return (
    <div className="h-96 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  const filteredSpecialties = specialties.filter(s => {
    const matchesSearch = (s.name?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    if (activeCycle === 'all') return matchesSearch;
    
    // Find levels for this cycle
    const cycleLevels = levels.filter(l => l.cycleId === activeCycle).map(l => l.id);
    return matchesSearch && cycleLevels.includes(s.levelId);
  });

  return (
    <div className="space-y-10 pb-12" dir="rtl">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">بوابة التخصصات</h1>
          <p className="text-slate-500 font-medium">تصفح التخصصات، المقاييس، وقوائم الطلبة حسب الأطوار الأكاديمية</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative group">
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 transition-colors group-focus-within:text-blue-500" />
            <input 
              type="text" 
              placeholder="بحث عن تخصص..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full md:w-80 pr-12 pl-6 py-3.5 bg-white border border-slate-100 rounded-2xl text-sm font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
            />
          </div>
          {(isAdmin || isViceAdmin) && (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowAddModal({ type: 'level', parentId: activeCycle !== 'all' ? activeCycle : undefined })}
                className="h-12 px-6 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center gap-2 font-black text-xs uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة مستوى</span>
              </button>
              <button 
                onClick={() => setShowAddModal({ type: 'specialty' })}
                className="h-12 px-6 bg-blue-600 text-white rounded-2xl flex items-center gap-2 font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>تخصص جديد</span>
              </button>
            </div>
          )}
          <button 
            onClick={fetchData}
            className="w-12 h-12 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-100 transition-all shadow-sm"
            title="تحديث البيانات"
          >
            <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Cycle Tabs Bento */}
      <div className="bg-white p-2 rounded-3xl border border-slate-100 shadow-sm flex flex-wrap gap-2 w-fit">
        <button
          onClick={() => setActiveCycle('all')}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all whitespace-nowrap",
            activeCycle === 'all' 
              ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          )}
        >
          <Filter className="w-4 h-4" />
          <span>الكل</span>
        </button>
        {cycles.map(cycle => (
          <button
            key={cycle.id}
            onClick={() => setActiveCycle(cycle.id)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all whitespace-nowrap",
              activeCycle === cycle.id 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            <Layers className="w-4 h-4" />
            <span>{cycle.name}</span>
          </button>
        ))}
      </div>

      {/* Specialties Grid grouped by Level */}
      <div className="space-y-12">
        {levels
          .filter(l => activeCycle === 'all' || l.cycleId === activeCycle)
          .map((level, levelIdx) => {
            const levelSpecs = specialties.filter(s => 
              s.levelId === level.id && 
              (s.name?.toLowerCase() || '').includes(searchQuery.toLowerCase())
            );

            // If a specific cycle is selected, show all levels of that cycle even if empty
            // If 'all' cycles are selected, skip levels that have no matching specialties
            if (activeCycle === 'all' && levelSpecs.length === 0) return null;

            return (
              <div key={level.id} className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-1.5 h-8 bg-blue-600 rounded-full"></div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                        {mapLevelName(level.name, cycles.find(c => c.id === level.cycleId)?.name || '')}
                      </h2>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        {cycles.find(c => c.id === level.cycleId)?.name} • {levelSpecs.length} تخصصات
                      </p>
                    </div>
                  </div>
                  {(isAdmin || isViceAdmin) && (
                    <div className="flex items-center gap-2">
                       <button 
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingEntity({ 
                            id: level.id, 
                            name: level.name, 
                            type: 'level', 
                            cycleId: level.cycleId 
                          });
                        }}
                        className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-blue-600 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmDelete({ id: level.id, type: 'level' });
                        }}
                        className="p-2 hover:bg-slate-50 rounded-xl text-red-500 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAddModal({ type: 'specialty', parentId: level.id });
                        }}
                        className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl flex items-center gap-2 font-black text-[10px] uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                        <span>تخصص جديد بهذا المستوى</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-8">
                  {levelSpecs.map((specialty, i) => {
                    const isExpanded = expandedSpecialties.has(specialty.id);
                    const specModules = modules.filter(m => m.specialtyId === specialty.id);
                    const specStudents = students.filter(s => s.specialtyId === specialty.id);
                    const s1Modules = specModules.filter(m => m.semester === 'S1');
                    const s2Modules = specModules.filter(m => m.semester === 'S2');

                    return (
                      <motion.div 
                        key={specialty.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        layout
                        className="bg-white rounded-4xl border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500 overflow-hidden group"
                      >
                        <div 
                          onClick={() => toggleSpecialty(specialty.id)}
                          className="p-8 flex flex-col md:flex-row md:items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors gap-6"
                        >
                          <div className="flex items-center gap-6">
                            <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all duration-500 shadow-sm">
                              <GraduationCap className="w-8 h-8" />
                            </div>
                            <div>
                              <div className="flex items-center gap-4">
                                <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-1">{specialty.name}</h3>
                              </div>
                              <div className="flex flex-wrap items-center gap-3">
                                {specialty.field && (
                                  <span className="px-3 py-1 rounded-lg bg-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-widest">{specialty.field}</span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-6">
                            {(isAdmin || isViceAdmin) && (
                              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <button 
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setConfirmDelete({ id: specialty.id, type: 'specialty' });
                                  }}
                                  className="w-10 h-10 bg-red-50 hover:bg-red-100 border border-red-100 rounded-xl flex items-center justify-center text-red-600 transition-all shadow-sm"
                                  title="حذف التخصص"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                                <button 
                                  type="button"
                                  onClick={(e) => {
                                    console.log('Edit button clicked for specialty:', specialty.id);
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setEditingEntity({ 
                                      id: specialty.id, 
                                      name: specialty.name, 
                                      type: 'specialty', 
                                      levelId: specialty.levelId,
                                      field: specialty.field 
                                    });
                                  }} 
                                  className="w-10 h-10 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:text-blue-600 transition-all shadow-sm"
                                  title="تعديل التخصص"
                                >
                                  <Edit2 className="w-5 h-5" />
                                </button>
                              </div>
                            )}
                            
                            <div className="flex items-center gap-8 hidden md:flex">
                              <div className="flex flex-col items-center">
                                <span className="text-2xl font-black text-slate-900 leading-none mb-1">{specModules.length}</span>
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">مقاييس</span>
                              </div>
                              <div className="flex flex-col items-center">
                                <span className="text-2xl font-black text-blue-600 leading-none mb-1">{specStudents.length}</span>
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">طلبة</span>
                              </div>
                            </div>
                            <div className={cn(
                              "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500",
                              isExpanded ? "rotate-180 bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-slate-50 text-slate-400 group-hover:bg-slate-100"
                            )}>
                              <ChevronDown className="w-6 h-6" />
                            </div>
                          </div>
                        </div>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-8 pt-0 border-t border-slate-50">
                                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                                  <div className="flex items-center gap-4">
                                    <div className="w-1.5 h-8 bg-blue-600 rounded-full"></div>
                                    <h4 className="text-lg font-black text-slate-900 tracking-tight">المقاييس والطلبة</h4>
                                  </div>
                                  {(isAdmin || isViceAdmin) && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowStudentModal(specialty);
                                      }}
                                      className="flex items-center gap-2 px-6 py-3 bg-blue-50 text-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                    >
                                      <Users className="w-4 h-4" />
                                      <span>إدارة الطلبة</span>
                                    </button>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                  {/* Semester 1 */}
                                  <div className="space-y-6">
                                    <div className="flex items-center justify-between bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                          <BookOpen className="w-4 h-4" />
                                        </div>
                                        <h4 className="text-sm font-black text-emerald-900 uppercase tracking-tight">السداسي الأول (S1)</h4>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">{s1Modules.length} مقاييس</span>
                                        {(isAdmin || isViceAdmin) && (
                                          <button 
                                            onClick={() => setShowModuleModal({ specialtyId: specialty.id, semester: 'S1' })}
                                            className="w-8 h-8 bg-white text-emerald-600 rounded-xl flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                                            title="إضافة مقياس"
                                          >
                                            <Plus className="w-4 h-4" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="space-y-3">
                                      {s1Modules.length > 0 ? s1Modules.map(module => (
                                        <div key={module.id} className="flex items-center justify-between p-4 rounded-2xl bg-white border border-slate-100 group/module hover:shadow-md hover:shadow-slate-200/50 transition-all duration-300">
                                          <span className="text-sm font-extrabold text-slate-700">{module.name}</span>
                                          {(isAdmin || isViceAdmin) && (
                                            <div className="flex gap-1 opacity-0 group-hover/module:opacity-100 transition-all">
                                              <button onClick={() => setEditingModule(module)} className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-blue-600 transition-colors"><Edit2 className="w-4 h-4" /></button>
                                              <button 
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setConfirmDelete({ id: module.id, type: 'module' });
                                                }} 
                                                className="p-2 hover:bg-slate-50 rounded-xl text-red-600 transition-colors"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      )) : (
                                        <div className="py-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">لا توجد مقاييس مسجلة</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Semester 2 */}
                                  <div className="space-y-6">
                                    <div className="flex items-center justify-between bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                                          <BookOpen className="w-4 h-4" />
                                        </div>
                                        <h4 className="text-sm font-black text-blue-900 uppercase tracking-tight">السداسي الثاني (S2)</h4>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{s2Modules.length} مقاييس</span>
                                        {(isAdmin || isViceAdmin) && (
                                          <button 
                                            onClick={() => setShowModuleModal({ specialtyId: specialty.id, semester: 'S2' })}
                                            className="w-8 h-8 bg-white text-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                            title="إضافة مقياس"
                                          >
                                            <Plus className="w-4 h-4" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="space-y-3">
                                      {s2Modules.length > 0 ? s2Modules.map(module => (
                                        <div key={module.id} className="flex items-center justify-between p-4 rounded-2xl bg-white border border-slate-100 group/module hover:shadow-md hover:shadow-slate-200/50 transition-all duration-300">
                                          <span className="text-sm font-extrabold text-slate-700">{module.name}</span>
                                          {(isAdmin || isViceAdmin) && (
                                            <div className="flex gap-1 opacity-0 group-hover/module:opacity-100 transition-all">
                                              <button onClick={() => setEditingModule(module)} className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-blue-600 transition-colors"><Edit2 className="w-4 h-4" /></button>
                                              <button 
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setConfirmDelete({ id: module.id, type: 'module' });
                                                }} 
                                                className="p-2 hover:bg-slate-50 rounded-xl text-red-600 transition-colors"
                                              >
                                                <Trash2 className="w-4 h-4" />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      )) : (
                                        <div className="py-6 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">لا توجد مقاييس مسجلة</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        {(levels.filter(l => activeCycle === 'all' || l.cycleId === activeCycle).length === 0 || 
          (activeCycle === 'all' && specialties.length === 0)) && (
          <div className="h-[400px] flex flex-col items-center justify-center text-slate-400 bg-white rounded-4xl border border-dashed border-slate-200 shadow-sm p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-slate-50 flex items-center justify-center mb-6">
              <Filter className="w-10 h-10 opacity-10" />
            </div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">لا توجد نتائج مطابقة</h3>
            <p className="text-slate-500 font-medium max-w-xs mx-auto mb-8">حاول تغيير معايير البحث أو اختيار طور أكاديمي آخر</p>
            {(isAdmin || isViceAdmin) && cycles.length === 0 && (
              <button 
                onClick={handleSeed}
                disabled={seeding}
                className="btn-primary flex items-center gap-2"
              >
                <Database className="w-5 h-5" />
                <span>{seeding ? 'جاري التهيئة...' : 'تهيئة البيانات التجريبية'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Student Management Modal */}
      {showStudentModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">إدارة طلبة تخصص: {showStudentModal.name}</h2>
                  <p className="text-xs text-slate-500">استيراد وإدارة قائمة الطلبة</p>
                </div>
              </div>
              <button onClick={() => setShowStudentModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <div className="flex items-center gap-3">
                  <FileText className="w-8 h-8 text-blue-600" />
                  <div>
                    <h4 className="text-sm font-bold text-blue-900">استيراد الطلبة من ملف Excel</h4>
                    <p className="text-xs text-blue-600">قم بتحميل النموذج، املأه ثم ارفعه هنا (.xlsx)</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleDownloadTemplate}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-50 transition-all border border-blue-200"
                  >
                    <Download className="w-4 h-4" />
                    تحميل النموذج
                  </button>
                  <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all cursor-pointer shadow-sm">
                    <Upload className="w-4 h-4" />
                    رفع الملف
                    <input 
                      type="file" 
                      accept=".xlsx, .xls" 
                      className="hidden" 
                      onChange={(e) => handleImportStudents(e, showStudentModal)} 
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-700">قائمة الطلبة ({students.filter(s => s.specialtyId === showStudentModal.id).length})</h4>
                <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-3 text-xs font-bold text-slate-600">الاسم الكامل</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-600">رقم التسجيل</th>
                        <th className="px-4 py-3 text-xs font-bold text-slate-600">الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {students.filter(s => s.specialtyId === showStudentModal.id).length > 0 ? (
                        students.filter(s => s.specialtyId === showStudentModal.id).map(student => (
                          <tr key={student.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 text-sm font-medium text-slate-700">{student.name}</td>
                            <td className="px-4 py-3 text-sm text-slate-500">{student.registrationNumber || '-'}</td>
                            <td className="px-4 py-3">
                              <button 
                                onClick={() => handleDeleteStudent(student.id)}
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-slate-400 text-sm italic">لا يوجد طلبة مسجلين في هذا التخصص</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Module Modals */}
      {showModuleModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">إضافة مقياس جديد ({showModuleModal.semester})</h2>
              <button onClick={() => setShowModuleModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddModule} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">اسم المقياس</label>
                <input name="name" required autoFocus className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">إضافة</button>
                <button type="button" onClick={() => setShowModuleModal(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingModule && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">تعديل مقياس</h2>
              <button onClick={() => setEditingModule(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleEditModule} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الاسم الجديد</label>
                <input name="name" defaultValue={editingModule.name} required autoFocus className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">حفظ</button>
                <button type="button" onClick={() => setEditingModule(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">إضافة {showAddModal.type === 'level' ? 'مستوى' : 'تخصص'} جديد</h2>
              <button onClick={() => setShowAddModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddEntity} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الاسم</label>
                <input name="name" required autoFocus className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>

              {showAddModal.type === 'level' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الطور</label>
                  <select name="cycleId" defaultValue={showAddModal.parentId} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3">
                    <option value="" disabled>اختر الطور...</option>
                    {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {showAddModal.type === 'specialty' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">المستوى</label>
                    <select name="levelId" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3">
                      <option value="" disabled>اختر المستوى...</option>
                      {levels.map(l => (
                        <option key={l.id} value={l.id}>
                          {cycles.find(c => c.id === l.cycleId)?.name} - {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">المجال (LMD / مهندس...)</label>
                    <input name="field" defaultValue="LMD" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                  </div>
                </>
              )}

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">إضافة</button>
                <button type="button" onClick={() => setShowAddModal(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Edit Entity Modal */}
      {editingEntity && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">تعديل {editingEntity.type === 'level' ? 'مستوى' : 'تخصص'}</h2>
              <button onClick={() => setEditingEntity(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleUpdateEntity} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الاسم</label>
                <input name="name" defaultValue={editingEntity.name} required autoFocus className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>

              {editingEntity.type === 'level' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الطور</label>
                  <select name="cycleId" defaultValue={editingEntity.cycleId} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3">
                    {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {editingEntity.type === 'specialty' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">المستوى</label>
                    <select name="levelId" defaultValue={editingEntity.levelId} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3">
                      {levels.map(l => (
                        <option key={l.id} value={l.id}>
                          {cycles.find(c => c.id === l.cycleId)?.name} - {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">المجال</label>
                    <input name="field" defaultValue={editingEntity.field} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                  </div>
                </>
              )}

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">حفظ التغييرات</button>
                <button type="button" onClick={() => setEditingEntity(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 space-y-6 text-center" dir="rtl">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-10 h-10 text-red-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">تأكيد الحذف</h3>
              <p className="text-slate-500 mt-2">
                {confirmDelete.type === 'level' 
                  ? 'هل أنت متأكد من حذف هذا المستوى؟ سيؤدي هذا لحذف جميع التخصصات والمقاييس التابعة له.' 
                  : confirmDelete.type === 'specialty'
                  ? 'هل أنت متأكد من حذف هذا التخصص؟ سيؤدي هذا لحذف جميع المقاييس والطلبة التابعين له.'
                  : confirmDelete.type === 'module'
                  ? 'هل أنت متأكد من حذف هذا المقياس؟'
                  : confirmDelete.type === 'seed'
                  ? 'هل أنت متأكد؟ سيتم مسح كافة البيانات الحالية وتعويضها ببيانات تجريبية.'
                  : `هل أنت متأكد من حذف الطالب ${confirmDelete.name}؟`}
              </p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => handleDeleteEntity(confirmDelete.id, confirmDelete.type)}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all font-sans"
              >
                حذف نهائي
              </button>
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all font-sans"
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
