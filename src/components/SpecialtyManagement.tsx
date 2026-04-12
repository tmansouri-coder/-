import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, writeBatch, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Specialty, Cycle, Level, Module, Student } from '../types';
import { 
  Plus, Search, Settings, Trash2, Edit2, X, 
  GraduationCap, BookOpen, ChevronDown, ChevronRight,
  Layers, Filter, RefreshCw, Database, Users, Download, Upload, FileText
} from 'lucide-react';
import { cn } from '../lib/utils';
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
  const [editingModule, setEditingModule] = useState<Module | null>(null);

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

      const fetchedCycles = cyclesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cycle));
      const fetchedLevels = levelsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Level));
      let fetchedSpecialties = specialtiesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Specialty));
      
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
    if (!window.confirm('هل أنت متأكد من حذف هذا الطالب؟')) return;
    try {
      await deleteDoc(doc(db, 'students', id));
      setStudents(prev => prev.filter(s => s.id !== id));
      toast.success('تم حذف الطالب');
    } catch (err) {
      toast.error('فشل حذف الطالب');
    }
  };

  const handleSeed = async () => {
    const confirmed = window.confirm('هل تريد ملء قاعدة البيانات ببيانات تجريبية؟');
    if (!confirmed) return;
    
    setSeeding(true);
    try {
      await seedInitialData(true);
      alert('تم توليد البيانات بنجاح!');
      await fetchData();
    } catch (err) {
      console.error('Seed failed:', err);
      alert('فشل في توليد البيانات: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSeeding(false);
    }
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
    if (!window.confirm('هل أنت متأكد من حذف هذا المقياس؟')) return;
    try {
      await deleteDoc(doc(db, 'modules', id));
      setModules(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'modules/' + id);
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
    <div className="space-y-8" dir="rtl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">بوابة التخصصات</h1>
          <p className="text-slate-500">تصفح التخصصات والمقاييس حسب الأطوار الأكاديمية</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative max-w-md w-full">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="بحث عن تخصص..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pr-10 pl-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm"
            />
          </div>
          <button 
            onClick={fetchData}
            className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-blue-600 transition-all shadow-sm"
            title="تحديث البيانات"
          >
            <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Cycle Tabs */}
      <div className="flex flex-wrap gap-2 p-1 bg-slate-100 rounded-2xl w-fit max-w-full">
        <button
          onClick={() => setActiveCycle('all')}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all whitespace-nowrap",
            activeCycle === 'all' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
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
              "flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all whitespace-nowrap",
              activeCycle === cycle.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Layers className="w-4 h-4" />
            <span>{cycle.name}</span>
          </button>
        ))}
      </div>

      {/* Specialties List */}
      <div className="grid grid-cols-1 gap-6">
        {filteredSpecialties.length > 0 ? (
          filteredSpecialties.map((specialty) => {
            const isExpanded = expandedSpecialties.has(specialty.id);
            const specModules = modules.filter(m => m.specialtyId === specialty.id);
            const specStudents = students.filter(s => s.specialtyId === specialty.id);
            
            const s1Modules = specModules.filter(m => m.semester === 'S1');
            const s2Modules = specModules.filter(m => m.semester === 'S2');
            const level = levels.find(l => l.id === specialty.levelId);

            return (
              <motion.div 
                key={specialty.id}
                layout
                className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden"
              >
                <div 
                  onClick={() => toggleSpecialty(specialty.id)}
                  className="p-6 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <GraduationCap className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{specialty.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        {specialty.field && (
                          <>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{specialty.field}</span>
                            <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                          </>
                        )}
                        <span className="text-xs font-medium text-slate-500">{level?.name}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="hidden sm:flex items-center gap-6 text-xs font-bold">
                      <div className="flex flex-col items-center">
                        <span className="text-slate-900">{specModules.length}</span>
                        <span className="text-slate-400">مقاييس</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-blue-600">{specStudents.length}</span>
                        <span className="text-slate-400">طلبة</span>
                      </div>
                    </div>
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-transform",
                      isExpanded ? "rotate-180 bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-400"
                    )}>
                      <ChevronDown className="w-5 h-5" />
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
                      <div className="p-6 pt-0 border-t border-slate-50">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-4">
                            <h4 className="text-sm font-bold text-slate-900">المقاييس والطلبة</h4>
                            {(isAdmin || isViceAdmin) && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowStudentModal(specialty);
                                }}
                                className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 transition-all"
                              >
                                <Users className="w-3.5 h-3.5" />
                                إدارة الطلبة
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          {/* Semester 1 */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-emerald-600 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                السداسي الأول (S1)
                              </h4>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{s1Modules.length} مقاييس</span>
                                {(isAdmin || isViceAdmin) && (
                                  <button 
                                    onClick={() => setShowModuleModal({ specialtyId: specialty.id, semester: 'S1' })}
                                    className="p-1 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-all"
                                    title="إضافة مقياس"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {s1Modules.length > 0 ? s1Modules.map(module => (
                                <div key={module.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 group/module">
                                  <div className="flex items-center gap-3">
                                    <BookOpen className="w-4 h-4 text-slate-400" />
                                    <span className="text-sm font-medium text-slate-700">{module.name}</span>
                                  </div>
                                  {(isAdmin || isViceAdmin) && (
                                    <div className="flex gap-1 opacity-0 group-hover/module:opacity-100 transition-opacity">
                                      <button onClick={() => setEditingModule(module)} className="p-1 hover:bg-white rounded-lg text-slate-400"><Edit2 className="w-3 h-3" /></button>
                                      <button onClick={() => handleDeleteModule(module.id)} className="p-1 hover:bg-white rounded-lg text-red-600"><Trash2 className="w-3 h-3" /></button>
                                    </div>
                                  )}
                                </div>
                              )) : (
                                <p className="text-xs text-slate-400 italic py-2">لا توجد مقاييس مسجلة</p>
                              )}
                            </div>
                          </div>

                          {/* Semester 2 */}
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-blue-600 flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                السداسي الثاني (S2)
                              </h4>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{s2Modules.length} مقاييس</span>
                                {(isAdmin || isViceAdmin) && (
                                  <button 
                                    onClick={() => setShowModuleModal({ specialtyId: specialty.id, semester: 'S2' })}
                                    className="p-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all"
                                    title="إضافة مقياس"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {s2Modules.length > 0 ? s2Modules.map(module => (
                                <div key={module.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 group/module">
                                  <div className="flex items-center gap-3">
                                    <BookOpen className="w-4 h-4 text-slate-400" />
                                    <span className="text-sm font-medium text-slate-700">{module.name}</span>
                                  </div>
                                  {(isAdmin || isViceAdmin) && (
                                    <div className="flex gap-1 opacity-0 group-hover/module:opacity-100 transition-opacity">
                                      <button onClick={() => setEditingModule(module)} className="p-1 hover:bg-white rounded-lg text-slate-400"><Edit2 className="w-3 h-3" /></button>
                                      <button onClick={() => handleDeleteModule(module.id)} className="p-1 hover:bg-white rounded-lg text-red-600"><Trash2 className="w-3 h-3" /></button>
                                    </div>
                                  )}
                                </div>
                              )) : (
                                <p className="text-xs text-slate-400 italic py-2">لا توجد مقاييس مسجلة</p>
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
          })
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200">
            <Filter className="w-12 h-12 mb-4 opacity-10" />
            <p className="text-lg font-medium">لا توجد تخصصات مطابقة للبحث</p>
            {(isAdmin || isViceAdmin) && cycles.length === 0 && (
              <button 
                onClick={handleSeed}
                disabled={seeding}
                className="mt-4 flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
              >
                <Database className="w-4 h-4" />
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
    </div>
  );
}
