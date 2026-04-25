import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Cycle, Level, Module, Specialty } from '../types';
import { BookOpen, ChevronRight, Layers, GraduationCap, Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { cn, mapLevelName } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';

export default function AcademicStructure() {
  const { isAdmin, isViceAdmin } = useAuth();
  const canManage = isAdmin || isViceAdmin;
  const { selectedYear } = useAcademicYear();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCycle, setSelectedCycle] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState<{ type: 'cycle' | 'level' | 'specialty' | 'module', parentId?: string } | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: string, name: string, type: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string, type: string, name: string } | null>(null);

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

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [cycleSnap, levelSnap, specSnap, moduleSnap] = await Promise.all([
          getDocs(collection(db, 'cycles')),
          getDocs(collection(db, 'levels')),
          getDocs(collection(db, 'specialties')),
          getDocs(query(collection(db, 'modules'), where('academicYear', '==', selectedYear))),
        ]);

      setModules(moduleSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Module)));

      const cycleDocs = cycleSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cycle))
        .sort((a, b) => getCycleRank(a.name) - getCycleRank(b.name));
      const levelDocs = levelSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Level))
        .sort((a, b) => {
          const cycleA = cycleDocs.find(c => c.id === a.cycleId);
          const cycleB = cycleDocs.find(c => c.id === b.cycleId);
          const cycleDiff = getCycleRank(cycleA?.name || '') - getCycleRank(cycleB?.name || '');
          if (cycleDiff !== 0) return cycleDiff;
          return getLevelRank(a.name) - getLevelRank(b.name);
        });

      if (isAdmin) {
        const batch = writeBatch(db);
        let hasChanges = false;
        
        const migrationMap: Record<string, string> = {
          'L1': "First Year Bachelor's",
          'L2': "Second Year Bachelor's",
          'L3': "Third Year Bachelor's",
          'M1': "First Year Master's",
          'M2': "Second Year Master's"
        };

        const engineeringCycleId = cycleDocs.find(c => (c.name || '').includes('مهندس'))?.id;

        for (const level of levelDocs) {
          // 1. Rename if in map
          if (migrationMap[level.name]) {
            const newName = migrationMap[level.name];
            batch.update(doc(db, 'levels', level.id), { name: newName });
            level.name = newName;
            hasChanges = true;
          }

          // 2. Fix cycle for engineering levels
          const lowerName = (level.name || '').toLowerCase();
          const isEngName = lowerName.includes('year engineering') || 
                           (['1st', '2nd', '3rd', '4th', '5th'].some(s => lowerName.startsWith(s)) && !lowerName.includes('bachelor') && !lowerName.includes('master'));
          
          if (engineeringCycleId && isEngName && level.cycleId !== engineeringCycleId) {
            batch.update(doc(db, 'levels', level.id), { cycleId: engineeringCycleId });
            level.cycleId = engineeringCycleId;
            hasChanges = true;
          }
        }
        
        if (hasChanges) {
          await batch.commit();
          toast.success('تم تحديث الهيكل الأكاديمي');
        }
      }

      setCycles(cycleDocs);
      setLevels(levelDocs.map(l => {
        const cycle = cycleDocs.find(c => c.id === l.cycleId);
        return { ...l, name: mapLevelName(l.name, cycle?.name || '') };
      }));
      setSpecialties(specSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Specialty))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setLoading(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'academic_structure');
    }
  };
  fetchData();
}, [selectedYear]);

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showAddModal) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;

    try {
      let docRef;
      if (showAddModal.type === 'cycle') {
        docRef = await addDoc(collection(db, 'cycles'), { name });
        setCycles(prev => [...prev, { id: docRef.id, name: name as any }].sort((a, b) => getCycleRank(a.name) - getCycleRank(b.name)));
      } else if (showAddModal.type === 'level') {
        docRef = await addDoc(collection(db, 'levels'), { name, cycleId: showAddModal.parentId });
        const newLevel = { id: docRef.id, name, cycleId: showAddModal.parentId! };
        setLevels(prev => [...prev, newLevel].sort((a, b) => {
          const cycleA = cycles.find(c => c.id === a.cycleId);
          const cycleB = cycles.find(c => c.id === b.cycleId);
          const cycleDiff = getCycleRank(cycleA?.name || '') - getCycleRank(cycleB?.name || '');
          if (cycleDiff !== 0) return cycleDiff;
          return getLevelRank(a.name) - getLevelRank(b.name);
        }));
      } else if (showAddModal.type === 'specialty') {
        docRef = await addDoc(collection(db, 'specialties'), { name, levelId: showAddModal.parentId });
        setSpecialties(prev => [...prev, { id: docRef.id, name, levelId: showAddModal.parentId! }].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      } else if (showAddModal.type === 'module') {
        const semester = formData.get('semester') as 'S1' | 'S2';
        const moduleData = { 
          name, 
          specialtyId: showAddModal.parentId, 
          semester,
          academicYear: selectedYear
        };
        docRef = await addDoc(collection(db, 'modules'), moduleData);
        setModules(prev => [...prev, { id: docRef.id, ...moduleData } as Module]);
      }
      setShowAddModal(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, (showAddModal.type === 'specialty' ? 'specialties' : showAddModal.type + 's'));
    }
  };

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingItem) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;

    try {
      const collectionName = editingItem.type === 'specialty' ? 'specialties' : editingItem.type + 's';
      await updateDoc(doc(db, collectionName, editingItem.id), { name });
      
      if (editingItem.type === 'cycle') setCycles(prev => prev.map(c => c.id === editingItem.id ? { ...c, name: name as any } : c));
      if (editingItem.type === 'level') setLevels(prev => prev.map(l => l.id === editingItem.id ? { ...l, name } : l));
      if (editingItem.type === 'specialty') setSpecialties(prev => prev.map(s => s.id === editingItem.id ? { ...s, name } : s));
      if (editingItem.type === 'module') setModules(prev => prev.map(m => m.id === editingItem.id ? { ...m, name } : m));
      
      setEditingItem(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, (editingItem.type === 'specialty' ? 'specialties' : editingItem.type + 's') + '/' + editingItem.id);
    }
  };

  const handleDelete = async (id: string, type: string) => {
    if (!id) {
      toast.error('معرف غير صالح');
      return;
    }
    
    const loadingToast = toast.loading('جاري الحذف...');
    try {
      const collectionName = type === 'specialty' ? 'specialties' : type + 's';
      await deleteDoc(doc(db, collectionName, id));
      
      if (type === 'cycle') setCycles(prev => prev.filter(c => c.id !== id));
      if (type === 'level') setLevels(prev => prev.filter(l => l.id !== id));
      if (type === 'specialty') setSpecialties(prev => prev.filter(s => s.id !== id));
      if (type === 'module') setModules(prev => prev.filter(m => m.id !== id));
      
      toast.success('تم الحذف بنجاح', { id: loadingToast });
      setConfirmDelete(null);
    } catch (err) {
      console.error(`Error deleting ${type}:`, err);
      toast.error('فشل عملية الحذف', { id: loadingToast });
    }
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-10 pb-12" dir="rtl">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">الهيكل الأكاديمي</h1>
          <p className="text-slate-500 font-medium">تصفح وإدارة الأطوار، المستويات، التخصصات، والمقاييس الدراسية</p>
        </div>
        {canManage && (
          <button 
            onClick={() => setShowAddModal({ type: 'cycle' })}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span>إضافة طور جديد</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar: Cycles & Levels */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-4xl border border-slate-100 shadow-sm p-6 space-y-6">
            <div className="flex items-center gap-3 px-2">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                <Layers className="w-5 h-5" />
              </div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">الأطوار والمستويات</h2>
            </div>
            
            <div className="space-y-3">
              {cycles.map((cycle, i) => (
                <motion.div 
                  key={cycle.id} 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="space-y-2"
                >
                  <div className={cn(
                    "flex items-center justify-between p-4 rounded-2xl transition-all group relative overflow-hidden",
                    selectedCycle === cycle.id 
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  )}>
                    <button 
                      onClick={() => { setSelectedCycle(cycle.id); setSelectedLevel(null); setSelectedSpecialty(null); }}
                      className="flex-1 text-right font-black text-sm uppercase tracking-tight z-10"
                    >
                      {cycle.name}
                    </button>
                    {canManage && (
                      <div className="flex gap-1 z-10 opacity-100 transition-all">
                        <button onClick={() => setShowAddModal({ type: 'level', parentId: cycle.id })} className={cn("p-1.5 rounded-lg transition-colors bg-white/10 hover:bg-white/20", selectedCycle === cycle.id ? "text-white" : "text-blue-600")}><Plus className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingItem({ id: cycle.id, name: cycle.name, type: 'cycle' })} className={cn("p-1.5 rounded-lg transition-colors bg-white/10 hover:bg-white/20", selectedCycle === cycle.id ? "text-white" : "text-slate-400")}><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setConfirmDelete({ id: cycle.id, type: 'cycle', name: cycle.name })} className={cn("p-1.5 rounded-lg transition-colors bg-white/10 hover:bg-white/20", selectedCycle === cycle.id ? "text-white" : "text-red-600")}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                  
                  {selectedCycle === cycle.id && (
                    <div className="pr-4 space-y-2 border-r-2 border-blue-100 mr-4 py-1">
                      {levels.filter(l => l.cycleId === cycle.id).map((level, j) => (
                        <motion.div 
                          key={level.id}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: j * 0.05 }}
                          className={cn(
                            "flex items-center justify-between p-3 rounded-xl transition-all group",
                            selectedLevel === level.id 
                              ? "bg-white text-blue-600 shadow-sm border border-blue-100" 
                              : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                          )}
                        >
                          <button 
                            onClick={() => { setSelectedLevel(level.id); setSelectedSpecialty(null); }}
                            className="flex-1 text-right text-xs font-black uppercase tracking-widest"
                          >
                            {level.name}
                          </button>
                          {canManage && (
                            <div className="flex gap-1 opacity-100 transition-all">
                              <button onClick={() => setShowAddModal({ type: 'specialty', parentId: level.id })} className="p-1.5 bg-white rounded-lg text-blue-600 shadow-sm border border-slate-100"><Plus className="w-3 h-3" /></button>
                              <button onClick={() => setEditingItem({ id: level.id, name: level.name, type: 'level' })} className="p-1.5 bg-white rounded-lg text-slate-400 shadow-sm border border-slate-100"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={() => setConfirmDelete({ id: level.id, type: 'level', name: level.name })} className="p-1.5 bg-white rounded-lg text-red-600 shadow-sm border border-slate-100"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content: Specialties & Modules */}
        <div className="lg:col-span-9 space-y-8">
          {selectedLevel ? (
            <div className="space-y-8">
              <div className="flex items-center justify-between bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">التخصصات المتاحة</h2>
                    <p className="text-sm font-medium text-slate-500 uppercase tracking-widest">{levels.find(l => l.id === selectedLevel)?.name}</p>
                  </div>
                </div>
                {canManage && (
                  <button 
                    onClick={() => setShowAddModal({ type: 'specialty', parentId: selectedLevel })}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-50 text-blue-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة تخصص</span>
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {specialties.filter(s => s.levelId === selectedLevel).map((spec, i) => (
                  <motion.div 
                    key={spec.id} 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="bg-white rounded-4xl border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-500 group"
                  >
                    <div className="p-6 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all">
                          <GraduationCap className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-black text-slate-900 tracking-tight">{spec.name}</h3>
                      </div>
                      {canManage && (
                        <div className="flex gap-2 opacity-100 transition-all">
                          <button onClick={() => setShowAddModal({ type: 'module', parentId: spec.id })} className="w-9 h-9 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-blue-600 hover:bg-blue-50 transition-all shadow-sm"><Plus className="w-4 h-4" /></button>
                          <button onClick={() => setEditingItem({ id: spec.id, name: spec.name, type: 'specialty' })} className="w-9 h-9 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-400 hover:text-blue-600 transition-all shadow-sm"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => setConfirmDelete({ id: spec.id, type: 'specialty', name: spec.name })} className="w-9 h-9 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-red-600 hover:bg-red-50 transition-all shadow-sm"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>
                    <div className="p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-slate-400" />
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">المقاييس الدراسية</span>
                        </div>
                        <div className="flex gap-4">
                          <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">S1</span>
                          <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">S2</span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {modules.filter(m => m.specialtyId === spec.id).map(module => (
                          <div key={module.id} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 group/module hover:bg-white hover:shadow-md hover:shadow-slate-200/50 transition-all duration-300">
                            <span className="text-sm font-extrabold text-slate-700">{module.name}</span>
                            <div className="flex items-center gap-4">
                              {isAdmin && (
                                <div className="flex gap-1 opacity-0 group-hover/module:opacity-100 transition-all">
                                  <button onClick={() => setEditingItem({ id: module.id, name: module.name, type: 'module' })} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setConfirmDelete({ id: module.id, type: 'module', name: module.name })} className="p-1.5 hover:bg-slate-50 rounded-lg text-red-600 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              )}
                              <span className={cn(
                                "text-[10px] font-black px-3 py-1 rounded-xl border shadow-sm",
                                module.semester === 'S1' ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-blue-50 border-blue-100 text-blue-600"
                              )}>
                                {module.semester}
                              </span>
                            </div>
                          </div>
                        ))}
                        {modules.filter(m => m.specialtyId === spec.id).length === 0 && (
                          <div className="py-8 text-center space-y-2">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">لا توجد مقاييس مضافة</p>
                            {isAdmin && (
                              <button 
                                onClick={() => setShowAddModal({ type: 'module', parentId: spec.id })}
                                className="text-[10px] font-black text-blue-600 hover:underline uppercase tracking-widest"
                              >
                                أضف المقياس الأول
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[500px] flex flex-col items-center justify-center text-slate-400 bg-white rounded-4xl border border-dashed border-slate-200 shadow-sm p-12 text-center">
              <div className="w-24 h-24 rounded-full bg-slate-50 flex items-center justify-center mb-6">
                <Layers className="w-12 h-12 opacity-10" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-2">استكشف الهيكل الأكاديمي</h3>
              <p className="text-slate-500 font-medium max-w-xs mx-auto">اختر طوراً ومستوى من القائمة الجانبية لعرض التخصصات والمقاييس الدراسية الخاصة بها</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">إضافة {showAddModal.type === 'cycle' ? 'طور' : showAddModal.type === 'level' ? 'مستوى' : showAddModal.type === 'specialty' ? 'تخصص' : 'مقياس'}</h2>
              <button onClick={() => setShowAddModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الاسم</label>
                <input name="name" required autoFocus className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
              {showAddModal.type === 'module' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">السداسي</label>
                  <select name="semester" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3">
                    <option value="S1">السداسي الأول (S1)</option>
                    <option value="S2">السداسي الثاني (S2)</option>
                  </select>
                </div>
              )}
              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">إضافة</button>
                <button type="button" onClick={() => setShowAddModal(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">تعديل الاسم</h2>
              <button onClick={() => setEditingItem(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">الاسم الجديد</label>
                <input name="name" defaultValue={editingItem.name} required autoFocus className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">حفظ</button>
                <button type="button" onClick={() => setEditingItem(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden text-center p-8">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Trash2 className="w-10 h-10 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">تأكيد الحذف</h2>
            <p className="text-slate-500 mb-8 font-medium">
              هل أنت متأكد من حذف {confirmDelete.type === 'cycle' ? 'الطور' : confirmDelete.type === 'level' ? 'المستوى' : confirmDelete.type === 'specialty' ? 'التخصص' : 'المقياس'}: <span className="text-slate-900 font-bold">"{confirmDelete.name}"</span>؟
              {confirmDelete.type !== 'module' && <br />}
              {confirmDelete.type !== 'module' && <span className="text-xs text-red-500 mt-2 block">سيؤدي هذا لحذف جميع العناصر التابعة له.</span>}
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => handleDelete(confirmDelete.id, confirmDelete.type)}
                className="flex-1 bg-red-600 text-white py-3.5 rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200"
              >
                نعم، احذف
              </button>
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-3.5 rounded-2xl font-bold hover:bg-slate-200 transition-all font-sans"
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
