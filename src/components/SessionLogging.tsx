import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, addDoc, query, where, orderBy, Timestamp, limit } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import { ScheduleSession, SessionLog, Module, Room, User, PedagogicalCalendar, Cycle, Level, Specialty } from '../types';
import { CheckCircle2, XCircle, AlertTriangle, Info, Clock, MapPin, BookOpen, Plus, AlertCircle, BarChart2, GraduationCap, FileSpreadsheet } from 'lucide-react';
import { cn, isDateExcluded, getDatesForDay } from '../lib/utils';
import { doc, updateDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { useTranslation } from 'react-i18next';
import html2canvas from '../lib/safeHtml2canvas';
import { jsPDF } from 'jspdf';

export default function SessionLogging() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { user, isAdmin, isViceAdmin, isSpecialtyManager } = useAuth();
  const { selectedYear } = useAcademicYear();
  const [mySessions, setMySessions] = useState<ScheduleSession[]>([]);
  const [allSessions, setAllSessions] = useState<ScheduleSession[]>([]);
  const [printGroup, setPrintGroup] = useState<any>(null);
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [calendar, setCalendar] = useState<PedagogicalCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState<ScheduleSession | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [updatingProgress, setUpdatingProgress] = useState<string | null>(null);
  const [activeSemester, setActiveSemester] = useState<'S1' | 'S2'>('S1');
  const [stats, setStats] = useState({
    departmentProgress: 0,
    specialtyProgress: {} as Record<string, number>
  });
  const [selectedSpecialtyFilter, setSelectedSpecialtyFilter] = useState<string>('all');

  useEffect(() => {
    setSelectedSpecialtyFilter('all');
  }, [activeSemester]);

  useEffect(() => {
    const calculateStats = () => {
      if (modules.length === 0) return;

      const semesterModules = modules.filter(m => m.semester === activeSemester && m.academicYear === selectedYear);
      if (semesterModules.length === 0) {
        setStats({ departmentProgress: 0, specialtyProgress: {} });
        return;
      }

      // Department average
      const deptSum = semesterModules.reduce((acc, m) => acc + (m.progress || 0), 0);
      const deptAvg = Math.round(deptSum / semesterModules.length);

      // Specialty averages
      const specProgress: Record<string, number> = {};
      const specsInSemester = [...new Set(semesterModules.map(m => m.specialtyId))];
      
      specsInSemester.forEach(specId => {
        const specModules = semesterModules.filter(m => m.specialtyId === specId);
        const specSum = specModules.reduce((acc, m) => acc + (m.progress || 0), 0);
        specProgress[specId] = Math.round(specSum / specModules.length);
      });

      setStats({
        departmentProgress: deptAvg,
        specialtyProgress: specProgress
      });
    };

    calculateStats();
  }, [modules, activeSemester, selectedYear]);

  useEffect(() => {
    const fetchData = async () => {
      if (!auth.currentUser) return;

      try {
        const logsQuery = (isAdmin || isViceAdmin)
          ? query(collection(db, 'sessionLogs'), where('academicYear', '==', selectedYear), orderBy('date', 'desc'))
          : query(collection(db, 'sessionLogs'), where('teacherId', '==', auth.currentUser.uid), where('academicYear', '==', selectedYear), orderBy('date', 'desc'));

        const [sessionsSnap, logsSnap, modulesSnap, roomsSnap, teachersSnap, calendarSnap, cyclesSnap, levelsSnap, specialtiesSnap] = await Promise.all([
          getDocs(query(collection(db, 'scheduleSessions'), where('academicYear', '==', selectedYear))),
          getDocs(logsQuery),
          getDocs(query(collection(db, 'modules'), where('academicYear', '==', selectedYear))),
          getDocs(collection(db, 'rooms')),
          getDocs(collection(db, 'users')),
          getDocs(query(collection(db, 'pedagogicalCalendars'), where('academicYear', '==', selectedYear), limit(1))),
          getDocs(collection(db, 'cycles')),
          getDocs(collection(db, 'levels')),
          getDocs(collection(db, 'specialties'))
        ]);

        const loadedSessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleSession));
        setAllSessions(loadedSessions);
        setMySessions(loadedSessions.filter(s => s.teacherId === auth.currentUser?.uid));
        setLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as SessionLog)));
        setModules(modulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Module)));
        const roomsList = roomsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Room));
        roomsList.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
        setRooms(roomsList);
        const teachersList = teachersSnap.docs.map(d => ({ ...d.data() } as User));
        teachersList.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
        setTeachers(teachersList);
        setCycles(cyclesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle)));
        setLevels(levelsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Level)));
        setSpecialties(specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty)));
        
        if (!calendarSnap.empty) {
          setCalendar({ id: calendarSnap.docs[0].id, ...calendarSnap.docs[0].data() } as PedagogicalCalendar);
        }
      } catch (err) {
        console.error("Error fetching session data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [isAdmin, isViceAdmin, isSpecialtyManager, selectedYear]);

  const handleLogSession = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showLogModal || !auth.currentUser) return;

    const formData = new FormData(e.currentTarget);
    const logData = {
      scheduleSessionId: showLogModal.id,
      teacherId: auth.currentUser.uid,
      moduleId: showLogModal.moduleId,
      date: formData.get('date') as string,
      status: formData.get('status') as any,
      content: formData.get('content') as string,
      observations: formData.get('observations') as string,
      timestamp: Timestamp.now(),
      academicYear: selectedYear
    };

    try {
      const docRef = await addDoc(collection(db, 'sessionLogs'), logData);
      setLogs(prev => [{ id: docRef.id, ...logData } as SessionLog, ...prev]);
      setShowLogModal(null);
      toast.success('تم تسجيل الحصة بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'sessionLogs');
    }
  };

  const handleUpdateProgress = async (moduleId: string, progress: number) => {
    // Check if user is allowed to update this module
    const module = modules.find(m => m.id === moduleId);
    const isAllowed = isAdmin || isViceAdmin || 
                      (isSpecialtyManager && user?.specialtyIds?.includes(module?.specialtyId || '')) ||
                      module?.teacherId === auth.currentUser?.uid || 
                      mySessions.some(s => s.moduleId === moduleId);
    
    if (!isAllowed) {
      toast.error(t('unauthorized_progress_update'));
      return;
    }

    setUpdatingProgress(moduleId);
    try {
      await updateDoc(doc(db, 'modules', moduleId), { progress });
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, progress } : m));
      toast.success(t('update_progress_success'));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `modules/${moduleId}`);
    } finally {
      setUpdatingProgress(null);
    }
  };

  const handleToggleProgresField = async (moduleId: string, field: 'progresTD' | 'progresTP' | 'progresCours' | 'progresResit') => {
    const module = modules.find(m => m.id === moduleId);
    if (!module) return;

    const isAllowed = isAdmin || isViceAdmin || 
                      (isSpecialtyManager && user?.specialtyIds?.includes(module?.specialtyId || '')) ||
                      module?.teacherId === auth.currentUser?.uid ||
                      mySessions.some(s => s.moduleId === moduleId);
                      
    if (!isAllowed) {
      toast.error(t('unauthorized_progress_update') || 'غير مسموح لك بتعديل حالة المقياس');
      return;
    }

    const newValue = !module[field];
    const updatePromise = updateDoc(doc(db, 'modules', moduleId), { [field]: newValue });
    
    toast.promise(updatePromise, {
      loading: 'جاري تحديث حالة بروغرس...',
      success: 'تم التحديث بنجاح',
      error: 'فشل التحديث'
    });

    try {
      await updatePromise;
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, [field]: newValue } : m));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `modules/${moduleId}`);
    }
  };

  const exportProgressExcel = () => {
    const semesterModules = modules.filter(m => m.semester === activeSemester && m.academicYear === selectedYear);
    
    const data = semesterModules.map(module => {
      const specialty = specialties.find(s => s.id === module.specialtyId);
      const level = levels.find(l => l.id === specialty?.levelId);
      const cycle = cycles.find(c => c.id === level?.cycleId);
      const teacher = teachers.find(t => t.uid === module.teacherId);

      return {
        'السداسي': activeSemester === 'S1' ? 'الأول' : 'الثاني',
        'الطور': cycle?.name || '',
        'المستوى': level?.name || '',
        'التخصص': specialty?.name || '',
        'المادة': module.name,
        'الأستاذ': teacher?.displayName || 'غير معين',
        'نسبة التقدم (%)': module.progress || 0
      };
    }).sort((a, b) => {
      const specA = a['التخصص'] || '';
      const specB = b['التخصص'] || '';
      if (specA !== specB) return specA.localeCompare(specB);
      return a['المادة'].localeCompare(b['المادة']);
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'نسبة تقدم المقاييس');
    XLSX.writeFile(wb, `Progress_Report_${selectedYear.replace(/\//g, '-')}_${activeSemester}.xlsx`);
    toast.success('تم تصدير تقرير التقدم بنجاح');
  };

  const handleExportGroupExcel = (group: any) => {
    try {
      if (!group || !group.modules) {
        toast.error('بيانات المجموعة غير صالحة للتصدير');
        return;
      }

      const data = group.modules.map((module: Module, index: number) => {
        const teacher = teachers.find(t => t.uid === module.teacherId);
        
        // Determine session types (TD/TP) from semester schedule sessions
        const hasTD = allSessions.some(s => s.moduleId === module.id && s.type === 'TD' && s.semester === activeSemester);
        const hasTP = allSessions.some(s => s.moduleId === module.id && s.type === 'TP' && s.semester === activeSemester);

        const nature = 'محاضرة (Cours)' + (hasTD ? ' + أعمال موجهة (TD)' : '') + (hasTP ? ' + أعمال تطبيقية (TP)' : '');

        return {
          'الرقم': index + 1,
          'اسم المادة / المقياس': module.name,
          'الأستاذ المعني بالتسليم': teacher?.displayName || 'غير معين',
          'طبيعة المقياس': nature,
          'إرجاع أوراق الامتحان ومحضر التنقيط (توقيع الأستاذ)': '..................................',
          'علامات الامتحان (Cours)': module.progresCours ? 'تم الإدخال ✓' : 'لم يتم الإدخال ✗',
          'علامات الأعمال الموجهة (TD)': hasTD ? (module.progresTD ? 'تم الإدخال ✓' : 'لم يتم الإدخال ✗') : 'لا يوجد TD (N/A)',
          'علامات الأعمال التطبيقية (TP)': hasTP ? (module.progresTP ? 'تم الإدخال ✓' : 'لم يتم الإدخال ✗') : 'لا يوجد TP (N/A)',
          'توقيع تأكيد الرقمنة (Progres)': '..................................'
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      
      // Set sheet direction to Right-to-Left (Arabic) safely
      ws['!dir'] = 'rtl';
      
      // Set column widths
      ws['!cols'] = [
        { wch: 6 },   // الرقم
        { wch: 25 },  // اسم المادة
        { wch: 22 },  // الأستاذ
        { wch: 35 },  // طبيعة المقياس
        { wch: 45 },  // إرجاع أوراق الامتحان
        { wch: 22 },  // علامات الامتحان
        { wch: 22 },  // علامات TD
        { wch: 22 },  // علامات TP
        { wch: 30 }   // توقيع الرقمنة
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'متابعة تسليم العلامات');
      
      const cleanTitle = group.title ? group.title.replace(/[\s\/:*?"<>|]/g, '_') : 'مستوى';
      XLSX.writeFile(wb, `متابعة_تسليم_العلامات_${cleanTitle}_السداسي_${activeSemester === 'S1' ? 'الأول' : 'الثاني'}.xlsx`);
      toast.success('تم تصدير استمارة المتابعة Excel بنجاح');
    } catch (error: any) {
      console.error('Excel Export Error:', error);
      toast.error('فشل في تصدير ملف Excel: ' + (error.message || error));
    }
  };

  const handleDownloadPDF = async (group: any) => {
    if (!group) return;
    const toastId = toast.loading(isRtl ? 'جاري إنشاء وتجهيز مستند PDF بلقطات عالية الجودة...' : 'Generating high-quality PDF document...');
    
    // Save original scroll positions to prevent visual layout offsets or cropping during html2canvas render
    const originalScrollX = window.scrollX || window.pageXOffset || 0;
    const originalScrollY = window.scrollY || window.pageYOffset || 0;
    
    try {
      // Scroll to absolute origin temporarily before starting capture
      window.scrollTo(0, 0);

      // Create a temporary layout container in the DOM style for PDF generation
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '0';
      tempContainer.style.top = '0';
      tempContainer.style.width = '1024px'; // Fixed optimal size for pristine rendering
      tempContainer.style.backgroundColor = '#ffffff';
      tempContainer.style.padding = '40px 50px';
      tempContainer.style.boxSizing = 'border-box';
      tempContainer.style.fontFamily = '"Almarai", "Segoe UI", "Tahoma", "Arial", sans-serif';
      tempContainer.style.zIndex = '-9999'; // Render in background to prevent overlapping actual UI
      tempContainer.style.opacity = '1';
      tempContainer.dir = 'rtl';
      
      const cycleText = group.cycle ? mapCycleToArabic(group.cycle.name) : '---';
      const levelText = group.level ? mapLevelToArabic(group.level.name) : '---';
      const specialtyText = group.specialty?.name || '---';
      
      let rowsHTML = '';
      group.modules.forEach((module: Module, idx: number) => {
        const teacher = teachers.find(t => t.uid === module.teacherId);
        const hasTD = allSessions.some(s => s.moduleId === module.id && s.type === 'TD' && s.semester === activeSemester);
        const hasTP = allSessions.some(s => s.moduleId === module.id && s.type === 'TP' && s.semester === activeSemester);
        
        rowsHTML += `
          <tr style="border: 1px solid #111111; color: #000000; font-size: 13px;">
            <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center; font-weight: bold; background-color: #f8fafc;">${idx + 1}</td>
            <td style="border: 1px solid #111111; padding: 12px 8px; text-align: center; font-weight: bold; font-size: 13px;">${module.name}</td>
            <td style="border: 1px solid #111111; padding: 12px 8px; text-align: center; font-weight: 500;">${teacher?.displayName || 'غير معين'}</td>
            <td style="border: 1px solid #111111; padding: 14px 6px; text-align: center;"><div style="border-bottom: 1.5px dotted #111111; width: 110px; margin: 4px auto 0 auto; height: 1px;"></div></td>
            <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
              <div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>
            </td>
            <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
              <div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>
            </td>
            <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
              ${hasTD ? '<div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>' : '<span style="color: #64748b; font-size: 11px; font-style: italic;">لا يوجد TD</span>'}
            </td>
            <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
              ${hasTP ? '<div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>' : '<span style="color: #64748b; font-size: 11px; font-style: italic;">لا يوجد TP</span>'}
            </td>
            <td style="border: 1px solid #111111; padding: 14px 6px; text-align: center;"><div style="border-bottom: 1.5px dotted #111111; width: 90px; margin: 4px auto 0 auto; height: 1px;"></div></td>
          </tr>
        `;
      });

      const totTDs = group.modules.filter((m: any) => allSessions.some(s => s.moduleId === m.id && s.type === 'TD' && s.semester === activeSemester)).length;
      const totTPs = group.modules.filter((m: any) => allSessions.some(s => s.moduleId === m.id && s.type === 'TP' && s.semester === activeSemester)).length;

      tempContainer.innerHTML = `
        <div style="width: 100%; color: #000000; background-color: #ffffff; line-height: 1.6; direction: rtl;">
          <!-- Algeria official header -->
          <div style="text-align: center; border-bottom: 2.5px solid #000000; padding-bottom: 12px; margin-bottom: 25px;">
            <h3 style="font-weight: bold; font-size: 16px; margin: 3px 0;">الجمهورية الجزائرية الديمقراطية الشعبية</h3>
            <h3 style="font-weight: bold; font-size: 16px; margin: 3px 0;">وزارة التعليم العالي والبحث العلمي</h3>
            <h4 style="font-weight: bold; font-size: 15px; margin: 3px 0; color: #000000;">جامعة عمار ثليجي بالأغواط</h4>
            <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; color: #111111; margin-top: 12px; padding: 0 10px;">
              <span>كلية التكنولوجيا - قسم الهندسة الميكانيكية</span>
              <span>السنة الجامعية: ${selectedYear}</span>
              <span>السداسي: ${activeSemester === 'S1' ? 'الأول' : 'الثاني'}</span>
            </div>
          </div>

          <!-- Title -->
          <div style="text-align: center; margin-bottom: 25px; width: 100%;">
            <div style="border: 2px solid #000000; padding: 12px 24px; display: block; width: 85%; margin: 0 auto 15px auto; background-color: #f8fafc; border-radius: 10px; box-sizing: border-box;">
              <h2 style="font-size: 18px; font-weight: bold; margin: 0; color: #000000; text-align: center; line-height: 1.4;">
                محضر ومتابعة تسليم أوراق الامتحانات ومراقبة رقمنة العلامات في الأرضية (PROGRES)
              </h2>
            </div>
            <div style="font-size: 14px; font-weight: bold; color: #111111; display: flex; justify-content: center; gap: 40px; margin-top: 5px;">
              <span>الطور: <strong style="color: #000000;">${cycleText}</strong></span>
              <span>المستوى: <strong style="color: #000000;">${levelText}</strong></span>
              <span>التخصص: <strong style="color: #000000;">${specialtyText}</strong></span>
            </div>
          </div>

          <!-- Improvement: Smart statistics dashboard inside checklist -->
          <div style="display: flex; justify-content: space-around; background-color: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 10px 15px; margin-bottom: 20px; font-size: 13px; font-weight: bold; color: #1e293b;">
            <span>📊 إجمالي المقاييس بالمستوى البيداغوجي: <strong style="color: #2563eb; font-size: 15px;">${group.modules.length}</strong></span>
            <span>📘 محاضرات (Cours): <strong style="color: #2563eb; font-size: 15px;">${group.modules.length}</strong></span>
            <span>📝 حصص أعمال موجهة (TD): <strong style="color: #2563eb; font-size: 15px;">${totTDs}</strong></span>
            <span>⚙️ حصص أعمال تطبيقية (TP): <strong style="color: #2563eb; font-size: 15px;">${totTPs}</strong></span>
          </div>

          <!-- Checklist Table -->
          <table style="width: 100%; border-collapse: collapse; border: 2px solid #000000; font-size: 13px; text-align: center; margin-bottom: 30px;">
            <thead>
              <tr style="background-color: #f1f5f9; color: #000000; font-weight: bold; border-bottom: 2px solid #000000;">
                <th style="border: 1px solid #111111; padding: 12px 4px; width: 4%;">الرقم</th>
                <th style="border: 1px solid #111111; padding: 12px 8px; width: 22%; text-align: center;">اسم المادة / المقياس</th>
                <th style="border: 1px solid #111111; padding: 12px 8px; width: 16%; text-align: center;">الأستاذ المعني بالتسليم والرقمنة</th>
                <th style="border: 1px solid #111111; padding: 12px 4px; width: 16%;">إرجاع أوراق الامتحان ومحضر التنقيط (توقيع الأستاذ)</th>
                <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">الامتحان (Cours)</th>
                <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">الاستدراكية (Rattrapage)</th>
                <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">الموجهة (TD)</th>
                <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">التطبيقية (TP)</th>
                <th style="border: 1px solid #111111; padding: 12px 4px; width: 10%;">تأكيد الرقمنة (توقيع الأستاذ)</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHTML}
            </tbody>
          </table>

          <!-- Footer/Signatures -->
          <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 40px; page-break-inside: avoid;">
            <div style="width: 50%; border: 1.5px dashed #475569; padding: 15px; border-radius: 12px; background-color: #f8fafc; line-height: 1.7; text-align: right;">
              <h4 style="color: #1d4ed8; font-weight: bold; margin: 0 0 8px 0; font-size: 14px; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px;">توجيهات هامة للأستاذ منسق المقياس:</h4>
              <p style="margin: 4px 0; font-size: 12px; color: #1e293b;">1. يرجى التوقيع في خانة إرجاع الأوراق بعد تسليم أوراق الإجابات للقسم.</p>
              <p style="margin: 4px 0; font-size: 12px; color: #1e293b;">2. يلتزم الأستاذ برقمنة نقاط الامتحانات والأعمال الموجهة والتطبيقية (إن وجدت طبق التدريس الأسبوعي السداسي) في أرضية PROGRES قبل توقيع خانة تأكيد الرقمنة.</p>
              <p style="margin: 12px 0 0 0; font-size: 11px; color: #475569;">تاريخ استخراج الوثيقة: ${new Date().toLocaleDateString('ar-DZ')}</p>
            </div>
            
            <div style="width: 45%; text-align: center; display: flex; flex-direction: column; justify-content: space-between; height: 130px;">
              <h4 style="margin: 0; font-size: 14px; font-weight: bold; color: #000000;">رئيس القسم / مسؤول الشعبة والتخصص البيداغوجي</h4>
              <div style="margin-top: auto;">
                <div style="border-bottom: 2px dotted #000000; width: 180px; margin: 0 auto 5px auto; height: 1px;"></div>
                <span style="font-size: 11px; color: #475569; font-style: italic; display: block;">(الختم والتوقيع الرسمي للمسؤول البيداغوجي)</span>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(tempContainer);

      // Capture using high-precision html2canvas wrapper with predefined widths for clean margins
      const canvas = await html2canvas(tempContainer, {
        scale: 2.2, // Crisp precision output
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: 1024,
        windowWidth: 1024,
        scrollX: 0,
        scrollY: 0
      });

      document.body.removeChild(tempContainer);
      
      // Instantly restore original scroll coordinates for a seamless experience
      window.scrollTo(originalScrollX, originalScrollY);

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 standard width
      const pageHeight = 295; // A4 standard height
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      // Add image to pages
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pageHeight;
      }

      const cleanTitle = group.title ? group.title.replace(/[\s\/:*?"<>|]/g, '_') : 'مستوى_تخصص';
      pdf.save(`متابعة_تسليم_العلامات_${cleanTitle}_السداسي_${activeSemester === 'S1' ? 'الأول' : 'الثاني'}.pdf`);
      
      toast.success(isRtl ? 'تم تحميل ملف المتابعة PDF بنجاح' : 'PDF checklist downloaded successfully!', { id: toastId });
    } catch (err: any) {
      // Safely restore scrolling position even on error
      window.scrollTo(originalScrollX, originalScrollY);
      console.error('PDF Generation Crash:', err);
      toast.error(isRtl ? 'فشل إنتاج وتصدير ملف PDF: ' + err.message : 'Failed to export PDF: ' + err.message, { id: toastId });
    }
  };

  const handleDownloadAllPDFs = async () => {
    if (displayedGroups.length === 0) {
      toast.error(isRtl ? 'لا توجد محاضر متابعة متوفرة للتحميل حالياً' : 'No follow-up sheets available to download');
      return;
    }

    const toastId = toast.loading(isRtl 
      ? 'جاري تجميع وتحضير كافة محاضر المتابعة في ملف موحد...' 
      : 'Generating consolidated follow-up PDF...'
    );
    
    // Save original scroll positions to prevent visual layout offsets or cropping during html2canvas render
    const originalScrollX = window.scrollX || window.pageXOffset || 0;
    const originalScrollY = window.scrollY || window.pageYOffset || 0;
    
    try {
      // Scroll to absolute origin temporarily before starting capture
      window.scrollTo(0, 0);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 standard width
      const pageHeight = 295; // A4 standard height

      for (let gIdx = 0; gIdx < displayedGroups.length; gIdx++) {
        const group = displayedGroups[gIdx];
        
        // Update toast status dynamically
        toast.loading(isRtl 
          ? `جاري معالجة وتصوير المحضر ${gIdx + 1} من أصل ${displayedGroups.length} (${group.title})...`
          : `Processing checklist ${gIdx + 1} of ${displayedGroups.length} (${group.title})...`,
          { id: toastId }
        );

        // Create a temporary layout container in the DOM style for PDF generation
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '0';
        tempContainer.style.top = '0';
        tempContainer.style.width = '1024px'; // Fixed optimal size for pristine rendering
        tempContainer.style.backgroundColor = '#ffffff';
        tempContainer.style.padding = '40px 50px';
        tempContainer.style.boxSizing = 'border-box';
        tempContainer.style.fontFamily = '"Almarai", "Segoe UI", "Tahoma", "Arial", sans-serif';
        tempContainer.style.zIndex = '-9999'; // Render in background to prevent overlapping actual UI
        tempContainer.style.opacity = '1';
        tempContainer.dir = 'rtl';
        
        const cycleText = group.cycle ? mapCycleToArabic(group.cycle.name) : '---';
        const levelText = group.level ? mapLevelToArabic(group.level.name) : '---';
        const specialtyText = group.specialty?.name || '---';
        
        let rowsHTML = '';
        group.modules.forEach((module: Module, idx: number) => {
          const teacher = teachers.find(t => t.uid === module.teacherId);
          const hasTD = allSessions.some(s => s.moduleId === module.id && s.type === 'TD' && s.semester === activeSemester);
          const hasTP = allSessions.some(s => s.moduleId === module.id && s.type === 'TP' && s.semester === activeSemester);
          
          rowsHTML += `
            <tr style="border: 1px solid #111111; color: #000000; font-size: 13px;">
              <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center; font-weight: bold; background-color: #f8fafc;">${idx + 1}</td>
              <td style="border: 1px solid #111111; padding: 12px 8px; text-align: center; font-weight: bold; font-size: 13px;">${module.name}</td>
              <td style="border: 1px solid #111111; padding: 12px 8px; text-align: center; font-weight: 500;">${teacher?.displayName || 'غير معين'}</td>
              <td style="border: 1px solid #111111; padding: 14px 6px; text-align: center;"><div style="border-bottom: 1.5px dotted #111111; width: 110px; margin: 4px auto 0 auto; height: 1px;"></div></td>
              <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
                <div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>
              </td>
              <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
                <div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>
              </td>
              <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
                ${hasTD ? '<div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>' : '<span style="color: #64748b; font-size: 11px; font-style: italic;">لا يوجد TD</span>'}
              </td>
              <td style="border: 1px solid #111111; padding: 12px 6px; text-align: center;">
                ${hasTP ? '<div style="border: 1px solid #000000; width: 16px; height: 16px; margin: 2px auto; border-radius: 3px;"></div>' : '<span style="color: #64748b; font-size: 11px; font-style: italic;">لا يوجد TP</span>'}
              </td>
              <td style="border: 1px solid #111111; padding: 14px 6px; text-align: center;"><div style="border-bottom: 1.5px dotted #111111; width: 90px; margin: 4px auto 0 auto; height: 1px;"></div></td>
            </tr>
          `;
        });

        const totTDs = group.modules.filter((m: any) => allSessions.some(s => s.moduleId === m.id && s.type === 'TD' && s.semester === activeSemester)).length;
        const totTPs = group.modules.filter((m: any) => allSessions.some(s => s.moduleId === m.id && s.type === 'TP' && s.semester === activeSemester)).length;

        tempContainer.innerHTML = `
          <div style="width: 100%; color: #000000; background-color: #ffffff; line-height: 1.6; direction: rtl;">
            <!-- Algeria official header -->
            <div style="text-align: center; border-bottom: 2.5px solid #000000; padding-bottom: 12px; margin-bottom: 25px;">
              <h3 style="font-weight: bold; font-size: 16px; margin: 3px 0;">الجمهورية الجزائرية الديمقراطية الشعبية</h3>
              <h3 style="font-weight: bold; font-size: 16px; margin: 3px 0;">وزارة التعليم العالي والبحث العلمي</h3>
              <h4 style="font-weight: bold; font-size: 15px; margin: 3px 0; color: #000000;">جامعة عمار ثليجي بالأغواط</h4>
              <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; color: #111111; margin-top: 12px; padding: 0 10px;">
                <span>كلية التكنولوجيا - قسم الهندسة الميكانيكية</span>
                <span>السنة الجامعية: ${selectedYear}</span>
                <span>السداسي: ${activeSemester === 'S1' ? 'الأول' : 'الثاني'}</span>
              </div>
            </div>

            <!-- Title -->
            <div style="text-align: center; margin-bottom: 25px; width: 100%;">
              <div style="border: 2px solid #000000; padding: 12px 24px; display: block; width: 85%; margin: 0 auto 15px auto; background-color: #f8fafc; border-radius: 10px; box-sizing: border-box;">
                <h2 style="font-size: 18px; font-weight: bold; margin: 0; color: #000000; text-align: center; line-height: 1.4;">
                  محضر ومتابعة تسليم أوراق الامتحانات ومراقبة رقمنة العلامات في الأرضية (PROGRES)
                </h2>
              </div>
              <div style="font-size: 14px; font-weight: bold; color: #111111; display: flex; justify-content: center; gap: 40px; margin-top: 5px;">
                <span>الطور: <strong style="color: #000000;">${cycleText}</strong></span>
                <span>المستوى: <strong style="color: #000000;">${levelText}</strong></span>
                <span>التخصص: <strong style="color: #000000;">${specialtyText}</strong></span>
              </div>
            </div>

            <!-- Improvement: Smart statistics dashboard inside checklist -->
            <div style="display: flex; justify-content: space-around; background-color: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 10px 15px; margin-bottom: 20px; font-size: 13px; font-weight: bold; color: #1e293b;">
              <span>📊 إجمالي المقاييس بالمستوى البيداغوجي: <strong style="color: #2563eb; font-size: 15px;">${group.modules.length}</strong></span>
              <span>📘 محاضرات (Cours): <strong style="color: #2563eb; font-size: 15px;">${group.modules.length}</strong></span>
              <span>📝 حصص أعمال موجهة (TD): <strong style="color: #2563eb; font-size: 15px;">${totTDs}</strong></span>
              <span>⚙️ حصص أعمال تطبيقية (TP): <strong style="color: #2563eb; font-size: 15px;">${totTPs}</strong></span>
            </div>

            <!-- Checklist Table -->
            <table style="width: 100%; border-collapse: collapse; border: 2px solid #000000; font-size: 13px; text-align: center; margin-bottom: 30px;">
              <thead>
                <tr style="background-color: #f1f5f9; color: #000000; font-weight: bold; border-bottom: 2px solid #000000;">
                  <th style="border: 1px solid #111111; padding: 12px 4px; width: 4%;">الرقم</th>
                  <th style="border: 1px solid #111111; padding: 12px 8px; width: 22%; text-align: center;">اسم المادة / المقياس</th>
                  <th style="border: 1px solid #111111; padding: 12px 8px; width: 16%; text-align: center;">الأستاذ المعني بالتسليم والرقمنة</th>
                  <th style="border: 1px solid #111111; padding: 12px 4px; width: 16%;">إرجاع أوراق الامتحان ومحضر التنقيط (توقيع الأستاذ)</th>
                  <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">الامتحان (Cours)</th>
                  <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">الاستدراكية (Rattrapage)</th>
                  <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">الموجهة (TD)</th>
                  <th style="border: 1px solid #111111; padding: 12px 4px; width: 8%;">التطبيقية (TP)</th>
                  <th style="border: 1px solid #111111; padding: 12px 4px; width: 10%;">تأكيد الرقمنة (توقيع الأستاذ)</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHTML}
              </tbody>
            </table>

            <!-- Footer/Signatures -->
            <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 40px; page-break-inside: avoid;">
              <div style="width: 50%; border: 1.5px dashed #475569; padding: 15px; border-radius: 12px; background-color: #f8fafc; line-height: 1.7; text-align: right;">
                <h4 style="color: #1d4ed8; font-weight: bold; margin: 0 0 8px 0; font-size: 14px; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px;">توجيهات هامة للأستاذ منسق المقياس:</h4>
                <p style="margin: 4px 0; font-size: 12px; color: #1e293b;">1. يرجى التوقيع في خانة إرجاع الأوراق بعد تسليم أوراق الإجابات للقسم.</p>
                <p style="margin: 4px 0; font-size: 12px; color: #1e293b;">2. يلتزم الأستاذ برقمنة نقاط الامتحانات والأعمال الموجهة والتطبيقية (إن وجدت طبق التدريس الأسبوعي السداسي) في أرضية PROGRES قبل توقيع خانة تأكيد الرقمنة.</p>
                <p style="margin: 12px 0 0 0; font-size: 11px; color: #475569;">تاريخ استخراج الوثيقة: ${new Date().toLocaleDateString('ar-DZ')}</p>
              </div>
              
              <div style="width: 45%; text-align: center; display: flex; flex-direction: column; justify-content: space-between; height: 130px;">
                <h4 style="margin: 0; font-size: 14px; font-weight: bold; color: #000000;">رئيس القسم / مسؤول الشعبة والتخصص البيداغوجي</h4>
                <div style="margin-top: auto;">
                  <div style="border-bottom: 2px dotted #000000; width: 180px; margin: 0 auto 5px auto; height: 1px;"></div>
                  <span style="font-size: 11px; color: #475569; font-style: italic; display: block;">(الختم والتوقيع الرسمي للمسؤول البيداغوجي)</span>
                </div>
              </div>
            </div>
          </div>
        `;

        document.body.appendChild(tempContainer);

        const canvas = await html2canvas(tempContainer, {
          scale: 2.2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: 1024,
          windowWidth: 1024,
          scrollX: 0,
          scrollY: 0
        });

        document.body.removeChild(tempContainer);

        const imgData = canvas.toDataURL('image/png');
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // If not the first group, add page
        if (gIdx > 0) {
          pdf.addPage();
        }

        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pageHeight;

        while (heightLeft >= 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
          heightLeft -= pageHeight;
        }
      }

      // Safe scroll restoration
      window.scrollTo(originalScrollX, originalScrollY);

      const fileSemester = activeSemester === 'S1' ? 'S1' : 'S2';
      pdf.save(`كافة_محاضر_المتابعة_قسم_الهندسة_الميكانيكية_${fileSemester}.pdf`);
      
      toast.success(isRtl ? 'تم تحميل كافة محاضر أقسام الميكانيك بنجاح كملف PDF موحد!' : 'Consolidated follow-up PDF downloaded successfully!', { id: toastId });
    } catch (err: any) {
      window.scrollTo(originalScrollX, originalScrollY);
      console.error('Batch PDF Generation Crash:', err);
      toast.error(isRtl ? 'فشل تحميل كافة المحاضر: ' + err.message : 'Batch export failed: ' + err.message, { id: toastId });
    }
  };

  const getModuleSortInfo = (moduleId: string) => {
    const module = modules.find(m => m.id === moduleId);
    if (!module) return { cycleOrder: 99, levelOrder: 99, specialtyName: '' };
    
    const specialty = specialties.find(s => s.id === module.specialtyId);
    const level = levels.find(l => l.id === specialty?.levelId);
    const cycle = cycles.find(c => c.id === level?.cycleId);

    const cycleOrder = 
      cycle?.name === 'Licence' || cycle?.name === 'ليسانس' ? 1 :
      cycle?.name === 'Master' || cycle?.name === 'ماستر' ? 2 :
      cycle?.name === 'Engineer' || cycle?.name === 'مهندس' ? 3 : 4;
    
    const levelOrder = 
      level?.name.includes('1') ? 1 :
      level?.name.includes('2') ? 2 :
      level?.name.includes('3') ? 3 : 4;

    return { cycleOrder, levelOrder, specialtyName: specialty?.name || '' };
  };

  const myModules = ((isAdmin || isViceAdmin)
    ? modules.filter(m => m.semester === activeSemester)
    : isSpecialtyManager
      ? modules.filter(m => (user?.specialtyIds?.includes(m.specialtyId) || m.teacherId === auth.currentUser?.uid || mySessions.some(s => s.moduleId === m.id)) && m.semester === activeSemester)
      : modules.filter(m => (m.teacherId === auth.currentUser?.uid || mySessions.some(s => s.moduleId === m.id)) && m.semester === activeSemester))
    .sort((a, b) => {
      const infoA = getModuleSortInfo(a.id);
      const infoB = getModuleSortInfo(b.id);
      
      if (infoA.cycleOrder !== infoB.cycleOrder) return infoA.cycleOrder - infoB.cycleOrder;
      if (infoA.levelOrder !== infoB.levelOrder) return infoA.levelOrder - infoB.levelOrder;
      return infoA.specialtyName.localeCompare(infoB.specialtyName);
    });

  const mapCycleToArabic = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('licence') || n.includes('ليسانس')) return 'ليسانس';
    if (n.includes('master') || n.includes('ماستر')) return 'ماستر';
    if (n.includes('engineer') || n.includes('مهندس')) return 'مهندس';
    return name;
  };

  const mapLevelToArabic = (name: string) => {
    const n = name.toUpperCase();
    if (n === 'L1' || n.includes('first year b') || n.includes('الأولى')) return 'السنة الأولى';
    if (n === 'L2' || n.includes('second year b') || n.includes('الثانية')) return 'السنة الثانية';
    if (n === 'L3' || n.includes('third year b') || n.includes('الثالثة')) return 'السنة الثالثة';
    if (n === 'M1' || n.includes('first year m') || n.includes('الأولى ماستر')) return 'السنة الأولى ماستر';
    if (n === 'M2' || n.includes('second year m') || n.includes('الثانية ماستر')) return 'السنة الثانية ماستر';
    return name;
  };

  const formatGroupTitle = (cycle: Cycle | null, level: Level | null, specialty: Specialty | null) => {
    if (!specialty) return isRtl ? 'عام / جذع مشترك' : 'General / Common Core';
    const cycleName = cycle ? mapCycleToArabic(cycle.name) : '';
    const levelName = level ? mapLevelToArabic(level.name) : '';
    const specialtyName = specialty.name;
    return `${cycleName} - ${levelName} : ${specialtyName}`;
  };

  const groupedModules = useMemo(() => {
    const groups: Record<string, {
      specialtyId: string;
      specialty: Specialty | null;
      level: Level | null;
      cycle: Cycle | null;
      title: string;
      modules: Module[];
    }> = {};

    myModules.forEach(module => {
      const specId = module.specialtyId || 'common';
      if (!groups[specId]) {
        const specialty = specialties.find(s => s.id === module.specialtyId) || null;
        const level = specialty ? levels.find(l => l.id === specialty.levelId) : null;
        const cycle = level ? cycles.find(c => c.id === level.cycleId) : null;
        const title = formatGroupTitle(cycle, level, specialty);
        groups[specId] = {
          specialtyId: specId,
          specialty,
          level,
          cycle,
          title,
          modules: []
        };
      }
      groups[specId].modules.push(module);
    });

    return Object.values(groups).sort((a, b) => {
      if (a.specialtyId === 'common') return -1;
      if (b.specialtyId === 'common') return 1;
      return a.title.localeCompare(b.title);
    });
  }, [myModules, specialties, levels, cycles, isRtl]);

  const displayedGroups = useMemo(() => {
    if (selectedSpecialtyFilter === 'all') return groupedModules;
    return groupedModules.filter(g => g.specialtyId === selectedSpecialtyFilter);
  }, [groupedModules, selectedSpecialtyFilter]);

  const getSuggestedSessions = () => {
    if (!calendar || mySessions.length === 0) return [];
    
    const suggestions: { session: ScheduleSession; date: string }[] = [];
    const today = new Date().toISOString().split('T')[0];
    
    mySessions.forEach(session => {
      const startDate = session.semester === 'S1' ? calendar.s1Start : calendar.s2Start;
      const endDate = session.semester === 'S1' ? calendar.s1End : calendar.s2End;
      
      const allDates = getDatesForDay(session.day, startDate, endDate);
      
      allDates.forEach(date => {
        // Only suggest past sessions or today's sessions that haven't been logged yet
        if (date <= today) {
          const isLogged = logs.some(l => l.scheduleSessionId === session.id && l.date === date);
          const isExcluded = isDateExcluded(date, calendar);
          
          if (!isLogged && !isExcluded) {
            suggestions.push({ session, date });
          }
        }
      });
    });
    
    return suggestions.sort((a, b) => b.date.localeCompare(a.date));
  };

  const suggestedSessions = getSuggestedSessions();

  if (loading) return <div className="p-8 text-center">{t('loading')}</div>;

  return (
    <div className="space-y-8" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('session_logging')}</h1>
          <p className="text-slate-500">{t('session_logging_desc')}</p>
        </div>
        {(isAdmin || isViceAdmin || isSpecialtyManager) && (
          <button 
            onClick={exportProgressExcel}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-all shadow-sm border border-emerald-100 font-bold"
          >
            <FileSpreadsheet className="w-5 h-5" />
            <span>تصدير نسبة التقدم (Excel)</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8">
        {(isAdmin || isViceAdmin) && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
                  <BarChart2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('department_progress')}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black text-slate-900 leading-none">{stats.departmentProgress}%</span>
                  </div>
                </div>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${stats.departmentProgress}%` }} />
              </div>
            </div>

            {specialties.filter(s => stats.specialtyProgress[s.id] !== undefined).map(spec => (
              <div key={spec.id} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-sm">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest truncate" title={spec.name}>
                      {spec.name}
                    </h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black text-slate-900 leading-none">{stats.specialtyProgress[spec.id]}%</span>
                    </div>
                  </div>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${stats.specialtyProgress[spec.id]}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Module Progress Tracking & Suggested Sessions */}
        <div className="space-y-8">
          {/* Suggested Sessions to Log */}
          {suggestedSessions.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-orange-600" />
                {t('suggested_sessions')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {suggestedSessions.map((item, idx) => {
                  const module = modules.find(m => m.id === item.session.moduleId);
                  return (
                    <div key={`${item.session.id}-${item.date}`} className="bg-orange-50 p-4 rounded-2xl border border-orange-100 shadow-sm hover:shadow-md transition-all group">
                      <div className="flex justify-between items-start mb-2">
                        <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold uppercase">
                          {item.date}
                        </span>
                        <button 
                          onClick={() => {
                            setSelectedDate(item.date);
                            setShowLogModal(item.session);
                          }}
                          className="text-orange-600 font-bold text-xs hover:underline flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          {t('log_now')}
                        </button>
                      </div>
                      <h3 className="font-bold text-slate-900 text-sm">{module?.name}</h3>
                      <p className="text-[10px] text-slate-500 mt-1">{item.session.type} - {item.session.period}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Module Progress Tracking */}
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border-b border-slate-150 pb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-emerald-600" />
                {t('module_progress')}
              </h2>
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs font-black text-slate-550 shrink-0">
                    {isRtl ? 'عرض حسب التخصص والطور:' : 'Filter Specialty/Level:'}
                  </span>
                  <select
                    value={selectedSpecialtyFilter}
                    onChange={(e) => setSelectedSpecialtyFilter(e.target.value)}
                    className="flex-1 sm:w-64 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  >
                    <option value="all">{isRtl ? 'الكل (عرض الكل مجزأ)' : 'All'}</option>
                    {groupedModules.map(g => (
                      <option key={g.specialtyId} value={g.specialtyId}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg shrink-0">
                  <button 
                    type="button"
                    onClick={() => setActiveSemester('S1')}
                    className={cn(
                      "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                      activeSemester === 'S1' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                    )}
                  >S1</button>
                  <button 
                    type="button"
                    onClick={() => setActiveSemester('S2')}
                    className={cn(
                      "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                      activeSemester === 'S2' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                    )}
                  >S2</button>
                </div>
                {displayedGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDownloadAllPDFs}
                    className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white text-[10px] sm:text-xs font-black rounded-xl transition-all cursor-pointer shadow-sm shadow-rose-500/10 active:scale-95 shrink-0"
                    title={isRtl ? 'تحميل كافة محاضر المتابعة المعروضة مجتمعة في ملف PDF واحد' : 'Download all displayed checklists as a single PDF'}
                  >
                    <BarChart2 className="w-3.5 h-3.5 text-white" />
                    <span>{isRtl ? 'تحميل كافة المحاضر (PDF موحد)' : 'Download All (Single PDF)'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-8">
              {displayedGroups.length > 0 ? displayedGroups.map(group => (
                <div key={group.specialtyId} className="bg-slate-50/50 rounded-3xl p-6 border border-slate-200/40 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200/50 pb-3 gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                        <GraduationCap className="w-4.5 h-4.5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-800">{group.title}</h3>
                        <p className="text-[10px] text-slate-400 font-bold">
                          {isRtl ? `عدد المقاييس الحالية: ${group.modules.length}` : `Assigned Modules: ${group.modules.length}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleExportGroupExcel(group)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50/80 hover:bg-emerald-100/90 border border-emerald-200 rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
                        title={isRtl ? 'تحميل جدول المتابعة Excel' : 'Export follow-up sheet to Excel'}
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>{isRtl ? 'تحميل جدول المتابعة (Excel)' : 'Download Follow-up (Excel)'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadPDF(group)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black text-rose-700 bg-rose-50/80 hover:bg-rose-100/90 border border-rose-200 rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
                        title={isRtl ? 'تحميل جدول المتابعة PDF مباشر' : 'Download follow-up sheet directly as PDF'}
                      >
                        <BarChart2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>{isRtl ? 'تحميل المتابعة (PDF مباشر)' : 'Download Follow-up (PDF)'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrintGroup(group)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200 rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
                        title={isRtl ? 'استعراض وطباعة محضر تسليم الأوراق والمدونات' : 'Preview and print PDF checklist'}
                      >
                        <GraduationCap className="w-3.5 h-3.5" />
                        <span>{isRtl ? 'استعراض ومعاينة قبل الطباعة' : 'Preview & Print'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {group.modules.map(module => {
                      const isAllowedToToggle = isAdmin || isViceAdmin || 
                                        (isSpecialtyManager && user?.specialtyIds?.includes(module?.specialtyId || '')) ||
                                        module?.teacherId === auth.currentUser?.uid ||
                                        mySessions.some(s => s.moduleId === module.id);
                      return (
                        <div key={module.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <h4 className="font-bold text-slate-900 text-sm">{module.name}</h4>
                              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                                {cycles.find(c => c.id === levels.find(l => l.id === specialties.find(s => s.id === module.specialtyId)?.levelId)?.cycleId)?.name} - {levels.find(l => l.id === specialties.find(s => s.id === module.specialtyId)?.levelId)?.name} - {specialties.find(s => s.id === module.specialtyId)?.name}
                              </p>
                            </div>
                            <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg shrink-0">
                              {module.progress || 0}%
                            </span>
                          </div>
                          
                          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-emerald-500 transition-all duration-500" 
                              style={{ width: `${module.progress || 0}%` }}
                            />
                          </div>

                          <div className="flex items-center gap-2 pb-2 border-b border-slate-100/60">
                            <input 
                              type="range" 
                              min="0" 
                              max="100" 
                              step="5"
                              disabled={updatingProgress === module.id}
                              defaultValue={module.progress || 0}
                              onMouseUp={(e) => handleUpdateProgress(module.id, parseInt((e.target as HTMLInputElement).value))}
                              className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                            />
                            <span className="text-[10px] text-slate-400 font-bold shrink-0">{t('update')}</span>
                          </div>

                          {/* Progres Grades Entry Status Section */}
                          <div className="space-y-2 pt-1 transition-all">
                            <span className="text-[9px] font-extrabold text-slate-400/90 block uppercase tracking-wider text-right">
                              {isRtl ? 'حالة إدخال النقاط في بروغرس (Progres)' : 'Progres Grades Entry Status'}
                            </span>
                            <div className="grid grid-cols-2 gap-2 text-center" dir="rtl">
                              <div className="p-2 bg-slate-50/50 border border-slate-150/40 rounded-xl flex flex-col gap-1.5 justify-start">
                                <span className="text-[9px] font-black text-slate-550 block border-b border-slate-100 pb-0.5 select-none">
                                  {isRtl ? 'الامتحان العادي' : 'Regular Exam'}
                                </span>
                                <div className="flex flex-col gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleProgresField(module.id, 'progresTD')}
                                    disabled={!isAllowedToToggle}
                                    className={cn(
                                      "px-2 py-1.5 text-[9px] font-black rounded-lg border transition-all text-center",
                                      module.progresTD 
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-extrabold shadow-xs" 
                                        : "bg-white border-slate-200 text-slate-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100 cursor-pointer disabled:cursor-not-allowed"
                                    )}
                                  >
                                    {isRtl ? 'أعمال موجهة (TD)' : 'TD (Tutorials)'} {module.progresTD ? '✓' : '✗'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleProgresField(module.id, 'progresTP')}
                                    disabled={!isAllowedToToggle}
                                    className={cn(
                                      "px-2 py-1.5 text-[9px] font-black rounded-lg border transition-all text-center",
                                      module.progresTP 
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-extrabold shadow-xs" 
                                        : "bg-white border-slate-200 text-slate-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100 cursor-pointer disabled:cursor-not-allowed"
                                    )}
                                  >
                                    {isRtl ? 'أعمال تطبيقية (TP)' : 'TP (Labs)'} {module.progresTP ? '✓' : '✗'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleProgresField(module.id, 'progresCours')}
                                    disabled={!isAllowedToToggle}
                                    className={cn(
                                      "px-2 py-1.5 text-[9px] font-black rounded-lg border transition-all text-center",
                                      module.progresCours 
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-extrabold shadow-xs" 
                                        : "bg-white border-slate-200 text-slate-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100 cursor-pointer disabled:cursor-not-allowed"
                                    )}
                                  >
                                    {isRtl ? 'محاضرة (Cours)' : 'Cours (Lecture)'} {module.progresCours ? '✓' : '✗'}
                                  </button>
                                </div>
                              </div>

                              <div className="p-2 bg-slate-50/50 border border-slate-150/40 rounded-xl flex flex-col justify-between gap-1.5">
                                <span className="text-[9px] font-black text-slate-550 block border-b border-slate-100 pb-0.5 select-none">
                                  {isRtl ? 'الاستدراكي' : 'Resit Exam'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleToggleProgresField(module.id, 'progresResit')}
                                  disabled={!isAllowedToToggle}
                                  className={cn(
                                    "px-2 py-4 text-[9px] font-black rounded-lg border transition-all text-center grow flex items-center justify-center",
                                    module.progresResit 
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-extrabold shadow-xs" 
                                      : "bg-white border-slate-200 text-slate-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100 cursor-pointer disabled:cursor-not-allowed"
                                  )}
                                >
                                  {isRtl ? 'محاضرة (Cours)' : 'Cours (Lecture)'} {module.progresResit ? '✓' : '✗'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )) : (
                <p className="text-sm text-slate-400 italic text-center py-4 col-span-full">{t('no_modules_assigned')}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">{t('log_session_modal_title')}</h2>
              <button onClick={() => setShowLogModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><XCircle className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleLogSession} className="p-6 space-y-4">
              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase">{t('selected_module')}</p>
                    <p className="font-bold text-slate-900">{modules.find(m => m.id === showLogModal.moduleId)?.name}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('session_date')}</label>
                  <input 
                    type="date" 
                    name="date" 
                    required 
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">{t('session_status')}</label>
                  <select name="status" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500">
                    <option value="taught">{t('taught')}</option>
                    <option value="student_absence">{t('student_absence')}</option>
                    <option value="technical_problem">{t('technical_problem')}</option>
                    <option value="internship">{t('internship')}</option>
                  </select>
                </div>
              </div>

              {isDateExcluded(selectedDate, calendar) && (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 leading-relaxed font-bold">
                    {t('calendar_exclusion_warning')}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">{t('session_content_label')}</label>
                <textarea name="content" required rows={3} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" placeholder={t('session_content_placeholder')}></textarea>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">{t('additional_observations')}</label>
                <textarea name="observations" rows={2} className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500"></textarea>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">{t('confirm_log')}</button>
                <button type="button" onClick={() => setShowLogModal(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">{t('cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Follow-up Modal */}
      {printGroup && (
        <div id="print-root-wrapper" className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto print:z-auto">
          {/* Inject dynamic media stylesheet specifically for printing */}
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              html, body {
                background: white !important;
                color: black !important;
              }
              body > *:not(#print-root-wrapper) {
                display: none !important;
                height: 0 !important;
                width: 0 !important;
                overflow: hidden !important;
              }
              #printable-modal {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                min-height: 100% !important;
                background: white !important;
                color: black !important;
                padding: 0 !important;
                margin: 0 !important;
                border: none !important;
                box-shadow: none !important;
                visibility: visible !important;
              }
              #printable-modal * {
                visibility: visible !important;
              }
              .no-print {
                display: none !important;
                height: 0 !important;
                width: 0 !important;
                overflow: hidden !important;
              }
            }
          `}} />
          
          <div id="printable-modal" className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden border border-slate-200 p-8 flex flex-col space-y-6 print:border-none print:shadow-none print:p-0 print:w-full">
            {/* Modal Controls (Hidden during print) */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 no-print">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-blue-600 animate-pulse" />
                <span className="font-extrabold text-slate-800 text-xs sm:text-sm">
                  {isRtl ? 'معاينة واستعراض استمارة المتابعة البيداغوجية قبل الطباعة' : 'Preview Educational Follow-up Checklist Before Print'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadPDF(printGroup)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black rounded-xl transition-all cursor-pointer shadow-md shadow-rose-500/10"
                >
                  <BarChart2 className="w-4 h-4 text-white" />
                  <span>{isRtl ? 'تحميل مباشر PDF' : 'Download PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black rounded-xl transition-all cursor-pointer shadow-md shadow-blue-500/10"
                >
                  <Clock className="w-4 h-4" />
                  <span>{isRtl ? 'إطلاق الطباعة أو حفظ كـ PDF' : 'Print / Save PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintGroup(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-black rounded-xl transition-all cursor-pointer"
                >
                  {isRtl ? 'إلغاء وإغلاق' : 'Close'}
                </button>
              </div>
            </div>

            {/* Print Area */}
            <div className="space-y-6 text-slate-900" dir="rtl">
              {/* official Algerian institutional header */}
              <div className="text-center space-y-1.5 border-b-2 border-black pb-4">
                <h3 className="font-bold text-xs sm:text-sm tracking-tight text-black">الجمهورية الجزائرية الديمقراطية الشعبية</h3>
                <h3 className="font-bold text-xs sm:text-sm tracking-tight text-black">وزارة التعليم العالي والبحث العلمي</h3>
                <h4 className="font-bold text-xs text-neutral-850">جامعة عمار ثليجي بالأغواط</h4>
                <div className="flex justify-between items-center text-[10px] sm:text-xs font-bold text-slate-700 px-4 pt-1">
                  <span>كلية التكنولوجيا - قسم الهندسة الميكانيكية</span>
                  <span>السنة الجامعية: {selectedYear}</span>
                  <span>السداسي: {activeSemester === 'S1' ? 'الأول' : 'الثاني'}</span>
                </div>
              </div>

              {/* Title */}
              <div className="text-center space-y-1">
                <h2 className="text-xs sm:text-sm md:text-base font-black text-black border border-black px-4 py-2.5 rounded-lg block max-w-[85%] mx-auto bg-slate-50/50 text-center">
                  محضر ومتابعة تسليم أوراق الامتحانات ومراقبة رقمنة العلامات في الأرضية (PROGRES)
                </h2>
                <div className="text-[11px] sm:text-xs font-black text-slate-800 flex flex-wrap justify-center gap-x-8 gap-y-1 pt-2">
                  <span>الطور: <span className="font-black text-black">{printGroup.cycle ? mapCycleToArabic(printGroup.cycle.name) : '---'}</span></span>
                  <span>المستوى: <span className="font-black text-black">{printGroup.level ? mapLevelToArabic(printGroup.level.name) : '---'}</span></span>
                  <span>التخصص: <span className="font-black text-black">{printGroup.specialty?.name || '---'}</span></span>
                </div>
              </div>

              {/* Checklist Table */}
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full border-collapse border border-black text-center text-[10px] sm:text-[11px]">
                  <thead>
                    <tr className="bg-slate-100/80 text-black font-black border border-black">
                      <th className="border border-black p-2 w-[4%] text-center">الرقم</th>
                      <th className="border border-black p-2 w-[22%] text-center font-black">اسم المادة / المقياس</th>
                      <th className="border border-black p-2 w-[16%] text-center font-black">الأستاذ المعني بالتسليم والرقمنة</th>
                      <th className="border border-black p-2 w-[16%] text-center">إرجاع أوراق الامتحان ومحضر التنقيط (إمضاء الأستاذ)</th>
                      <th className="border border-black p-2 w-[8%] text-center">الامتحان (Cours)</th>
                      <th className="border border-black p-2 w-[8%] text-center">الدورة الاستدراكية</th>
                      <th className="border border-black p-2 w-[8%] text-center">علامات الموجهة (TD)</th>
                      <th className="border border-black p-2 w-[8%] text-center">علامات التطبيقية (TP)</th>
                      <th className="border border-black p-2 w-[10%] text-center">تأكيد الرقمنة (إمضاء الأستاذ)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printGroup.modules.map((module: Module, idx: number) => {
                      const teacher = teachers.find(t => t.uid === module.teacherId);
                      const hasTD = allSessions.some(s => s.moduleId === module.id && s.type === 'TD' && s.semester === activeSemester);
                      const hasTP = allSessions.some(s => s.moduleId === module.id && s.type === 'TP' && s.semester === activeSemester);
                      
                      return (
                        <tr key={module.id} className="border border-black hover:bg-slate-50/20 print:hover:bg-white font-bold text-black" style={{ contentVisibility: 'auto' }}>
                          <td className="border border-black p-2 text-center font-black">{idx + 1}</td>
                          <td className="border border-black p-2 text-center font-black">{module.name}</td>
                          <td className="border border-black p-2 text-center">{teacher?.displayName || 'غير معين'}</td>
                          <td className="border border-black p-2 text-center">
                            <span className="block border-b border-dotted border-black w-24 mx-auto h-4"></span>
                          </td>
                          <td className="border border-black p-2 text-center">
                            <div className="border border-black w-4 h-4 mx-auto rounded"></div>
                          </td>
                          <td className="border border-black p-2 text-center">
                            <div className="border border-black w-4 h-4 mx-auto rounded"></div>
                          </td>
                          <td className="border border-black p-2 text-center">
                            {hasTD ? (
                              <div className="border border-black w-4 h-4 mx-auto rounded"></div>
                            ) : (
                              <span className="text-slate-500 text-[10px] font-normal italic">لا يوجد TD</span>
                            )}
                          </td>
                          <td className="border border-black p-2 text-center">
                            {hasTP ? (
                              <div className="border border-black w-4 h-4 mx-auto rounded"></div>
                            ) : (
                              <span className="text-slate-500 text-[10px] font-normal italic">لا يوجد TP</span>
                            )}
                          </td>
                          <td className="border border-black p-2 text-center">
                            <span className="block border-b border-dotted border-black w-20 mx-auto h-4"></span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Instructions and Signatures split */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8 text-xs font-bold text-slate-800 print:grid-cols-2">
                <div className="space-y-1.5 border border-dashed border-slate-400 p-4 rounded-xl leading-relaxed bg-slate-50 print:bg-white print:border-black">
                  <h4 className="font-extrabold text-blue-700 border-b border-blue-100 pb-1 flex items-center gap-1.5 block">
                    <Info className="w-4 h-4 text-blue-700 shrink-0" />
                    <span>توجيهات هامة للأستاذ منسق المقياس:</span>
                  </h4>
                  <p className="text-[10px] sm:text-xs">1. يرجى التوقيع في خانة إرجاع الأوراق بعد تسليم أوراق الإجابات للقسم.</p>
                  <p className="text-[10px] sm:text-xs">2. يلتزم الأستاذ برقمنة نقاط الامتحانات والأعمال الموجهة والتطبيقية (إن وجدت طبق التدريس الأسبوعي السداسي) في أرضية PROGRES قبل توقيع خانة تأكيد الرقمنة.</p>
                  <p className="font-black text-black pt-1">تاريخ طباعة هذه النسخة: {new Date().toLocaleDateString('ar-DZ')}</p>
                </div>

                <div className="text-center space-y-14 flex flex-col justify-between">
                  <h4 className="font-black text-black text-xs sm:text-sm">رئيس القسم / مسؤول الشعبة والتخصص البيداغوجي</h4>
                  <div className="pt-2">
                    <span className="block border-b border-dotted border-black w-44 mx-auto h-4"></span>
                    <span className="text-[10px] text-slate-500 font-normal italic block pt-1">(الختم والتوقيع الرسمي)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Controls (Hidden during print) */}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-5 no-print">
              <button
                type="button"
                onClick={() => setPrintGroup(null)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                {isRtl ? 'إغلاق المعاينة' : 'Close Preview'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadPDF(printGroup)}
                className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-rose-500/15"
              >
                <BarChart2 className="w-4 h-4 text-white" />
                <span>{isRtl ? 'تحميل PDF مباشر' : 'Download PDF Document'}</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-blue-500/15"
              >
                <Clock className="w-4 h-4" />
                <span>{isRtl ? 'تنفيذ الطباعة الرسمية' : 'Print Checklist'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
