import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Cycle, Level, Module, Specialty } from '../types';
import { BookOpen, ChevronRight, Layers, GraduationCap, Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';

export default function AcademicStructure() {
  const { isAdmin } = useAuth();
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

      setCycles(cycleSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Cycle)));
      setLevels(levelSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Level)));
      setSpecialties(specSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Specialty)));
      setModules(moduleSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Module)));
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
        setCycles(prev => [...prev, { id: docRef.id, name: name as any }]);
      } else if (showAddModal.type === 'level') {
        docRef = await addDoc(collection(db, 'levels'), { name, cycleId: showAddModal.parentId });
        setLevels(prev => [...prev, { id: docRef.id, name, cycleId: showAddModal.parentId! }]);
      } else if (showAddModal.type === 'specialty') {
        docRef = await addDoc(collection(db, 'specialties'), { name, levelId: showAddModal.parentId });
        setSpecialties(prev => [...prev, { id: docRef.id, name, levelId: showAddModal.parentId! }]);
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
      handleFirestoreError(err, OperationType.CREATE, showAddModal.type + 's');
    }
  };

  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingItem) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;

    try {
      const collectionName = editingItem.type + 's';
      await updateDoc(doc(db, collectionName, editingItem.id), { name });
      
      if (editingItem.type === 'cycle') setCycles(prev => prev.map(c => c.id === editingItem.id ? { ...c, name: name as any } : c));
      if (editingItem.type === 'level') setLevels(prev => prev.map(l => l.id === editingItem.id ? { ...l, name } : l));
      if (editingItem.type === 'specialty') setSpecialties(prev => prev.map(s => s.id === editingItem.id ? { ...s, name } : s));
      if (editingItem.type === 'module') setModules(prev => prev.map(m => m.id === editingItem.id ? { ...m, name } : m));
      
      setEditingItem(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, editingItem.type + 's/' + editingItem.id);
    }
  };

  const handleDelete = async (id: string, type: string) => {
    if (!window.confirm('هل أنت متأكد من الحذف؟')) return;
    try {
      const collectionName = type + 's';
      await deleteDoc(doc(db, collectionName, id));
      
      if (type === 'cycle') setCycles(prev => prev.filter(c => c.id !== id));
      if (type === 'level') setLevels(prev => prev.filter(l => l.id !== id));
      if (type === 'specialty') setSpecialties(prev => prev.filter(s => s.id !== id));
      if (type === 'module') setModules(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, type + 's/' + id);
    }
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">الهيكل الأكاديمي</h1>
          <p className="text-slate-500">تصفح وإدارة الأطوار، المستويات، التخصصات، والمقاييس</p>
        </div>
        {isAdmin && (
          <button 
            onClick={() => setShowAddModal({ type: 'cycle' })}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة طور جديد</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar: Cycles & Levels */}
        <div className="lg:col-span-1 space-y-6">
          <div className="space-y-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2">الأطوار والمستويات</h2>
            <div className="space-y-2">
              {cycles.map((cycle) => (
                <div key={cycle.id} className="space-y-1">
                  <div className={cn(
                    "flex items-center justify-between p-3 rounded-xl transition-all group",
                    selectedCycle === cycle.id ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50 text-slate-600"
                  )}>
                    <button 
                      onClick={() => { setSelectedCycle(cycle.id); setSelectedLevel(null); setSelectedSpecialty(null); }}
                      className="flex-1 text-right font-bold"
                    >
                      {cycle.name}
                    </button>
                    {isAdmin && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setShowAddModal({ type: 'level', parentId: cycle.id })} className="p-1 hover:bg-white rounded-lg text-blue-600"><Plus className="w-3 h-3" /></button>
                        <button onClick={() => setEditingItem({ id: cycle.id, name: cycle.name, type: 'cycle' })} className="p-1 hover:bg-white rounded-lg text-slate-400"><Edit2 className="w-3 h-3" /></button>
                        <button onClick={() => handleDelete(cycle.id, 'cycle')} className="p-1 hover:bg-white rounded-lg text-red-600"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    )}
                  </div>
                  
                  {selectedCycle === cycle.id && (
                    <div className="pr-4 space-y-1 border-r-2 border-blue-100 mr-2">
                      {levels.filter(l => l.cycleId === cycle.id).map(level => (
                        <div key={level.id} className={cn(
                          "flex items-center justify-between p-2 rounded-lg transition-all group",
                          selectedLevel === level.id ? "bg-white text-blue-600 shadow-sm border border-blue-100" : "text-slate-500 hover:text-slate-700"
                        )}>
                          <button 
                            onClick={() => { setSelectedLevel(level.id); setSelectedSpecialty(null); }}
                            className="flex-1 text-right text-sm font-medium"
                          >
                            {level.name}
                          </button>
                          {isAdmin && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => setShowAddModal({ type: 'specialty', parentId: level.id })} className="p-1 hover:bg-slate-50 rounded-lg text-blue-600"><Plus className="w-3 h-3" /></button>
                              <button onClick={() => setEditingItem({ id: level.id, name: level.name, type: 'level' })} className="p-1 hover:bg-slate-50 rounded-lg text-slate-400"><Edit2 className="w-3 h-3" /></button>
                              <button onClick={() => handleDelete(level.id, 'level')} className="p-1 hover:bg-slate-50 rounded-lg text-red-600"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content: Specialties & Modules */}
        <div className="lg:col-span-3 space-y-8">
          {selectedLevel ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">التخصصات في {levels.find(l => l.id === selectedLevel)?.name}</h2>
                {isAdmin && (
                  <button 
                    onClick={() => setShowAddModal({ type: 'specialty', parentId: selectedLevel })}
                    className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    إضافة تخصص
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {specialties.filter(s => s.levelId === selectedLevel).map((spec) => (
                  <div key={spec.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden group">
                    <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                          <GraduationCap className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold text-slate-900">{spec.name}</h3>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setShowAddModal({ type: 'module', parentId: spec.id })} className="p-1.5 hover:bg-white rounded-lg text-blue-600"><Plus className="w-4 h-4" /></button>
                          <button onClick={() => setEditingItem({ id: spec.id, name: spec.name, type: 'specialty' })} className="p-1.5 hover:bg-white rounded-lg text-slate-400"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(spec.id, 'specialty')} className="p-1.5 hover:bg-white rounded-lg text-red-600"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase">
                        <span>المقاييس</span>
                        <div className="flex gap-4">
                          <span className="text-emerald-600">S1</span>
                          <span className="text-blue-600">S2</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {modules.filter(m => m.specialtyId === spec.id).map(module => (
                          <div key={module.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 group/module">
                            <div className="flex items-center gap-2">
                              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-sm font-medium text-slate-700">{module.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              {isAdmin && (
                                <div className="flex gap-1 opacity-0 group-hover/module:opacity-100 transition-opacity">
                                  <button onClick={() => setEditingItem({ id: module.id, name: module.name, type: 'module' })} className="p-1 hover:bg-white rounded-lg text-slate-400"><Edit2 className="w-3 h-3" /></button>
                                  <button onClick={() => handleDelete(module.id, 'module')} className="p-1 hover:bg-white rounded-lg text-red-600"><Trash2 className="w-3 h-3" /></button>
                                </div>
                              )}
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                module.semester === 'S1' ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-blue-50 border-blue-100 text-blue-600"
                              )}>
                                {module.semester}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-96 flex flex-col items-center justify-center text-slate-400 bg-white rounded-3xl border border-dashed border-slate-200">
              <Layers className="w-16 h-16 mb-4 opacity-10" />
              <p className="text-lg font-medium">اختر طوراً ومستوى من القائمة الجانبية</p>
              <p className="text-sm opacity-60">لعرض التخصصات والمقاييس الدراسية الخاصة بها</p>
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
    </div>
  );
}
