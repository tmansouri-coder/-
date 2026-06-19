import React, { useRef, useState, useMemo, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from '../lib/safeHtml2canvas';
import { X, Printer, Download, FileText, CalendarCheck, Loader2 } from 'lucide-react';
import { ScheduleSession, Specialty, Module, Level, Cycle, Room, User, Student, PedagogicalCalendar } from '../types';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import toast from 'react-hot-toast';

interface SessionAttendanceModalProps {
  session: ScheduleSession;
  onClose: () => void;
  modules: Module[];
  specialties: Specialty[];
  levels: Level[];
  cycles: Cycle[];
  rooms: Room[];
  teachers: User[];
  students: Student[];
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
      
      // Safety limit to avoid infinite loop
      let iterations = 0;
      while (current <= targetEnd && iterations < 24) {
        iterations++;
        const monthNum = current.getMonth(); // 0 - 11
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

export default function SessionAttendanceModal({
  session,
  onClose,
  modules,
  specialties,
  levels,
  cycles,
  rooms,
  teachers,
  students,
  selectedSemester,
  selectedYear,
}: SessionAttendanceModalProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [calendar, setCalendar] = useState<PedagogicalCalendar | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const printContainerRef = useRef<HTMLDivElement>(null);

  // Helper resolvers
  const resolveModule = (id: string) => modules.find(m => m.id === id);
  const resolveSpecialty = (id: string) => specialties.find(s => s.id === id);
  const resolveTeacher = (id: string) => teachers.find(t => t.uid === id);
  const resolveLevel = (id: string) => levels.find(l => l.id === id);
  const resolveCycle = (id: string) => cycles.find(c => c.id === id);

  const activeModule = useMemo(() => resolveModule(session.moduleId), [session.moduleId, modules]);
  const activeSpecialty = useMemo(() => resolveSpecialty(session.specialtyId), [session.specialtyId, specialties]);
  const activeLevel = useMemo(() => activeSpecialty ? resolveLevel(activeSpecialty.levelId) : null, [activeSpecialty, levels]);
  const activeCycle = useMemo(() => activeLevel ? resolveCycle(activeLevel.cycleId) : null, [activeLevel, cycles]);
  const activeTeacher = useMemo(() => resolveTeacher(session.teacherId), [session.teacherId, teachers]);

  // Fetch Pedagogical Calendar for active academic year
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

  // Format level representation (e.g. الأولى ماستر or الثالثة ليسانس)
  const formattedLevel = useMemo(() => {
    if (!activeLevel) return '............................';
    const cycleName = activeCycle?.name || '';
    let ArabicLevel = activeLevel.name;
    // Map L1, L2, L3, M1, M2 to Arabic
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

  // Format Semester to Arabic (السداسي الأول / السداسي الثاني)
  const formatSemesterArabic = useMemo(() => {
    return selectedSemester === 'S1' ? 'السداسي الأول' : 'السداسي الثاني';
  }, [selectedSemester]);

  // Calculate default months list based on Firestore Calendar or standard fallback
  const defaultMonthsList = useMemo(() => {
    if (calendar) {
      const start = selectedSemester === 'S1' ? calendar.s1Start : calendar.s2Start;
      const end = selectedSemester === 'S1' ? calendar.s1End : calendar.s2End;
      if (start && end) {
        const months = getMonthsInBetween(start, end);
        if (months.length > 0) return months;
      }
    }
    
    // Grateful standard legacy fallback
    return selectedSemester === 'S1'
      ? ['أكتوبر', 'نوفمبر', 'ديسمبر', 'جانفي', 'فيفري']
      : ['فيفري', 'مارس', 'أفريل', 'ماي', 'جوان'];
  }, [calendar, selectedSemester]);

  // Sync selectedMonths once default is resolved
  useEffect(() => {
    if (defaultMonthsList && defaultMonthsList.length > 0) {
      setSelectedMonths(defaultMonthsList);
    }
  }, [defaultMonthsList]);

  // Sort selected months in academic chronological order
  const sortedSelectedMonths = useMemo(() => {
    return [...selectedMonths].sort((a, b) => ACADEMIC_MONTH_ORDER.indexOf(a) - ACADEMIC_MONTH_ORDER.indexOf(b));
  }, [selectedMonths]);

  // Get all students belonging to this specialty, level, and academic year
  const filteredStudents = useMemo(() => {
    if (!session.specialtyId) return [];
    return students
      .filter(s => 
        s.specialtyId === session.specialtyId && 
        (s.academicYear === selectedYear || s.academicYear?.replace('-', '/') === selectedYear.replace('-', '/'))
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [students, session.specialtyId, selectedYear]);

  // Export as Landscape PDF with a bulletproof clone trick to avoid scrolling cutoff and offsets
  const handleExportPDF = async () => {
    if (sortedSelectedMonths.length === 0) {
      toast.error('يرجى تحديد شهر واحد على الأقل للطباعة');
      return;
    }
    setIsExporting(true);
    const toastId = toast.loading('جاري تحضير ورقة حضور الحصة...');

    try {
      const element = document.getElementById('attendance-print-page');
      if (!element) throw new Error('Ref missing');

      // Scroll parent preview to top to prevent position-shifting issues
      const scrollParent = element.closest('.overflow-auto');
      if (scrollParent) {
        scrollParent.scrollTop = 0;
      }

      // To fix any html2canvas cropping or offset bugs due to parents overflow-auto,
      // we temporarily clone the element and append it directly to the body with fixed positioning.
      // We set a strict A4 portrait resolution of 794px x 1123px to ensure 100% exact rendering without cuts.
      const clone = element.cloneNode(true) as HTMLElement;
      clone.style.position = 'fixed';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.width = '794px';
      clone.style.height = '1123px'; // EXACT height to enforce standard A4 portrait sheet boundaries.
      clone.style.zIndex = '-999999';
      clone.style.margin = '0';
      clone.style.padding = layoutMetrics.paddingY + ' ' + layoutMetrics.paddingX;
      clone.style.boxSizing = 'border-box';
      clone.style.backgroundColor = '#ffffff';
      clone.style.transform = 'none';
      clone.style.boxShadow = 'none';
      clone.style.border = 'none';
      document.body.appendChild(clone);

      const canvas = await html2canvas(clone, {
        scale: 3, // Retain ultra-sharp high-res scaling (300 DPI+)
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        width: 794,
        height: 1123,
        windowWidth: 794,
        windowHeight: 1123,
      });

      // Remove the clone safely
      clone.remove();

      const imgData = canvas.toDataURL('image/png');
      
      const pdfWidth = 210;
      const pdfHeight = 297;

      // Create standard portrait A4 PDF page
      const pdf = new jsPDF('p', 'mm', 'a4');

      // Fit the high DPI rendering exactly on the PDF portrait page
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

      const activeModuleName = activeModule?.name.replace(/\s+/g, '_') || 'Course_Attendance';
      pdf.save(`Attendance_Semester_${activeModuleName}_${selectedYear.replace('/', '-')}.pdf`);
      toast.success('تم تحميل ورقة حضور الحصة بنجاح', { id: toastId });
    } catch (e) {
      console.error(e);
      toast.error('فشل تصدير ملف PDF', { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  // Direct printing with high-fidelity, native HTML and connected Arabic text inside a sandboxed iframe
  const handleDirectPrint = async () => {
    if (sortedSelectedMonths.length === 0) {
      toast.error('يرجى تحديد شهر واحد على الأقل للطباعة');
      return;
    }
    setIsPrinting(true);
    const toastId = toast.loading('جاري تجهيز الصفحة للطباعة المباشرة...');

    try {
      const element = document.getElementById('attendance-print-page');
      if (!element) throw new Error('Ref missing');

      // Create a clean hidden printing iframe (using style.left instead of visibility: hidden so browser doesn't skip layout pass)
      const oldIframe = document.getElementById('print-attendance-hidden-iframe');
      if (oldIframe) {
        oldIframe.remove();
      }

      const iframe = document.createElement('iframe');
      iframe.id = 'print-attendance-hidden-iframe';
      iframe.style.position = 'fixed';
      iframe.style.left = '-9999px';
      iframe.style.top = '-9999px';
      iframe.style.width = '210mm';
      iframe.style.height = '297mm';
      iframe.style.border = 'none';

      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document || iframe.contentDocument;
      if (!iframeDoc) throw new Error('Cannot access print sandbox frame');

      // Extract all stylesheet rules from parent to inject inside iframe for identical Tailwind styles
      let stylesHTML = '';
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((styleNode) => {
        stylesHTML += styleNode.outerHTML;
      });

      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
          <head>
            <title>بطاقة متابعة حضور وغيابات الطلبة للسداسي</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&display=swap" rel="stylesheet">
            ${stylesHTML}
            <style>
              @media print {
                @page {
                  size: A4 portrait;
                  margin: 6mm;
                }
                body {
                  margin: 0;
                  padding: 0;
                  background-color: #ffffff;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
              }
              body {
                font-family: 'Almarai', 'Inter', sans-serif !important;
                background-color: #ffffff;
                width: 100%;
                margin: 0;
                padding: 0;
              }
              /* Clean override of preview container styling for perfect full page fit */
              #attendance-print-page {
                box-shadow: none !important;
                border: none !important;
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                min-height: auto !important;
              }
            </style>
          </head>
          <body>
            <div style="width: 100%; box-sizing: border-box;">
              ${element.innerHTML}
            </div>
          </body>
        </html>
      `);
      iframeDoc.close();

      // Give browser brief window to load font assets, establish connections and render document natively
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          toast.success('تم فتح نافذة الطباعة بنجاح', { id: toastId });
        } catch (err) {
          console.error('Frame print failed:', err);
          toast.error('لم نتمكن من تشغيل الطباعة داخل الإطار البيني', { id: toastId });
        }
      }, 1000);

    } catch (e) {
      console.error('Printing error:', e);
      toast.error('فشلت عملية الطباعة المباشرة', { id: toastId });
    } finally {
      setIsPrinting(false);
    }
  };

  const tableRowsCount = Math.max(22, filteredStudents.length);

  // Dynamic layout calculations to fit perfectly inside EXACTLY one standard A4 Portrait page (794px x 1123px)
  const layoutMetrics = useMemo(() => {
    const isCompact = tableRowsCount > 22 && tableRowsCount <= 30;
    const isUltraCompact = tableRowsCount > 30;
    
    let paddingY = '20px'; // Recalibrated elegant padding
    let paddingX = '24px';
    let rowHeight = '27px'; // High legibility rows
    let headerHeight = '46px';
    let subHeaderCellPadding = '4px 8px'; // Tight cell padding
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
    
    if (isUltraCompact) {
      paddingY = '12px'; 
      paddingX = '16px';
      rowHeight = '17.5px'; // Compact and comfortable
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
      fontSizeSubHeader
    };
  }, [tableRowsCount]);

  // Generate the relative widths of columns for the table using precise pixels instead of percentages
  // to avoid browser rounding issues and overlap bugs in RTL layout inside html2canvas.
  const colWidths = useMemo(() => {
    const totalMonths = sortedSelectedMonths.length || 1;
    const numberColWidth = "30px";
    const nameColWidth = "230px";
    const regColWidth = "100px";
    
    // Exact table width in Portrait is 730px.
    // 730px - (30px + 230px + 100px) = 370px remaining for study session columns.
    const remainingWidth = 370;
    const sessionColWidth = `${(remainingWidth / (totalMonths * 4)).toFixed(3)}px`;
    
    return {
      numberColWidth,
      nameColWidth,
      regColWidth,
      sessionColWidth
    };
  }, [sortedSelectedMonths]);

  // Toggle month selection handler
  const handleToggleMonth = (month: string) => {
    setSelectedMonths(prev => {
      if (prev.includes(month)) {
        return prev.filter(m => m !== month);
      } else {
        return [...prev, month];
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-hidden" id="attendance-minutes-modal">
      <div className="bg-slate-50 w-full max-w-7xl rounded-3xl border-2 border-black shadow-2xl flex flex-col h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b-2 border-black">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-200">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 font-sans tracking-tight">طباعة ورقة حضور السداسي</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{activeModule?.name} - {activeSpecialty?.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 hover:border-slate-300"
            id="close-attendance-modal-btn"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Toolbar Controls */}
        <div className="p-4 bg-white border-b-2 border-black flex flex-col gap-4">
          {/* Top Row: Information & Export Button */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-700">
                عدد الطلبة المسجلين: <mark className="bg-emerald-100 text-emerald-800 font-extrabold px-2 py-0.5 rounded font-mono">{filteredStudents.length}</mark> طالب
              </span>
              <span className="text-xs text-slate-500 font-bold bg-slate-100 px-2 py-1 rounded">
                أورينتاسيون: عمودي (Portrait) لضمان دقة كامل السداسي
              </span>
              {loadingCalendar && (
                <span className="text-xs text-yellow-600 font-bold flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري جلب الرزنامة الرسمية...
                </span>
              )}
              {calendar && !loadingCalendar && (
                <span className="text-xs text-emerald-600 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <CalendarCheck className="w-3.5 h-3.5" /> تم تحميل تواريخ الرزنامة بنجاح
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleDirectPrint}
                disabled={isPrinting || sortedSelectedMonths.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 border-2 border-black rounded-xl hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md transition-all hover:-translate-y-0.5 active:translate-y-0"
                id="direct-print-attendance-btn"
              >
                {isPrinting ? (
                  <Loader2 className="w-4.5 h-4.5 animate-spin" />
                ) : (
                  <Printer className="w-4.5 h-4.5" />
                )}
                <span>{isPrinting ? 'جاري التحضير...' : 'طباعة مباشرة (Print)'}</span>
              </button>

              <button
                onClick={handleExportPDF}
                disabled={isExporting || sortedSelectedMonths.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 border-2 border-black rounded-xl hover:bg-emerald-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md transition-all hover:-translate-y-0.5 active:translate-y-0"
                id="print-attendance-pdf-btn"
              >
                <Download className="w-4 h-4" />
                <span>تحميل ورقة غيابات السداسي (PDF)</span>
              </button>
            </div>
          </div>

          {/* Interactive Month Selection from Calendar */}
          <div className="p-3 bg-slate-100 border-2 border-black rounded-2xl">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5" dir="rtl">
                <CalendarCheck className="w-4 h-4 text-emerald-600" />
                <span>اختر الشهور من الرزنامة لعرضها في بطاقة الغيابات:</span>
              </p>
              
              <div className="flex flex-wrap gap-1.5 justify-start" dir="rtl">
                {ACADEMIC_MONTH_ORDER.map((month) => {
                  const isChecked = selectedMonths.includes(month);
                  const isS1Default = selectedSemester === 'S1' && ['أكتوبر', 'نوفمبر', 'ديسمبر', 'جانفي', 'فيفري'].includes(month);
                  const isS2Default = selectedSemester === 'S2' && ['فيفري', 'مارس', 'أفريل', 'ماي', 'جوان'].includes(month);
                  
                  return (
                    <button
                      key={month}
                      onClick={() => handleToggleMonth(month)}
                      className={`px-3 py-1 text-xs font-bold rounded-xl border-2 transition-all flex items-center gap-1.5 ${
                        isChecked
                          ? 'bg-emerald-500 text-white border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}} // Controlled via button click
                        className="pointer-events-none accent-black w-3.5 h-3.5"
                      />
                      <span>{month}</span>
                      {(isS1Default || isS2Default) && (
                        <span className={`text-[8px] px-1 rounded font-normal ${isChecked ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          مقترح
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {sortedSelectedMonths.length > 5 && (
                <p className="text-[10px] font-bold text-amber-600 mt-1" dir="rtl">
                  ⚠️ تنبيه: تم تحديد {sortedSelectedMonths.length} أشهر. تحديد أكثر من 5 أشهر قد يجعل خلايا الجدول ضيقة بعض الشيء لملائمة مقاس الورقة A4 العمودية.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Modal Scrollable Preview Area */}
        <div className="flex-1 overflow-auto p-6 flex justify-center bg-slate-200">
          <div 
            ref={printContainerRef}
            className="flex flex-col select-none"
          >
            {sortedSelectedMonths.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-3xl border-2 border-black max-w-md mx-auto my-12" dir="rtl">
                <p className="text-slate-500 font-bold mb-4">الرجاء تشفير وتحديد شهر واحد على الأقل من القائمة أعلاه لعرض الجدول.</p>
              </div>
            ) : (
              <div
                id="attendance-print-page"
                className="text-black bg-white shadow-lg border-2 border-black font-sans relative flex flex-col justify-between"
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

                {/* Centered Title with a sleek, compact, and low-height layout to fit A4 perfectly */}
                <div className={`${layoutMetrics.titleMargin} w-full flex justify-center text-center`}>
                  <div className={`mx-auto w-[380px] max-w-full ${layoutMetrics.titlePadding} border border-black bg-slate-50 rounded-lg text-center shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]`}>
                    <h1 
                      className={`${layoutMetrics.titleFontSize} text-black block w-full text-center tracking-normal leading-normal`}
                      style={{ letterSpacing: 'normal', wordSpacing: 'normal' }}
                    >
                      بطاقة متابعة حضور وغيابات الطلبة للسداسي
                    </h1>
                  </div>
                </div>

                {/* Highly compact Subheaders details table with minimal cell heights and smaller, legible font settings */}
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
                        <span className="text-black font-extrabold mr-1.5 select-text">{activeModule?.name || '............................'}</span>
                      </td>
                      <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 border-l border-black text-right leading-tight">
                        <span className="text-slate-500 font-bold">الأستاذ المدرس:</span>
                        <span className="text-black font-extrabold mr-1.5 select-text">{activeTeacher?.displayName || '............................'}</span>
                      </td>
                      <td style={{ padding: layoutMetrics.subHeaderCellPadding }} className="w-1/3 text-right leading-tight">
                        <span className="text-slate-500 font-bold">السداسي المتابع:</span>
                        <span className="text-black font-extrabold mr-1.5 select-text">{formatSemesterArabic}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Main Students Table with dynamic selected months columns. We use a bulletproof pure-div flex layout with absolute pixel widths to avoid all html2canvas rowspan/colspan RTL rendering bugs. */}
                <div className={`w-full ${layoutMetrics.tableMargin} flex justify-center flex-1 overflow-hidden`}>
                  <div className="border-2 border-black flex flex-col bg-white overflow-hidden text-black" style={{ width: '730px' }}>
                    
                    {/* Header Row */}
                    <div className="flex bg-slate-100 border-b-2 border-black text-center font-extrabold" style={{ height: layoutMetrics.headerHeight, fontSize: layoutMetrics.fontSizeTable }}>
                      {/* رقم Column */}
                      <div 
                        className="flex items-center justify-center border-l-2 border-black font-extrabold p-1" 
                        style={{ width: '30px', height: '100%' }}
                      >
                        رقم
                      </div>
                      
                      {/* اللقب والاسم Column */}
                      <div 
                        className="flex items-center text-right pr-2 border-l-2 border-black font-extrabold p-1" 
                        style={{ width: '230px', height: '100%', direction: 'rtl' }}
                      >
                        اللقب والاسم
                      </div>
                      
                      {/* رقم التسجيل Column */}
                      <div 
                        className="flex items-center justify-center border-l-2 border-black font-extrabold p-1" 
                        style={{ width: '100px', height: '100%' }}
                      >
                        رقم التسجيل
                      </div>
                      
                      {/* Month Columns */}
                      {sortedSelectedMonths.map((month, idx) => {
                        const monthWidth = 370 / sortedSelectedMonths.length;
                        const weekWidth = monthWidth / 4;
                        const headerPx = parseInt(layoutMetrics.headerHeight);
                        const monthTitleH = `${(headerPx / 2).toFixed(1)}px`;
                        const weeksRowH = `${(headerPx - (headerPx / 2)).toFixed(1)}px`;

                        return (
                          <div 
                            key={idx} 
                            className={`flex flex-col h-full ${idx < sortedSelectedMonths.length - 1 ? 'border-l-2 border-black' : ''}`}
                            style={{ width: `${monthWidth}px` }}
                          >
                            {/* Month Title */}
                            <div 
                              className="flex items-center justify-center bg-slate-50 border-b border-black font-black" 
                              style={{ height: monthTitleH, fontSize: layoutMetrics.fontSizeTable }}
                            >
                              {month}
                            </div>
                            
                            {/* Weeks Row */}
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
                          <div 
                            key={rIdx} 
                            className="flex text-center font-medium hover:bg-slate-50/50 border-b border-black last:border-b-0"
                            style={{ height: layoutMetrics.rowHeight }}
                          >
                            {/* رقم Column */}
                            <div 
                              className="flex items-center justify-center border-l-2 border-black bg-slate-50 font-bold h-full overflow-hidden" 
                              style={{ width: '30px', fontSize: layoutMetrics.fontSizeReg }}
                            >
                              {rowNum}
                            </div>
                            
                            {/* اللقب والاسم Column */}
                            <div 
                              className="flex items-center text-right px-2 border-l-2 border-black font-bold h-full leading-tight py-1 select-text whitespace-nowrap overflow-hidden text-ellipsis" 
                              style={{ width: '230px', direction: 'rtl', fontSize: layoutMetrics.fontSizeName }}
                            >
                              {student ? student.name : ''}
                            </div>
                            
                            {/* رقم التسجيل Column */}
                            <div 
                              className="flex items-center justify-center border-l-2 border-black font-mono text-slate-800 leading-tight py-1 select-text h-full whitespace-nowrap overflow-hidden text-ellipsis" 
                              style={{ width: '100px', fontSize: layoutMetrics.fontSizeReg }}
                            >
                              {student ? (student.registrationNumber || '---') : ''}
                            </div>
                            
                            {/* Month Weeks Columns */}
                            {sortedSelectedMonths.map((_, mIdx) => {
                              const monthWidth = 370 / sortedSelectedMonths.length;
                              const weekWidth = monthWidth / 4;
                              return (
                                <div 
                                  key={mIdx} 
                                  className={`flex h-full bg-white ${mIdx < sortedSelectedMonths.length - 1 ? 'border-l-2 border-black' : ''}`}
                                  style={{ width: `${monthWidth}px` }}
                                >
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
                <div 
                  className={`${layoutMetrics.footerMarginTop} border-t-2 border-black ${layoutMetrics.footerPaddingTop} flex justify-between items-end text-xs leading-normal`}
                >
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
