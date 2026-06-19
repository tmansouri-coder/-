import React, { useRef, useState, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from '../lib/safeHtml2canvas';
import { X, Printer, Download, Eye, Layers, Loader2 } from 'lucide-react';
import { ExamSession, Specialty, Module, Level, Cycle, Room, User, Student, ScheduleSession } from '../types';
import toast from 'react-hot-toast';

interface BulkExamMinutesModalProps {
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
  examSessions: ExamSession[];
  selectedSemester: 'S1' | 'S2';
  selectedYear: string;
  selectedExamType: 'Regular' | 'Resit' | 'All';
}

interface PageItem {
  exam: ExamSession;
  roomName: string;
  invigilatorNames: string[];
  studentList: Student[];
  studentCount: number;
  formattedLevel: string;
  moduleManagerName: string;
  formattedExamDate: string;
  activeModule: Module | null;
  activeSpecialty: Specialty | null;
  pageKey: string;
}

export default function BulkExamMinutesModal({
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
  examSessions,
  selectedSemester,
  selectedYear,
  selectedExamType,
}: BulkExamMinutesModalProps) {
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const printContainerRef = useRef<HTMLDivElement>(null);

  // Helper resolvers
  const resolveModule = (id: string) => modules.find(m => m.id === id);
  const resolveSpecialty = (id: string) => specialties.find(s => s.id === id);
  const resolveRoom = (id: string) => rooms.find(r => r.id === id);
  const resolveTeacher = (id: string) => teachers.find(t => t.uid === id);
  const resolveLevel = (id: string) => levels.find(l => l.id === id);
  const resolveCycle = (id: string) => cycles.find(c => c.id === id);

  const activeSpecialtyGlobal = useMemo(() => resolveSpecialty(specialtyId), [specialtyId, specialties]);

  // Filter exam sessions of this specialty
  const activeExams = useMemo(() => {
    return examSessions.filter(s => 
      s.specialtyId === specialtyId && 
      s.semester === selectedSemester && 
      (selectedExamType === 'All' || s.type === selectedExamType) &&
      s.academicYear === selectedYear
    );
  }, [specialtyId, examSessions, selectedSemester, selectedExamType, selectedYear]);

  // Generate all pages (Exam <-> Room combinations)
  const examPages = useMemo(() => {
    const list: PageItem[] = [];

    activeExams.forEach(exam => {
      const activeModule = resolveModule(exam.moduleId) || null;
      const activeSpecialty = resolveSpecialty(exam.specialtyId) || null;
      const activeLevel = activeSpecialty ? resolveLevel(activeSpecialty.levelId) : null;
      const activeCycle = activeLevel ? resolveCycle(activeLevel.cycleId) : null;

      // Format level text
      let formattedLevel = '............................';
      if (activeLevel) {
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
        formattedLevel = `${ArabicLevel} ${cycleArabic}`;
      }

      // Resolve Module Manager
      let moduleManagerName = '............................';
      if (activeModule?.teacherId) {
        const t = resolveTeacher(activeModule.teacherId);
        if (t) moduleManagerName = t.displayName;
      } else {
        const semesterSession = scheduleSessions.find(s => 
          s.moduleId === exam.moduleId && 
          s.specialtyId === exam.specialtyId && 
          s.academicYear === selectedYear &&
          s.semester === selectedSemester
        );
        if (semesterSession?.teacherId) {
          const t = resolveTeacher(semesterSession.teacherId);
          if (t) moduleManagerName = t.displayName;
        }
      }

      // Format Exam Date
      let formattedExamDate = '............................';
      if (exam.date) {
        try {
          const dateObj = new Date(exam.date);
          const dayName = dateObj.toLocaleDateString('ar-DZ', { weekday: 'long' });
          const formattedDate = exam.date.split('-').reverse().join('/');
          formattedExamDate = `${dayName}  ${formattedDate}`;
        } catch (e) {
          formattedExamDate = exam.date;
        }
      }

      // Get students for this specialty & year
      const filteredStudents = students
        .filter(s => 
          s.specialtyId === exam.specialtyId && 
          (s.academicYear === selectedYear || s.academicYear?.replace('-', '/') === selectedYear.replace('-', '/'))
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

      if (exam.mode === 'Simple') {
        const roomIds = exam.roomIds || [];
        const invigilators = exam.invigilators || [];

        if (roomIds.length === 0) {
          list.push({
            exam,
            roomName: '............................',
            invigilatorNames: invigilators.map(id => resolveTeacher(id)?.displayName || id),
            studentList: filteredStudents,
            studentCount: filteredStudents.length,
            formattedLevel,
            moduleManagerName,
            formattedExamDate,
            activeModule,
            activeSpecialty,
            pageKey: `${exam.id}-no-room`,
          });
        } else {
          const studentsPerRoom = Math.ceil(filteredStudents.length / roomIds.length);
          const invigsPerRoom = Math.ceil(invigilators.length / roomIds.length);

          roomIds.forEach((roomId, idx) => {
            const room = resolveRoom(roomId);
            const roomName = room?.name || 'قاعة غير معروفة';
            
            const startIdx = idx * studentsPerRoom;
            const endIdx = Math.min(startIdx + studentsPerRoom, filteredStudents.length);
            const roomStudents = filteredStudents.slice(startIdx, endIdx);

            const istart = idx * invigsPerRoom;
            const iend = Math.min(istart + invigsPerRoom, invigilators.length);
            const roomInvigs = invigilators.slice(istart, iend).map(id => resolveTeacher(id)?.displayName || id);

            list.push({
              exam,
              roomName,
              invigilatorNames: roomInvigs,
              studentList: roomStudents,
              studentCount: roomStudents.length,
              formattedLevel,
              moduleManagerName,
              formattedExamDate,
              activeModule,
              activeSpecialty,
              pageKey: `${exam.id}-${roomId}-${idx}`,
            });
          });
        }
      } else {
        // Detailed Mode
        const assignments = exam.roomAssignments || [];
        if (assignments.length === 0) {
          list.push({
            exam,
            roomName: '............................',
            invigilatorNames: [],
            studentList: filteredStudents,
            studentCount: filteredStudents.length,
            formattedLevel,
            moduleManagerName,
            formattedExamDate,
            activeModule,
            activeSpecialty,
            pageKey: `${exam.id}-no-assignment`,
          });
        } else {
          const studentsPerRoom = Math.ceil(filteredStudents.length / assignments.length);

          assignments.forEach((ra, idx) => {
            const room = resolveRoom(ra.roomId);
            const roomName = room ? `${room.name}${ra.groups && ra.groups.length > 0 ? ` (${ra.groups.join(', ')})` : ''}` : 'قاعة غير معروفة';
            const roomInvigs = (ra.invigilators || []).map(id => resolveTeacher(id)?.displayName || id);

            const startIdx = idx * studentsPerRoom;
            const endIdx = Math.min(startIdx + studentsPerRoom, filteredStudents.length);
            const roomStudents = filteredStudents.slice(startIdx, endIdx);

            list.push({
              exam,
              roomName,
              invigilatorNames: roomInvigs,
              studentList: roomStudents,
              studentCount: ra.studentCount || roomStudents.length,
              formattedLevel,
              moduleManagerName,
              formattedExamDate,
              activeModule,
              activeSpecialty,
              pageKey: `${exam.id}-${ra.roomId}-${idx}`,
            });
          });
        }
      }
    });

    return list;
  }, [activeExams, students, teachers, rooms, selectedYear, selectedSemester, scheduleSessions]);

  // Render helper to prevent markup duplication and word wrap
  const renderExamPageContent = (page: typeof examPages[0]) => {
    const tableRowsCount = Math.max(25, page.studentList.length);
    return (
      <>
        {/* Top Heading */}
        <div className="flex justify-between items-start text-xs font-bold text-slate-900 leading-relaxed border-b border-black pb-3 w-full">
          <div className="text-right">
            <p className="text-sm font-extrabold text-black">جامعة عمار ثليجي الأغواط</p>
            <p className="font-semibold text-slate-800">كلية التكنولوجيا</p>
            <p className="font-semibold text-slate-800">قسم : الهندسة الميكانيكية</p>
          </div>
          <div className="text-left font-mono text-slate-900 mt-1">
            <p className="text-sm font-extrabold text-black">السنة الجامعية: {selectedYear}</p>
            <p className="text-xs font-semibold text-slate-700">الدورة: {page.exam.type === 'Regular' ? 'الدورة العادية' : 'الدورة الاستدراكية'}</p>
          </div>
        </div>

        {/* Centered Document Box Title */}
        <div className="my-5 flex justify-center w-full">
          <div className="px-14 py-2.5 border-2 border-black bg-slate-50 text-center rounded-2xl whitespace-nowrap">
            <span className="text-2xl font-black text-black leading-none block text-center select-none" style={{ fontFamily: '"Almarai", "Inter", sans-serif' }}>محضر الامتحان</span>
          </div>
        </div>

        {/* Subheaders details grid */}
        <div className="grid grid-cols-2 gap-y-2 text-xs font-bold text-black border-2 border-black p-4 rounded-2xl bg-white mb-5 leading-normal w-full">
          <div>
            <span className="text-slate-600">السنة:</span> 
            <span className="text-black font-extrabold mr-2 select-text">{page.formattedLevel}</span>
          </div>
          <div>
            <span className="text-slate-600">مسؤول المقياس:</span> 
            <span className="text-black font-extrabold mr-2 select-text">{page.moduleManagerName}</span>
          </div>
          <div>
            <span className="text-slate-600">التخصص:</span> 
            <span className="text-black font-extrabold mr-2 select-text">{page.activeSpecialty?.name || '............................'}</span>
          </div>
          <div>
            <span className="text-slate-600">تاريخ الامتحان:</span> 
            <span className="text-black font-extrabold mr-2 select-text">{page.formattedExamDate}</span>
          </div>
          <div className="col-span-2">
            <span className="text-slate-600">المقياس:</span> 
            <span className="text-black font-extrabold lg:text-sm mr-2 select-text">{page.activeModule?.name || '............................'}</span>
          </div>
        </div>

        {/* Main Students Table */}
        <div className="flex-1 overflow-hidden w-full">
          <table className="w-full border-collapse border-2 border-black text-xs">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-black text-center font-extrabold">
                <th className="border-l-2 border-black p-1 w-10">رقم</th>
                <th className="border-l-2 border-black p-1">اللقب والاسم</th>
                <th className="border-l-2 border-black p-1 w-32">رقم التسجيل</th>
                <th className="border-l-2 border-black p-1 w-16 text-[10px]">امتحان</th>
                <th className="border-l-2 border-black p-1 w-12 text-[10px]">TD</th>
                <th className="border-l-2 border-black p-1 w-12 text-[10px]">TP</th>
                <th className="p-1 w-36 text-[10px]">توقيع الطالب</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: tableRowsCount }).map((_, rIdx) => {
                const student = page.studentList[rIdx];
                const rowNum = rIdx + 1;
                
                return (
                  <tr 
                    key={rIdx} 
                    className="border-b border-black text-center h-7 font-medium"
                    style={{ height: '28px' }}
                  >
                    <td className="border-l-2 border-black bg-slate-50 font-bold">{rowNum}</td>
                    <td className="border-l-2 border-black text-right px-2 font-semibold select-text truncate max-w-[220px]">
                      {student ? student.name : ''}
                    </td>
                    <td className="border-l-2 border-black text-center select-text font-mono truncate max-w-[120px]">
                      {student ? (student.registrationNumber || '---') : ''}
                    </td>
                    <td className="border-l-2 border-black bg-slate-50/50"></td>
                    <td className="border-l-2 border-black"></td>
                    <td className="border-l-2 border-black"></td>
                    <td className="bg-slate-50/30"></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom info signature area */}
        <div className="mt-6 border-t-2 border-black pt-4 grid grid-cols-12 gap-2 text-xs leading-normal w-full">
          {/* Invigilators block */}
          <div className="col-span-7 flex flex-col gap-1.5">
            <span className="font-extrabold text-black">المراقبون الحاضرون:</span>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 pl-4 pt-1">
              <p className="font-semibold text-slate-800">
                1. <span className="text-black select-text">{page.invigilatorNames[0] || '...........................................'}</span>
              </p>
              <p className="font-semibold text-slate-800">
                2. <span className="text-black select-text">{page.invigilatorNames[1] || '...........................................'}</span>
              </p>
              <p className="font-semibold text-slate-800">
                3. <span className="text-black select-text">{page.invigilatorNames[2] || '...........................................'}</span>
              </p>
              <p className="font-semibold text-slate-800">
                4. <span className="text-black select-text">{page.invigilatorNames[3] || '...........................................'}</span>
              </p>
            </div>
          </div>

          {/* Room and Student Statistics */}
          <div className="col-span-5 flex flex-col justify-between border-r border-black pr-4">
            <div className="space-y-1.5">
              <p className="font-extrabold text-black">
                القاعة: <span className="text-black bg-yellow-100 border border-yellow-200 px-2 py-0.5 rounded mr-1 select-text">{page.roomName}</span>
              </p>
              <p className="font-bold text-slate-800">
                عدد المسجلين: <span className="font-mono text-black mr-1 font-extrabold">{page.studentCount}</span>
              </p>
              <p className="font-bold text-slate-800">
                عدد الغائبين: ........................
              </p>
            </div>
            
            <div className="text-left font-extrabold text-black pt-3 pl-2">
              <span>توقيع الأستاذ المسؤول:</span>
            </div>
          </div>
        </div>
      </>
    );
  };

  // Export selected page or all combined as PDF
  const handleExportPDF = async (exportAll: boolean) => {
    setIsExporting(true);
    setExportProgress(0);
    const toastId = toast.loading(exportAll ? 'جاري دمج جميع محاضر الامتحانات وتحضير ملف PDF...' : 'جاري تحضير محضر الامتحان...');

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const targetIndices = exportAll ? examPages.map((_, i) => i) : [selectedPageIndex];

      for (let i = 0; i < targetIndices.length; i++) {
        const pageIdx = targetIndices[i];
        setExportProgress(i + 1);
        
        // Grab from the off-screen printing container which keeps a clean, layout-active state
        const pageElement = document.getElementById(`print-exam-minutes-page-${pageIdx}`);
        if (!pageElement) {
          console.warn(`Print element print-exam-minutes-page-${pageIdx} not found in DOM`);
          continue;
        }

        const canvas = await html2canvas(pageElement, {
          scale: 2.5, // Perfect resolution balance
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: 794,
          height: 1123,
          windowWidth: 794,
          windowHeight: 1123,
        });

        const imgData = canvas.toDataURL('image/png');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
        const imgWidth = canvas.width * ratio;
        const imgHeight = canvas.height * ratio;

        const x = (pdfWidth - imgWidth) / 2;
        const y = 0;

        if (i > 0) {
          pdf.addPage('a4', 'p');
        }

        pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
      }

      const activeSpecialtyName = activeSpecialtyGlobal?.name.replace(/\s+/g, '_') || 'Specialty';
      pdf.save(`Bulk_Exam_Minutes_${activeSpecialtyName}_${selectedYear.replace('/', '-')}.pdf`);
      toast.success(exportAll ? 'تم دمج وتحميل جميع محاضر السداسي بنجاح!' : 'تم تحميل محضر الامتحان بنجاح', { id: toastId });
    } catch (e) {
      console.error(e);
      toast.error('فشل تصدير ملف PDF المدمج', { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-hidden" id="bulk-exam-minutes-modal">
      <div className="bg-slate-50 w-full max-w-5xl rounded-3xl border-2 border-black shadow-2xl flex flex-col h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b-2 border-black">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 text-yellow-700 rounded-xl border border-yellow-200">
              <Printer className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 font-sans tracking-tight">طباعة محاضر الامتحانات المجمعة للتخصص</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{activeSpecialtyGlobal?.name || 'التخصص المحدد'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 hover:border-slate-300"
            id="close-bulk-minutes-modal-btn"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Toolbar Controls */}
        <div className="p-4 bg-white border-b-2 border-black flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-700 flex items-center gap-1">
              <Layers className="w-4 h-4 text-yellow-600" /> معاينة الورقة:
            </span>
            <select
              value={selectedPageIndex}
              onChange={(e) => setSelectedPageIndex(Number(e.target.value))}
              className="bg-slate-100 border-2 border-black rounded-xl px-3 py-1.5 text-sm font-bold shadow-sm focus:ring-2 focus:ring-yellow-400"
              id="bulk-room-select-dropdown"
              disabled={examPages.length === 0}
            >
              {examPages.map((page, idx) => (
                <option key={idx} value={idx}>
                  {page.activeModule?.name || 'مقياس'} - {page.roomName} ({page.studentCount} طالب)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportPDF(false)}
              disabled={isExporting || examPages.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-black rounded-xl hover:bg-slate-50 text-slate-900 font-bold text-sm shadow-sm transition-all hover:-translate-y-0.5 active:translate-y-0"
              id="print-single-bulk-page-btn"
            >
              <Download className="w-4 h-4" />
              <span>تحميل الورقة المحددة</span>
            </button>
            {examPages.length > 1 && (
              <button
                onClick={() => handleExportPDF(true)}
                disabled={isExporting}
                className="flex items-center gap-2 px-5 py-2.5 bg-yellow-400 border-2 border-black rounded-xl hover:bg-yellow-500 text-black font-extrabold text-sm shadow-sm transition-all hover:-translate-y-0.5 active:translate-y-0"
                id="print-all-bulk-pages-btn"
              >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                <span>
                  {isExporting 
                    ? `جاري دمج الملفات (${exportProgress}/${examPages.length})` 
                    : `تحميل كافة الامتحانات للمسار (${examPages.length} محاضر)`
                  }
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Scrollable Canvas Preview Area */}
        <div className="flex-1 overflow-y-auto p-8 flex justify-center bg-slate-200">
          <div ref={printContainerRef} className="flex flex-col gap-8 select-none">
            {examPages.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-2xl border-2 border-black max-w-md mx-auto my-12" dir="rtl">
                <p className="text-slate-500 font-bold">لا توجد امتحانات مضافة لهذا التخصص في السداسي والدورة المحددة.</p>
              </div>
            ) : (
              examPages.map((page, pageIdx) => {
                const isSelected = pageIdx === selectedPageIndex;

                return (
                  <div
                    key={page.pageKey}
                    id={`bulk-exam-minutes-page-${pageIdx}`}
                    className={`${isSelected ? 'flex' : 'hidden'} text-black flex-col p-10 bg-white w-[210mm] min-h-[297mm] shadow-lg border-2 border-black font-sans relative`}
                    dir="rtl"
                    style={{ boxSizing: 'border-box', fontFamily: '"Almarai", "Inter", sans-serif' }}
                  >
                    {renderExamPageContent(page)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Off-screen Printing Container (always 100% visible to layout engine for html2canvas snapshots) */}
      <div 
        className="absolute left-[-9999px] top-0 pointer-events-none select-none flex flex-col gap-10 bg-white" 
        style={{ width: '794px' }}
      >
        {examPages.map((page, pageIdx) => (
          <div
            key={`print-exam-page-${page.pageKey}`}
            id={`print-exam-minutes-page-${pageIdx}`}
            className="text-black flex flex-col p-10 bg-white w-[794px] h-[1123px] border-2 border-black font-sans relative"
            dir="rtl"
            style={{ boxSizing: 'border-box', fontFamily: '"Almarai", "Inter", sans-serif' }}
          >
            {renderExamPageContent(page)}
          </div>
        ))}
      </div>
    </div>
  );
}
