import React, { useRef, useState, useMemo, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from '../lib/safeHtml2canvas';
import { X, Printer, Download, FileText, CalendarCheck, Loader2, CheckSquare, Square } from 'lucide-react';
import { ScheduleSession, Specialty, Module, Level, Cycle, Room, User, Student, PedagogicalCalendar } from '../types';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import toast from 'react-hot-toast';

interface BulkSessionAttendanceModalProps {
  specialtyId: string;
  onClose: () => void;
  modules: Module[];
  specialties: Specialty[];
  levels: Level[];
  cycles: Cycle[];
  rooms: Room[];
  teachers: User[];
  students: Student[];
  scheduleSessions: ScheduleSession[];
  selectedSemester: 'S1' | 'S2';
  selectedYear: string;
}

const MONTH_NAMES_ARABIC = [
  'جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان',
  'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

const ACADEMIC_MONTH_ORDER = [
  'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  'جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت'
];

const getMonthsInBetween = (startDateStr: string, endDateStr: string) => {
  const months: string[] = [];
  try {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end) {
      const current = new Date(start.getFullYear(), start.getMonth(), 1);
      const targetEnd = new Date(end.getFullYear(), end.getMonth(), 1);
      
      let iterations = 0;
      while (current <= targetEnd && iterations < 24) {
        iterations++;
        const monthNum = current.getMonth();
        const monthName = MONTH_NAMES_ARABIC[monthNum];
        if (monthName && !months.includes(monthName)) {
          months.push(monthName);
        }
        current.setMonth(current.getMonth() + 1);
      }
    }
  } catch (e) {
    console.error('Error parsing calendar months:', e);
  }
  return months;
};

export default function BulkSessionAttendanceModal({
  specialtyId,
  onClose,
  modules,
  specialties,
  levels,
  cycles,
  rooms,
  teachers,
  students,
  scheduleSessions,
  selectedSemester,
  selectedYear,
}: BulkSessionAttendanceModalProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [calendar, setCalendar] = useState<PedagogicalCalendar | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [previewSessionId, setPreviewSessionId] = useState<string>('');
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [previewScale, setPreviewScale] = useState<number>(0.65);
  const printContainerRef = useRef<HTMLDivElement>(null);

  // Helper resolvers
  const resolveModule = (id: string) => modules.find(m => m.id === id);
  const resolveSpecialty = (id: string) => specialties.find(s => s.id === id);
  const resolveTeacher = (id: string) => teachers.find(t => t.uid === id);
  const resolveLevel = (id: string) => levels.find(l => l.id === id);
  const resolveCycle = (id: string) => cycles.find(c => c.id === id);

  const activeSpecialty = useMemo(() => resolveSpecialty(specialtyId), [specialtyId, specialties]);
  const activeLevel = useMemo(() => activeSpecialty ? resolveLevel(activeSpecialty.levelId) : null, [activeSpecialty, levels]);
  const activeCycle = useMemo(() => activeLevel ? resolveCycle(activeLevel.cycleId) : null, [activeLevel, cycles]);

  // Fetch Pedagogical Calendar
  useEffect(() => {
    const fetchCalendar = async () => {
      try {
        setLoadingCalendar(true);
        const q = query(
          collection(db, 'pedagogicalCalendars'),
          where('academicYear', '==', selectedYear)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setCalendar({ id: snap.docs[0].id, ...snap.docs[0].data() } as PedagogicalCalendar);
        }
      } catch (err) {
        console.error('Error loading calendar:', err);
      } finally {
        setLoadingCalendar(false);
      }
    };
    fetchCalendar();
  }, [selectedYear]);

  // Format level text
  const formattedLevel = useMemo(() => {
    if (!activeLevel) return '............................';
    const cycleName = activeCycle?.name || '';
    let ArabicLevel = activeLevel.name;
    if (ArabicLevel === 'L1') ArabicLevel = 'الأولى';
    else if (ArabicLevel === 'L2') ArabicLevel = 'الثانية';
    else if (ArabicLevel === 'L3') ArabicLevel = 'الثالثة';
    else if (ArabicLevel === 'M1') ArabicLevel = 'الأولى';
    else if (ArabicLevel === 'M2') ArabicLevel = 'الثانية';
    
    let cycleArabic = '';
    if (cycleName.toLowerCase().includes('licence') || cycleName.toLowerCase().includes('لسانس')) {
      cycleArabic = 'ليسانس';
    } else if (cycleName.toLowerCase().includes('master') || cycleName.toLowerCase().includes('ماستر')) {
      cycleArabic = 'ماستر';
    } else {
      cycleArabic = cycleName;
    }
    
    return `${ArabicLevel} ${cycleArabic}`;
  }, [activeLevel, activeCycle]);

  const formatSemesterArabic = useMemo(() => {
    return selectedSemester === 'S1' ? 'السداسي الأول' : 'السداسي الثاني';
  }, [selectedSemester]);

  // Calculate default months from calendar
  const defaultMonthsList = useMemo(() => {
    if (calendar) {
      const start = selectedSemester === 'S1' ? calendar.s1Start : calendar.s2Start;
      const end = selectedSemester === 'S1' ? calendar.s1End : calendar.s2End;
      if (start && end) {
        const months = getMonthsInBetween(start, end);
        if (months.length > 0) return months;
      }
    }
    return selectedSemester === 'S1'
      ? ['أكتوبر', 'نوفمبر', 'ديسمبر', 'جانفي', 'فيفري']
      : ['فيفري', 'مارس', 'أفريل', 'ماي', 'جوان'];
  }, [calendar, selectedSemester]);

  // Sync months on mount
  useEffect(() => {
    if (defaultMonthsList && defaultMonthsList.length > 0) {
      setSelectedMonths(defaultMonthsList);
    }
  }, [defaultMonthsList]);

  const sortedSelectedMonths = useMemo(() => {
    return [...selectedMonths].sort((a, b) => ACADEMIC_MONTH_ORDER.indexOf(a) - ACADEMIC_MONTH_ORDER.indexOf(b));
  }, [selectedMonths]);

  // Find all TD & TP sessions belonging directly to this specialty
  const activeSessions = useMemo(() => {
    return scheduleSessions.filter(s => 
      s.specialtyId === specialtyId && 
      s.semester === selectedSemester && 
      s.academicYear === selectedYear &&
      (s.type === 'TD' || s.type === 'TP') &&
      !s.isReserved
    );
  }, [specialtyId, scheduleSessions, selectedSemester, selectedYear]);

  // Default to selecting all sessions initially
  useEffect(() => {
    if (activeSessions.length > 0) {
      setSelectedSessionIds(activeSessions.map(s => s.id));
    }
  }, [activeSessions]);

  // Get active selected sessions list
  const selectedSessions = useMemo(() => {
    return activeSessions.filter(s => selectedSessionIds.includes(s.id));
  }, [activeSessions, selectedSessionIds]);

  // Ensure previewSessionId is always valid and points to a selected session
  useEffect(() => {
    if (selectedSessions.length > 0) {
      if (!previewSessionId || !selectedSessionIds.includes(previewSessionId)) {
        setPreviewSessionId(selectedSessions[0].id);
      }
    } else {
      setPreviewSessionId('');
    }
  }, [selectedSessionIds, selectedSessions, previewSessionId]);

  // Get students for this specialty
  const filteredStudents = useMemo(() => {
    return students
      .filter(s => 
        s.specialtyId === specialtyId && 
        (s.academicYear === selectedYear || s.academicYear?.replace('-', '/') === selectedYear.replace('-', '/'))
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [students, specialtyId, selectedYear]);

  const tableRowsCount = Math.max(22, filteredStudents.length);

  // Layout metrics for perfect portait fitting
  const layoutMetrics = useMemo(() => {
    const isCompact = tableRowsCount > 22 && tableRowsCount <= 30;
    const isUltraCompact = tableRowsCount > 30;
    
    let paddingY = '20px';
    let paddingX = '24px';
    let rowHeight = '27px';
    let headerHeight = '46px';
    let subHeaderCellPadding = '4px 8px';
    let fontSizeTable = '9px';
    let fontSizeName = '9px';
    let fontSizeReg = '8px';
    let titleMargin = 'my-2';
    let titlePadding = 'px-4 py-1';
    let titleFontSize = 'text-xs font-extrabold';
    let subHeaderTableMargin = 'mb-2';
    let tableMargin = 'my-2';
    let footerMarginTop = 'mt-2';
    let footerPaddingTop = 'pt-2';
    let fontSizeSubHeader = '9px';
    
    let tableWidth = 746; // Default printable width (794px - 48px padding)
    if (isUltraCompact) {
      tableWidth = 762; // 794 - 32px padding
      paddingY = '12px'; 
      paddingX = '16px';
      rowHeight = '17.5px';
      headerHeight = '34px';
      subHeaderCellPadding = '2px 4px';
      fontSizeTable = '7px';
      fontSizeName = '7.5px';
      fontSizeReg = '6.5px';
      titleMargin = 'my-1';
      titlePadding = 'px-2 py-0.5';
      titleFontSize = 'text-[9.5px] font-extrabold';
      subHeaderTableMargin = 'mb-1';
      tableMargin = 'my-1';
      footerMarginTop = 'mt-1';
      footerPaddingTop = 'pt-1';
      fontSizeSubHeader = '7.5px';
    } else if (isCompact) {
      tableWidth = 754; // 794 - 40px padding
      paddingY = '16px';
      paddingX = '20px';
      rowHeight = '21.5px'; 
      headerHeight = '40px';
      subHeaderCellPadding = '3px 6px';
      fontSizeTable = '8px';
      fontSizeName = '8.5px';
      fontSizeReg = '7.5px';
      titleMargin = 'my-1.5';
      titlePadding = 'px-3 py-1';
      titleFontSize = 'text-[11px] font-extrabold';
      subHeaderTableMargin = 'mb-1.5';
      tableMargin = 'my-1.5';
      footerMarginTop = 'mt-1.5';
      footerPaddingTop = 'pt-1.5';
      fontSizeSubHeader = '8.5px';
    }

    const colNoWidth = 35;
    const colRegWidth = 100;
    const monthsAreaWidth = 390; // Expanded to make the dynamic grid wide and clear
    const colNameWidth = tableWidth - colNoWidth - colRegWidth - monthsAreaWidth;
    
    return {
      paddingY,
      paddingX,
      rowHeight,
      headerHeight,
      subHeaderCellPadding,
      fontSizeTable,
      fontSizeName,
      fontSizeReg,
      titleMargin,
      titlePadding,
      titleFontSize,
      subHeaderTableMargin,
      tableMargin,
      footerMarginTop,
      footerPaddingTop,
      fontSizeSubHeader,
      tableWidth,
      colNoWidth,
      colRegWidth,
      monthsAreaWidth,
      colNameWidth
    };
  }, [tableRowsCount]);

  const handleToggleMonth = (month: string) => {
    setSelectedMonths(prev => 
      prev.includes(month) ? prev.filter(m => m !== month) : [...prev, month]
    );
  };

  const handleToggleSessionSelection = (sessionId: string) => {
    setSelectedSessionIds(prev => 
      prev.includes(sessionId) 
        ? prev.filter(id => id !== sessionId) 
        : [...prev, sessionId]
    );
  };

  const handleSelectAllSessions = () => {
    if (selectedSessionIds.length === activeSessions.length) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(activeSessions.map(s => s.id));
    }
  };

  // Render helper to avoid repeating content markup
  const renderAttendanceSheetContent = (session: ScheduleSession) => {
    const mod = resolveModule(session.moduleId);
    const teacher = resolveTeacher(session.teacherId);
    return (
      <>
        {/* Top Heading */}
        <div 
          className="flex justify-between items-start font-bold text-slate-800 leading-tight border-b border-black pb-1.5"
          style={{ fontSize: layoutMetrics.fontSizeSubHeader }}
        >
          <div className="text-right">
            <p className="font-extrabold text-black">جامعة عمار ثليجي الأغواط</p>
            <p className="font-semibold text-slate-700">كلية التكنولوجيا</p>
            <p className="font-semibold text-slate-700">قسم ومسار: الهندسة الميكانيكية</p>
          </div>
          <div className="text-left font-mono text-slate-800">
            <p className="font-extrabold text-black">السنة الجامعية: {selectedYear}</p>
            <p className="font-semibold text-slate-700">السداسي المتابع: {formatSemesterArabic}</p>
          </div>
        </div>

        {/* Centered Title */}
        <div className={`${layoutMetrics.titleMargin} w-full flex justify-center text-center`}>
          <div className={`mx-auto w-[380px] max-w-full ${layoutMetrics.titlePadding} border border-black bg-slate-50 rounded-lg text-center shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]`}>
            <h1 className={`${layoutMetrics.titleFontSize} text-black block w-full text-center tracking-normal leading-normal`}>
              بطاقة متابعة حضور وغيابات الطلبة للسداسي
            </h1>
          </div>
        </div>

        {/* Subheaders details table */}
        <table 
          className={`w-full border border-black bg-white ${layoutMetrics.subHeaderTableMargin} text-black border-collapse`}
          style={{ letterSpacing: 'normal', fontSize: layoutMetrics.fontSizeSubHeader }}
        >
          <tbody>
            <tr className="border-b border-black">
              <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 border-l border-black bg-slate-50/50 text-right leading-tight">
                <span className="text-slate-500 font-bold">المستوى الدراسي:</span>
                <span className="text-black font-extrabold mr-1.5 select-text">{formattedLevel}</span>
              </td>
              <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 border-l border-black bg-slate-50/50 text-right leading-tight">
                <span className="text-slate-500 font-bold">التخصص:</span>
                <span className="text-black font-extrabold mr-1.5 select-text">{activeSpecialty?.name || '............................'}</span>
              </td>
              <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 bg-slate-50/50 text-right leading-tight">
                <span className="text-slate-500 font-bold">طبيعة الحصة:</span>
                <span 
                  className="text-emerald-800 font-black mr-1.5 px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 rounded inline-block leading-none"
                  style={{ fontSize: `calc(${layoutMetrics.fontSizeSubHeader} - 1.5px)` }}
                >
                  {session.type}
                </span>
              </td>
            </tr>
            <tr>
              <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 border-l border-black text-right leading-tight">
                <span className="text-slate-500 font-bold">المقياس (المادة):</span>
                <span className="text-black font-extrabold mr-1.5 select-text">{mod?.name || '............................'}</span>
              </td>
              <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 border-l border-black text-right leading-tight">
                <span className="text-slate-500 font-bold">الأستاذ المدرس:</span>
                <span className="text-black font-extrabold mr-1.5 select-text">{teacher?.displayName || '............................'}</span>
              </td>
              <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 text-right leading-tight">
                <span className="text-slate-500 font-bold">السداسي المتابع:</span>
                <span className="text-black font-extrabold mr-1.5 select-text">{formatSemesterArabic}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Main Students Table */}
        <div className={`w-full ${layoutMetrics.tableMargin} flex justify-center flex-1 overflow-hidden`}>
          <div className="border-2 border-black flex flex-col bg-white overflow-hidden text-black" style={{ width: `${layoutMetrics.tableWidth}px` }}>
            
            {/* Header Row */}
            <div className="flex bg-slate-100 border-b-2 border-black text-center font-extrabold" style={{ height: layoutMetrics.headerHeight, fontSize: layoutMetrics.fontSizeTable }}>
              <div className="flex items-center justify-center border-l-2 border-black font-extrabold p-1" style={{ width: `${layoutMetrics.colNoWidth}px`, height: '100%' }}>رقم</div>
              <div className="flex items-center text-right pr-2 border-l-2 border-black font-extrabold p-1" style={{ width: `${layoutMetrics.colNameWidth}px`, height: '100%', direction: 'rtl' }}>اللقب والاسم</div>
              <div className="flex items-center justify-center border-l-2 border-black font-extrabold p-1" style={{ width: `${layoutMetrics.colRegWidth}px`, height: '100%' }}>رقم التسجيل</div>
              
              {sortedSelectedMonths.map((m, idx) => {
                const monthWidth = layoutMetrics.monthsAreaWidth / (sortedSelectedMonths.length || 1);
                const weekWidth = monthWidth / 4;
                const headerPx = parseInt(layoutMetrics.headerHeight);
                const monthTitleH = `${(headerPx / 2).toFixed(1)}px`;
                const weeksRowH = `${(headerPx - (headerPx / 2)).toFixed(1)}px`;

                return (
                  <div key={idx} className={`flex flex-col h-full ${idx < sortedSelectedMonths.length - 1 ? 'border-l-2 border-black' : ''}`} style={{ width: `${monthWidth}px` }}>
                    <div className="flex items-center justify-center bg-slate-50 border-b border-black font-black" style={{ height: monthTitleH, fontSize: layoutMetrics.fontSizeTable }}>{m}</div>
                    <div className="flex text-center font-bold text-slate-700" style={{ height: weeksRowH, fontSize: `calc(${layoutMetrics.fontSizeTable} - 1.5px)` }}>
                      <div className="flex items-center justify-center border-l border-slate-300 h-full" style={{ width: `${weekWidth}px` }}>ح1</div>
                      <div className="flex items-center justify-center border-l border-slate-300 h-full" style={{ width: `${weekWidth}px` }}>ح2</div>
                      <div className="flex items-center justify-center border-l border-slate-300 h-full" style={{ width: `${weekWidth}px` }}>ح3</div>
                      <div className="flex items-center justify-center h-full" style={{ width: `${weekWidth}px` }}>ح4</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Table Body */}
            <div className="flex flex-col">
              {Array.from({ length: tableRowsCount }).map((_, rIdx) => {
                const student = filteredStudents[rIdx];
                const rowNum = rIdx + 1;
                
                return (
                  <div key={rIdx} className="flex text-center font-medium hover:bg-slate-50/50 border-b border-black last:border-b-0" style={{ height: layoutMetrics.rowHeight }}>
                    <div className="flex items-center justify-center border-l-2 border-black bg-slate-50 font-bold h-full overflow-hidden" style={{ width: `${layoutMetrics.colNoWidth}px`, fontSize: layoutMetrics.fontSizeReg }}>{rowNum}</div>
                    <div className="flex items-center text-right px-2 border-l-2 border-black font-bold h-full leading-tight py-1 select-text whitespace-nowrap overflow-hidden text-ellipsis" style={{ width: `${layoutMetrics.colNameWidth}px`, direction: 'rtl', fontSize: layoutMetrics.fontSizeName }}>{student ? student.name : ''}</div>
                    <div className="flex items-center justify-center border-l-2 border-black font-mono text-slate-800 leading-tight py-1 select-text h-full whitespace-nowrap overflow-hidden text-ellipsis" style={{ width: `${layoutMetrics.colRegWidth}px`, fontSize: layoutMetrics.fontSizeReg }}>{student ? (student.registrationNumber || '---') : ''}</div>
                    
                    {sortedSelectedMonths.map((_, mIdx) => {
                      const monthWidth = layoutMetrics.monthsAreaWidth / (sortedSelectedMonths.length || 1);
                      const weekWidth = monthWidth / 4;
                      return (
                        <div key={mIdx} className={`flex h-full bg-white ${mIdx < sortedSelectedMonths.length - 1 ? 'border-l-2 border-black' : ''}`} style={{ width: `${monthWidth}px` }}>
                          <div className="border-l border-slate-300 h-full" style={{ width: `${weekWidth}px` }}></div>
                          <div className="border-l border-slate-300 h-full" style={{ width: `${weekWidth}px` }}></div>
                          <div className="border-l border-slate-300 h-full" style={{ width: `${weekWidth}px` }}></div>
                          <div className="h-full" style={{ width: `${weekWidth}px` }}></div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom annotation area */}
        <div className={`${layoutMetrics.footerMarginTop} border-t-2 border-black ${layoutMetrics.footerPaddingTop} flex justify-between items-end text-xs leading-normal`}>
          <div className="flex flex-col gap-0.5 text-right" style={{ fontSize: layoutMetrics.fontSizeName }}>
            <span className="font-extrabold text-black">ترميز المتابعة:</span>
            <p className="text-slate-600 font-semibold">
              * يرجى كتابة رمز <strong className="text-black bg-slate-100 px-1 rounded font-bold">غ</strong> للغياب غير المبرر، ورمز <strong className="text-black bg-slate-100 px-1 rounded font-bold font-sans">ب</strong> للغياب المبرر، وعلامة <strong className="text-black bg-slate-100 px-1 rounded font-bold">✓</strong> للحضور الفعلي.
            </p>
          </div>

          <div className="flex flex-col text-left font-extrabold text-black pl-4 whitespace-nowrap" style={{ fontSize: layoutMetrics.fontSizeName }}>
            <span>توقيع الأستاذ المدرس: .......................................</span>
          </div>
        </div>
      </>
    );
  };

  // Export selected sessions combined in a unified landscape or Portrait PDF document
  const handleExportPDF = async () => {
    if (selectedSessions.length === 0) {
      toast.error('يرجى تحديد مقياس واحد على الأقل للتحميل');
      return;
    }
    if (sortedSelectedMonths.length === 0) {
      toast.error('يرجى تحديد شهر واحد على الأقل من الرزنامة');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    const toastId = toast.loading(`جاري تحضير ودمج محاضر الحضور (${selectedSessions.length} مقاييس)...`);

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');

      for (let index = 0; index < selectedSessions.length; index++) {
        const session = selectedSessions[index];
        setExportProgress(index + 1);

        // Get the off-screen printing element which is guaranteed to be display:flex (fully rendered)
        const element = document.getElementById(`print-attendance-sheet-${session.id}`);

        if (!element) {
          console.warn(`Print element print-attendance-sheet-${session.id} not found in DOM`);
          continue;
        }

        const canvas = await html2canvas(element, {
          scale: 2.5,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: 794,
          height: 1123,
          windowWidth: 794,
          windowHeight: 1123,
        });

        const imgData = canvas.toDataURL('image/png');
        
        if (index > 0) {
          pdf.addPage('a4', 'p');
        }

        pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
      }

      const filePrefix = activeSpecialty?.name.replace(/\s+/g, '_') || 'Specialty';
      pdf.save(`Bulk_Attendance_TD_TP_${filePrefix}.pdf`);
      toast.success('تم تحضير ودمج وتحميل كافة محاضر حضور الموجهة والتطبيقية بنجاح!', { id: toastId });
    } catch (e) {
      console.error(e);
      toast.error('فشل إنتاج ملف PDF المدمج', { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-hidden" id="bulk-attendance-minutes-modal">
      <div className="bg-slate-50 w-full max-w-7xl rounded-3xl border-2 border-black shadow-2xl flex flex-col h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b-2 border-black">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-200">
              <FileText className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 font-sans tracking-tight">تحميل محاضر الحضور المجمعة (الأعمال الموجهة TD والتطبيقية TP)</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">خاص بكل مقاييس التخصص: {activeSpecialty?.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 hover:border-slate-300"
            id="close-bulk-attendance-modal-btn"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Column layout: Selector lists on the left, interactive preview on the right */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-slate-100">
          
          {/* Controls Sidebar */}
          <div className="w-full lg:w-[420px] bg-white border-b lg:border-b-0 lg:border-l-2 border-black flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h4 className="font-extrabold text-sm text-slate-900 border-r-4 border-emerald-500 pr-2">إعداد المحاضر المدمجة</h4>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* 1. Month Picker */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <CalendarCheck className="w-4 h-4 text-emerald-600" /> أشهر السداسي المشمولة:
                </span>
                <div className="grid grid-cols-2 gap-1.5 text-right" dir="rtl">
                  {ACADEMIC_MONTH_ORDER.map(month => {
                    const isChecked = selectedMonths.includes(month);
                    const suggested = (selectedSemester === 'S1' && ['أكتوبر', 'نوفمبر', 'ديسمبر', 'جانفي', 'فيفري'].includes(month)) ||
                                      (selectedSemester === 'S2' && ['فيفري', 'مارس', 'أفريل', 'ماي', 'جوان'].includes(month));

                    return (
                      <button
                        key={month}
                        onClick={() => handleToggleMonth(month)}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border-2 text-right transition-all flex items-center justify-between ${
                          isChecked 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-500' 
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <input type="checkbox" checked={isChecked} readOnly className="pointer-events-none accent-emerald-600" />
                          <span>{month}</span>
                        </span>
                        {suggested && <span className="text-[9px] scale-90 font-normal opacity-70 bg-emerald-100 text-emerald-800 px-1 rounded">مقترح</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Session Selector List */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <FileText className="w-4 h-4 text-emerald-600" /> حدد المقاييس لإدراجها ({selectedSessions.length}/{activeSessions.length}):
                  </span>
                  <button 
                    onClick={handleSelectAllSessions}
                    className="text-[10px] font-extrabold text-blue-600 hover:underline"
                  >
                    {selectedSessionIds.length === activeSessions.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                  </button>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 max-h-[220px] overflow-y-auto">
                  {activeSessions.length === 0 ? (
                    <div className="p-4 text-center text-xs font-bold text-slate-400">لا توجد حصص TD أو TP مبرمجة في جدول السداسي لهذا التخصص.</div>
                  ) : (
                    activeSessions.map((session, sIdx) => {
                      const mod = resolveModule(session.moduleId);
                      const teacher = resolveTeacher(session.teacherId);
                      const isSelected = selectedSessionIds.includes(session.id);

                      return (
                        <div 
                          key={session.id} 
                          onClick={() => handleToggleSessionSelection(session.id)}
                          className={`p-2.5 flex items-start gap-2.5 hover:bg-slate-50 cursor-pointer transition-colors ${
                            isSelected ? 'bg-emerald-50/[0.15]' : ''
                          }`}
                        >
                          <div className="mt-0.5">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-right leading-tight" dir="rtl">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-extrabold text-slate-900 truncate">{mod?.name || 'مقياس مجهول'}</p>
                              <span className={`text-[8.5px] px-1 rounded font-black ${
                                session.type === 'TD' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                              }`}>{session.type}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 font-semibold mt-1 truncate">الأستاذ: {teacher?.displayName || 'غير محدد'}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            {/* Quick Export action drawer */}
            <div className="p-4 border-t-2 border-black bg-slate-50 space-y-2">
              <button
                onClick={handleExportPDF}
                disabled={isExporting || selectedSessions.length === 0 || sortedSelectedMonths.length === 0}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 border-2 border-black text-white rounded-2xl font-extrabold text-sm shadow-md transition-all hover:-translate-y-0.5 active:translate-y-0"
              >
                {isExporting ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Download className="w-4.5 h-4.5" />}
                <span>
                  {isExporting 
                    ? `جاري طباعة الملفات (${exportProgress}/${selectedSessions.length})` 
                    : `تجميع وتحميل مدمج PDF (${selectedSessions.length} مقاييس)`}
                </span>
              </button>
              <p className="text-[10px] text-center text-slate-400 font-bold leading-normal">
                سيقوم النظام بجمع صفحات الغياب لكافة المقاييس المحددة من جدول التخصص ودمجها بملف PDF عمودي واحد (صفحة مستقلة لكل مقياس)
              </p>
            </div>
          </div>

          {/* Canvas Preview Space */}
          <div className="flex-1 overflow-auto p-6 flex flex-col items-center">
            
            {/* Horizontal Sheet Selector Preview tabs */}
            {selectedSessions.length > 0 && (
              <div className="w-full max-w-[794px] overflow-x-auto flex items-center gap-2 pt-3 pb-4 px-2 mb-2 scrollbar-thin" dir="rtl">
                <span className="text-xs font-extrabold text-slate-700 self-center whitespace-nowrap pl-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  تحديد ورقة للمعاينة:
                </span>
                <div className="flex gap-2 py-0.5">
                  {selectedSessions.map((sess) => {
                    const mod = resolveModule(sess.moduleId);
                    const isCurrent = sess.id === previewSessionId;

                    return (
                      <button
                        key={sess.id}
                        onClick={() => setPreviewSessionId(sess.id)}
                        className={`px-3.5 py-1.5 text-xs font-extrabold rounded-xl whitespace-nowrap border-2 transition-all cursor-pointer ${
                          isCurrent 
                            ? 'bg-blue-600 text-white border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' 
                            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-400'
                        }`}
                      >
                        {mod?.name} ({sess.type})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Beautiful Zoom Controllers & Scaling Bar */}
            {selectedSessions.length > 0 && (
              <div className="w-full max-w-[794px] flex flex-col sm:flex-row gap-3 items-center justify-between bg-white border-2 border-black p-3.5 rounded-2xl mb-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] bg-slate-50" dir="rtl">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs font-black text-slate-700 flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 py-1.5 rounded-xl text-right whitespace-nowrap">
                    <span>🔍 زوم المعاينة:</span>
                    <span className="text-blue-600 font-black font-mono">{Math.round(previewScale * 100)}%</span>
                  </span>
                  
                  {/* Preset Quick Buttons */}
                  <div className="flex gap-1 overflow-x-auto">
                    {[0.5, 0.65, 0.8, 1.0].map((scaleVal) => (
                      <button
                        key={scaleVal}
                        onClick={() => setPreviewScale(scaleVal)}
                        className={`px-2.5 py-1 text-xs font-extrabold rounded-xl transition-all border-2 cursor-pointer whitespace-nowrap ${
                          Math.abs(previewScale - scaleVal) < 0.01
                            ? 'bg-blue-600 text-white border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]'
                            : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-350'
                        }`}
                      >
                        {scaleVal * 100}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Range Slider for custom precision zooming */}
                <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:max-w-[260px]" dir="ltr">
                  <button 
                    onClick={() => setPreviewScale(prev => Math.max(0.4, prev - 0.05))}
                    className="p-1 hover:bg-slate-200 active:bg-slate-300 rounded border border-slate-300 transition-colors text-slate-600 font-extrabold text-xs px-2 cursor-pointer bg-white"
                    title="تصغير"
                  >
                    -
                  </button>
                  <input
                    type="range"
                    min="0.4"
                    max="1.2"
                    step="0.05"
                    value={previewScale}
                    onChange={(e) => setPreviewScale(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-slate-200 accent-blue-600 rounded-lg appearance-none cursor-pointer"
                  />
                  <button 
                    onClick={() => setPreviewScale(prev => Math.min(1.2, prev + 0.05))}
                    className="p-1 hover:bg-slate-250 active:bg-slate-300 rounded border border-slate-300 transition-colors text-slate-600 font-extrabold text-xs px-2 cursor-pointer bg-white"
                    title="تكبير"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* High-Fidelity A4 preview area with Mathematical scaling container wrapper */}
            <div 
              ref={printContainerRef} 
              className="relative select-none bg-slate-300 rounded-3xl border border-slate-400 shadow-inner overflow-hidden flex-shrink-0"
              style={{
                width: `${Math.round(794 * previewScale) + 40}px`,
                height: `${Math.round(1123 * previewScale) + 40}px`,
                transition: 'all 0.15s ease-out',
              }}
            >
              {activeSessions.map((session, sIdx) => {
                const isSelected = session.id === previewSessionId;

                return (
                  <div
                    key={session.id}
                    id={`bulk-attendance-sheet-${sIdx}`}
                    className={`${isSelected ? 'flex' : 'hidden'} text-black bg-white shadow-2xl font-sans absolute origin-top-left flex-col justify-between`}
                    dir="rtl"
                    style={{ 
                      width: '794px', 
                      height: '1123px', 
                      left: '20px',
                      top: '20px',
                      padding: `${layoutMetrics.paddingY} ${layoutMetrics.paddingX}`,
                      boxSizing: 'border-box', 
                      fontFamily: '"Almarai", "Inter", sans-serif',
                      backgroundColor: '#ffffff',
                      transform: `scale(${previewScale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    {renderAttendanceSheetContent(session)}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>

      {/* Off-screen Printing Container (always 100% visible to layout engine for html2canvas snapshots) */}
      <div 
        className="absolute left-[-9999px] top-0 pointer-events-none select-none flex flex-col gap-10 bg-white" 
        style={{ width: '794px' }}
      >
        {selectedSessions.map((session) => (
          <div
            key={`print-attendance-sheet-${session.id}`}
            id={`print-attendance-sheet-${session.id}`}
            className="flex text-black bg-white font-sans flex-col justify-between"
            dir="rtl"
            style={{ 
              width: '794px', 
              height: '1123px', 
              padding: `${layoutMetrics.paddingY} ${layoutMetrics.paddingX}`,
              boxSizing: 'border-box', 
              fontFamily: '"Almarai", "Inter", sans-serif',
              backgroundColor: '#ffffff'
            }}
          >
            {renderAttendanceSheetContent(session)}
          </div>
        ))}
      </div>
    </div>
  );
}
