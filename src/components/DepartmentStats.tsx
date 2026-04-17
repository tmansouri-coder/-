import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, query, orderBy, limit, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Cycle, Level, Specialty, Module, User, ScheduleSession, SessionLog, Student, DepartmentStats as StatsType } from '../types';
import { BarChart3, Users, BookOpen, GraduationCap, Clock, CheckCircle2, XCircle, AlertTriangle, Save, Plus, Info, Database } from 'lucide-react';
import { cn, mapLevelName } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import toast from 'react-hot-toast';

export default function DepartmentStats() {
  const { isAdmin } = useAuth();
  const { selectedYear } = useAcademicYear();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<StatsType[]>([]);
  const [currentStats, setCurrentStats] = useState<Partial<StatsType>>({});
  
  // Auto-calculated stats state
  const [autoStats, setAutoStats] = useState({
    totalStudents: 0,
    licenceStudents: 0,
    engineerStudents: 0,
    masterStudents: 0,
    licenceCours: 0, licenceTD: 0, licenceTP: 0,
    engineerCours: 0, engineerTD: 0, engineerTP: 0,
    masterCours: 0, masterTD: 0, masterTP: 0,
    assistantProfessors: 0,
    lecturersB: 0,
    lecturersA: 0,
    professors: 0,
    temporaryTeachers: 0,
    internalTeachersCount: 0,
    externalTeachersCount: 0,
    internalAssistantProfs: 0,
    internalLecturersB: 0,
    internalLecturersA: 0,
    internalProfessors: 0,
    externalAssistantProfs: 0,
    externalLecturersB: 0,
    externalLecturersA: 0,
    externalProfessors: 0,
    temporaryCours: 0,
    temporaryTD: 0,
    temporaryTP: 0,
    temporaryFirstYearCours: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [
          teachersSnap, modulesSnap, specialtiesSnap, levelsSnap, 
          sessionsSnap, logsSnap, studentsSnap, cyclesSnap, historySnap
        ] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'modules')),
          getDocs(collection(db, 'specialties')),
          getDocs(collection(db, 'levels')),
          getDocs(collection(db, 'scheduleSessions')),
          getDocs(collection(db, 'sessionLogs')),
          getDocs(collection(db, 'students')),
          getDocs(collection(db, 'cycles')),
          getDocs(query(collection(db, 'departmentStats'), where('academicYear', '==', selectedYear), orderBy('date', 'desc'), limit(5)))
        ]);

        const teachers = teachersSnap.docs.map(d => d.data() as User);
        const students = studentsSnap.docs.map(d => d.data() as Student).filter(s => s.academicYear === selectedYear);
        const sessions = sessionsSnap.docs.map(d => d.data() as ScheduleSession).filter(s => s.academicYear === selectedYear);
        const specialties = specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty));
        const levels = levelsSnap.docs.map(d => ({ id: d.id, ...d.data(), name: mapLevelName((d.data() as any).name) } as Level));
        const cycles = cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle));

        // Helper to get cycle by specialtyId
        const getCycleBySpecialty = (specId: string) => {
          const spec = specialties.find(s => s.id === specId);
          const level = levels.find(l => l.id === spec?.levelId);
          return cycles.find(c => c.id === level?.cycleId);
        };

        // Calculate Teacher Stats
        const assistantProfs = teachers.filter(t => t.rank === 'MAA' || t.rank === 'MAB').length;
        const lectB = teachers.filter(t => t.rank === 'MCB').length;
        const lectA = teachers.filter(t => t.rank === 'MCA').length;
        const profs = teachers.filter(t => t.rank === 'Pr').length;
        const temps = teachers.filter(t => t.rank === 'Vacataire').length;

        const internal = teachers.filter(t => t.employmentType === 'internal');
        const external = teachers.filter(t => t.employmentType === 'external');

        const intAP = internal.filter(t => t.rank === 'MAA' || t.rank === 'MAB').length;
        const intLB = internal.filter(t => t.rank === 'MCB').length;
        const intLA = internal.filter(t => t.rank === 'MCA').length;
        const intPr = internal.filter(t => t.rank === 'Pr').length;

        const extAP = external.filter(t => t.rank === 'MAA' || t.rank === 'MAB').length;
        const extLB = external.filter(t => t.rank === 'MCB').length;
        const extLA = external.filter(t => t.rank === 'MCA').length;
        const extPr = external.filter(t => t.rank === 'Pr').length;

        // Calculate Session Stats
        let lC = 0, lTD = 0, lTP = 0;
        let eC = 0, eTD = 0, eTP = 0;
        let mC = 0, mTD = 0, mTP = 0;
        let tC = 0, tTD = 0, tTP = 0;
        let tFYC = 0;

        sessions.forEach(s => {
          const cycle = getCycleBySpecialty(s.specialtyId);
          const teacher = teachers.find(t => t.uid === s.teacherId);
          const isTemp = teacher?.rank === 'Vacataire';
          
          if (cycle?.name.includes('ليسانس') || cycle?.name === 'Licence') {
            if (s.type === 'Cours') lC++; else if (s.type === 'TD') lTD++; else lTP++;
          } else if (cycle?.name.includes('مهندس') || cycle?.name === 'Engineer') {
            if (s.type === 'Cours') eC++; else if (s.type === 'TD') eTD++; else eTP++;
          } else if (cycle?.name.includes('ماستر') || cycle?.name === 'Master') {
            if (s.type === 'Cours') mC++; else if (s.type === 'TD') mTD++; else mTP++;
          }

          if (isTemp) {
            if (s.type === 'Cours') tC++; else if (s.type === 'TD') tTD++; else tTP++;
            // Check if First Year
            const spec = specialties.find(sp => sp.id === s.specialtyId);
            const level = levels.find(l => l.id === spec?.levelId);
            if (level?.name.includes('First Year') && (cycle?.name.includes('ليسانس') || cycle?.name === 'Licence')) {
              if (s.type === 'Cours') tFYC++;
            }
          }
        });

        setAutoStats({
          totalStudents: students.length,
          licenceStudents: students.filter(s => {
            const cycle = cycles.find(c => c.id === s.cycleId);
            return cycle?.name.includes('ليسانس') || cycle?.name === 'Licence';
          }).length,
          engineerStudents: students.filter(s => {
            const cycle = cycles.find(c => c.id === s.cycleId);
            return cycle?.name.includes('مهندس') || cycle?.name === 'Engineer';
          }).length,
          masterStudents: students.filter(s => {
            const cycle = cycles.find(c => c.id === s.cycleId);
            return cycle?.name.includes('ماستر') || cycle?.name === 'Master';
          }).length,
          licenceCours: lC, licenceTD: lTD, licenceTP: lTP,
          engineerCours: eC, engineerTD: eTD, engineerTP: eTP,
          masterCours: mC, masterTD: mTD, masterTP: mTP,
          assistantProfessors: assistantProfs,
          lecturersB: lectB,
          lecturersA: lectA,
          professors: profs,
          temporaryTeachers: temps,
          internalTeachersCount: internal.length,
          externalTeachersCount: external.length,
          internalAssistantProfs: intAP,
          internalLecturersB: intLB,
          internalLecturersA: intLA,
          internalProfessors: intPr,
          externalAssistantProfs: extAP,
          externalLecturersB: extLB,
          externalLecturersA: extLA,
          externalProfessors: extPr,
          temporaryCours: tC,
          temporaryTD: tTD,
          temporaryTP: tTP,
          temporaryFirstYearCours: tFYC,
        });

        setHistory(historySnap.docs.map(d => ({ id: d.id, ...d.data() } as StatsType)));
        
        // Initialize currentStats with latest history if available
        if (!historySnap.empty) {
          const latest = historySnap.docs[0].data() as StatsType;
          setCurrentStats({
            ...latest,
            failureRatePerYear: latest.failureRatePerYear || { "First Year Bachelor's": 0, "Second Year Bachelor's": 0, "Third Year Bachelor's": 0, "First Year Master's": 0, "Second Year Master's": 0 }
          });
        } else {
          setCurrentStats({
            internationalStudents: 0,
            licenceGroups: 0,
            engineerGroups: 0,
            masterGroups: 0,
            failureRatePerYear: { "First Year Bachelor's": 0, "Second Year Bachelor's": 0, "Third Year Bachelor's": 0, "First Year Master's": 0, "Second Year Master's": 0 },
            amphisUsed: 0,
            tdRoomsUsed: 0,
            tpRoomsUsed: 0,
            tpComputers: 0,
            labSeats: 0,
            consumableSatisfaction: 0,
            teachesAI: false,
            teachesEntrepreneurship: false,
            englishModulesCount: 0,
            remoteLessonsCount: 0,
            itEngineersCount: 0,
            itTechniciansCount: 0,
            adminStaffCount: 0,
          });
        }

      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'departmentStats');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedYear]);

  const handleSaveStats = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    
    const finalStats: Omit<StatsType, 'id'> = {
      date: new Date().toISOString().split('T')[0],
      academicYear: selectedYear,
      ...autoStats,
      ...(currentStats as any),
      createdAt: new Date().toISOString(),
    };

    try {
      const docRef = await addDoc(collection(db, 'departmentStats'), finalStats);
      setHistory(prev => [{ id: docRef.id, ...finalStats } as StatsType, ...prev]);
      toast.success('تم حفظ الإحصائيات بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'departmentStats');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">إحصائيات القسم الشاملة</h1>
          <p className="text-slate-500">نظرة دقيقة على المؤشرات البيداغوجية، البشرية والمادية</p>
        </div>
        {isAdmin && (
          <button 
            onClick={handleSaveStats}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
          >
            {saving ? <Clock className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            حفظ إحصائيات اليوم
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Manual Entry Form */}
        <div className="lg:col-span-2 space-y-8">
          <form className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm space-y-8">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-50">
              <Plus className="w-6 h-6 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900">إدخال البيانات اليدوية</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Students & Groups */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">الطلبة والأفواج</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">عدد الطلبة الدوليين</label>
                    <input 
                      type="number" 
                      value={currentStats.internationalStudents || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, internationalStudents: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">عدد الأفواج (ليسانس)</label>
                    <input 
                      type="number" 
                      value={currentStats.licenceGroups || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, licenceGroups: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">عدد الأفواج (مهندس)</label>
                    <input 
                      type="number" 
                      value={currentStats.engineerGroups || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, engineerGroups: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">عدد الأفواج (ماستر)</label>
                    <input 
                      type="number" 
                      value={currentStats.masterGroups || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, masterGroups: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Infrastructure */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">الهياكل والمعدات</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">المدرجات المستغلة</label>
                    <input 
                      type="number" 
                      value={currentStats.amphisUsed || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, amphisUsed: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">قاعات TD المستغلة</label>
                    <input 
                      type="number" 
                      value={currentStats.tdRoomsUsed || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, tdRoomsUsed: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">قاعات TP المستغلة</label>
                    <input 
                      type="number" 
                      value={currentStats.tpRoomsUsed || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, tpRoomsUsed: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">حواسيب الأعمال التطبيقية</label>
                    <input 
                      type="number" 
                      value={currentStats.tpComputers || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, tpComputers: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">مقاعد المختبر (Paillasses)</label>
                    <input 
                      type="number" 
                      value={currentStats.labSeats || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, labSeats: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">نسبة الاكتفاء من المستهلكات (%)</label>
                    <input 
                      type="number" 
                      value={currentStats.consumableSatisfaction || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, consumableSatisfaction: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Curriculum & Staff */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">البرامج والموظفين</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">مقاييس الذكاء الاصطناعي</label>
                    <input 
                      type="checkbox" 
                      checked={currentStats.teachesAI || false}
                      onChange={e => setCurrentStats(prev => ({ ...prev, teachesAI: e.target.checked }))}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">مقاييس ريادة الأعمال</label>
                    <input 
                      type="checkbox" 
                      checked={currentStats.teachesEntrepreneurship || false}
                      onChange={e => setCurrentStats(prev => ({ ...prev, teachesEntrepreneurship: e.target.checked }))}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">المقاييس بالإنجليزية</label>
                    <input 
                      type="number" 
                      value={currentStats.englishModulesCount || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, englishModulesCount: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">الدروس عن بعد (تفاعلية)</label>
                    <input 
                      type="number" 
                      value={currentStats.remoteLessonsCount || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, remoteLessonsCount: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">مهندسي الإعلام الآلي</label>
                    <input 
                      type="number" 
                      value={currentStats.itEngineersCount || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, itEngineersCount: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">تقنيي الإعلام الآلي</label>
                    <input 
                      type="number" 
                      value={currentStats.itTechniciansCount || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, itTechniciansCount: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm text-slate-600">العمال الإداريين</label>
                    <input 
                      type="number" 
                      value={currentStats.adminStaffCount || 0}
                      onChange={e => setCurrentStats(prev => ({ ...prev, adminStaffCount: parseInt(e.target.value) }))}
                      className="w-24 bg-slate-50 border-none rounded-lg px-3 py-1.5 text-center font-bold focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Failure Rates */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">نسب الرسوب (%)</h3>
                <div className="grid grid-cols-2 gap-3">
                  {Object.keys(currentStats.failureRatePerYear || {}).map(year => (
                    <div key={year} className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl">
                      <span className="text-xs font-bold text-slate-500">{year}</span>
                      <input 
                        type="number" 
                        value={currentStats.failureRatePerYear?.[year] || 0}
                        onChange={e => setCurrentStats(prev => ({
                          ...prev,
                          failureRatePerYear: {
                            ...prev.failureRatePerYear,
                            [year]: parseInt(e.target.value)
                          }
                        }))}
                        className="w-12 bg-white border-none rounded-lg px-2 py-1 text-center text-xs font-bold focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </form>

          {/* Auto-Calculated Display */}
          <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm space-y-8">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-50">
              <Database className="w-6 h-6 text-emerald-600" />
              <h2 className="text-lg font-bold text-slate-900">بيانات مستخرجة من النظام (تلقائياً)</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Student Counts */}
              <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-100 space-y-3">
                <h4 className="text-xs font-bold text-blue-600 uppercase">تعداد الطلبة</h4>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm"><span>الإجمالي:</span> <span className="font-bold">{autoStats.totalStudents}</span></div>
                  <div className="flex justify-between text-sm"><span>ليسانس:</span> <span className="font-bold">{autoStats.licenceStudents}</span></div>
                  <div className="flex justify-between text-sm"><span>مهندس:</span> <span className="font-bold">{autoStats.engineerStudents}</span></div>
                  <div className="flex justify-between text-sm"><span>ماستر:</span> <span className="font-bold">{autoStats.masterStudents}</span></div>
                </div>
              </div>

              {/* Teacher Ranks */}
              <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-100 space-y-4">
                <h4 className="text-xs font-bold text-emerald-600 uppercase">رتب الأساتذة</h4>
                
                <div className="space-y-2">
                  <h5 className="text-[10px] font-bold text-slate-400 border-b border-slate-100 pb-1">داخل القسم ({autoStats.internalTeachersCount})</h5>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between"><span>أستاذ تعليم عالي:</span> <span className="font-bold">{autoStats.internalProfessors}</span></div>
                    <div className="flex justify-between"><span>أستاذ محاضر أ:</span> <span className="font-bold">{autoStats.internalLecturersA}</span></div>
                    <div className="flex justify-between"><span>أستاذ محاضر ب:</span> <span className="font-bold">{autoStats.internalLecturersB}</span></div>
                    <div className="flex justify-between"><span>أستاذ مساعد:</span> <span className="font-bold">{autoStats.internalAssistantProfs}</span></div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h5 className="text-[10px] font-bold text-slate-400 border-b border-slate-100 pb-1">خارج القسم ({autoStats.externalTeachersCount})</h5>
                  <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between"><span>أستاذ تعليم عالي:</span> <span className="font-bold">{autoStats.externalProfessors}</span></div>
                    <div className="flex justify-between"><span>أستاذ محاضر أ:</span> <span className="font-bold">{autoStats.externalLecturersA}</span></div>
                    <div className="flex justify-between"><span>أستاذ محاضر ب:</span> <span className="font-bold">{autoStats.externalLecturersB}</span></div>
                    <div className="flex justify-between"><span>أستاذ مساعد:</span> <span className="font-bold">{autoStats.externalAssistantProfs}</span></div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <div className="flex justify-between text-xs font-bold text-slate-700">
                    <span>أساتذة مؤقتين:</span> 
                    <span>{autoStats.temporaryTeachers}</span>
                  </div>
                </div>
              </div>

              {/* Temporary Load */}
              <div className="p-4 rounded-2xl bg-orange-50/50 border border-orange-100 space-y-3">
                <h4 className="text-xs font-bold text-orange-600 uppercase">تأطير الأساتذة المؤقتين</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span>حصص Cours:</span> <span className="font-bold">{autoStats.temporaryCours}</span></div>
                  <div className="flex justify-between"><span>حصص TD:</span> <span className="font-bold">{autoStats.temporaryTD}</span></div>
                  <div className="flex justify-between"><span>حصص TP:</span> <span className="font-bold">{autoStats.temporaryTP}</span></div>
                  <div className="flex justify-between text-blue-700 font-bold"><span>دروس السنة الأولى:</span> <span>{autoStats.temporaryFirstYearCours}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar: History & Quick Info */}
        <div className="space-y-8">
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              سجل الإحصائيات
            </h3>
            <div className="space-y-4">
              {history.length > 0 ? history.map(h => (
                <div key={h.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:border-blue-200 transition-all cursor-pointer group">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-bold text-slate-900">{h.academicYear}</span>
                    <span className="text-[10px] text-slate-400">{h.date}</span>
                  </div>
                  <p className="text-xs text-slate-500">إجمالي الطلبة: <span className="font-bold text-blue-600">{h.totalStudents}</span></p>
                </div>
              )) : (
                <p className="text-sm text-slate-400 italic text-center py-4">لا يوجد سجل متاح بعد</p>
              )}
            </div>
          </div>

          <div className="bg-blue-600 p-6 rounded-3xl text-white shadow-xl shadow-blue-100 space-y-4">
            <Info className="w-8 h-8 opacity-50" />
            <h3 className="text-lg font-bold">ملاحظة هامة</h3>
            <p className="text-sm text-blue-100 leading-relaxed">
              يتم تحديث البيانات التلقائية لحظياً بناءً على ما هو مسجل في قاعدة بيانات التطبيق (الأساتذة، الطلبة، والجدول الزمني).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
