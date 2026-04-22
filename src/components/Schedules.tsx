import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, setDoc, getDoc, writeBatch, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAcademicYear } from '../contexts/AcademicYearContext';
import { 
  Cycle, Level, Specialty, Module, Room, User, 
  ScheduleSession, ExamSession, SessionType, RoomAssignment 
} from '../types';
import { 
  Calendar, Clock, MapPin, User as UserIcon, 
  Plus, Trash2, Edit2, Download, Filter,
  ChevronRight, ChevronLeft, Search, ClipboardList,
  AlertTriangle, Mail, Copy, X, ShieldAlert, ShieldCheck,
  RefreshCw, FileText
} from 'lucide-react';
import { cn, mapLevelName } from '../lib/utils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import 'jspdf-autotable';
import html2canvas from 'html2canvas';
import toast from 'react-hot-toast';
import PDFScheduleImporter from './PDFScheduleImporter';

type ScheduleTab = 'semester' | 'exams' | 'halls' | 'personal';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const PERIODS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
const PERIOD_TIMES = {
  H1: '08:10 - 09:35',
  H2: '09:40 - 11:05',
  H3: '11:10 - 12:35',
  H4: '12:35 - 14:00',
  H5: '14:10 - 15:35',
  H6: '15:40 - 17:05',
};

const DAY_LABELS: Record<string, string> = {
  Sunday: 'الأحد',
  Monday: 'الاثنين',
  Tuesday: 'الثلاثاء',
  Wednesday: 'الأربعاء',
  Thursday: 'الخميس',
};

const EXAM_TIMES = [
  '08:15 - 09:45',
  '10:00 - 11:30',
  '08:10 - 09:40',
  '11:30 - 13:00',
  '09:50 - 11:20'
];

import { useTranslation } from 'react-i18next';

export default function Schedules() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { user, isAdmin, isViceAdmin, isSpecialtyManager, isTeacher } = useAuth();
  const { selectedYear } = useAcademicYear();
  const [activeTab, setActiveTab] = useState<ScheduleTab>('semester');
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [showImporter, setShowImporter] = useState(false);

  // Data
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [scheduleSessions, setScheduleSessions] = useState<ScheduleSession[]>([]);
  const [examSessions, setExamSessions] = useState<ExamSession[]>([]);

  // Filters
  const [selectedCycle, setSelectedCycle] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('');
  const [selectedSemester, setSelectedSemester] = useState<'S1' | 'S2'>('S1');
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [selectedExamType, setSelectedExamType] = useState<'Regular' | 'Resit' | 'All'>('All');
  const [examStartDate, setExamStartDate] = useState<string>('');
  const [examEndDate, setExamEndDate] = useState<string>('');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(user?.uid || '');

  useEffect(() => {
    if (user && !selectedTeacherId) {
      setSelectedTeacherId(user.uid);
    }
  }, [user]);

  // Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSession, setEditingSession] = useState<ScheduleSession | null>(null);
  const [editingExam, setEditingExam] = useState<ExamSession | null>(null);
  const [examMode, setExamMode] = useState<'Simple' | 'Detailed'>('Simple');
  const [roomAssignments, setRoomAssignments] = useState<RoomAssignment[]>([{ roomId: '', invigilators: [], groups: [], studentCount: 0 }]);
  const [formExamType, setFormExamType] = useState<'Regular' | 'Resit'>('Regular');
  const [examDate, setExamDate] = useState('');
  const [examTime, setExamTime] = useState('');
  const [formDay, setFormDay] = useState<string>('Sunday');
  const [formPeriod, setFormPeriod] = useState<string>('H1');
  const [formTeacherId, setFormTeacherId] = useState<string>('');
  const [isST, setIsST] = useState(false);
  const [isExternal, setIsExternal] = useState(false);
  const [isReserved, setIsReserved] = useState(false);

  useEffect(() => {
    if (editingSession) {
      setIsExternal(editingSession.isExternal || false);
      setIsReserved(editingSession.isReserved || false);
      const mod = modules.find(m => m.id === editingSession.moduleId);
      setIsST(mod?.isST || false);
    } else {
      setIsST(false);
      setIsExternal(false);
      setIsReserved(false);
    }
  }, [editingSession, showAddModal, modules]);
  const [examSpecialty, setExamSpecialty] = useState('');
  const [examLevel, setExamLevel] = useState('');
  const [examModule, setExamModule] = useState('');
  const [examRooms, setExamRooms] = useState<string[]>([]);
  const [examInvigilators, setExamInvigilators] = useState<string[]>([]);
  const [applyTimeToLevel, setApplyTimeToLevel] = useState(false);
  const [levelExtraExamDates, setLevelExtraExamDates] = useState<Record<string, string[]>>({});
  const [promptConfig, setPromptConfig] = useState<{
    show: boolean;
    title: string;
    defaultValue: string;
    type: 'text' | 'date' | 'select';
    options?: string[];
    showApplyAll?: boolean;
    onConfirm: (value: string, applyAll?: boolean) => void;
  }>({
    show: false,
    title: '',
    defaultValue: '',
    type: 'text',
    onConfirm: () => {},
  });
  const [promptValue, setPromptValue] = useState('');
  const [appLogo, setAppLogo] = useState<string | null>(localStorage.getItem('appLogo'));
  const [sessionToDelete, setSessionToDelete] = useState<{ id: string, type: 'schedule' | 'exam' } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    show: boolean;
    title: string;
    message: string;
    type: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
  }>({
    show: false,
    title: '',
    message: '',
    type: 'info',
    onConfirm: () => {},
  });
  const invigilationRef = React.useRef<HTMLDivElement>(null);
  const weeklyScheduleRef = React.useRef<HTMLDivElement>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setAppLogo(base64);
        localStorage.setItem('appLogo', base64);
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    let unsubscribers: (() => void)[] = [];

    const setupListeners = () => {
      setLoading(true);
      try {
        const alternateYear = selectedYear.includes('/') ? selectedYear.replace('/', '-') : selectedYear.replace('-', '/');
        const yearQueries = [selectedYear];
        if (alternateYear !== selectedYear) yearQueries.push(alternateYear);

        // Core Entities (Real-time)
        unsubscribers.push(onSnapshot(collection(db, 'cycles'), (snap) => {
          setCycles(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cycle)));
        }));

        unsubscribers.push(onSnapshot(collection(db, 'levels'), (snap) => {
          const levelDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Level));
          setLevels(levelDocs.map(l => ({ ...l, name: mapLevelName(l.name) })));
        }));

        unsubscribers.push(onSnapshot(collection(db, 'specialties'), (snap) => {
          setSpecialties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty)).sort((a, b) => a.name.localeCompare(b.name)));
        }));

        unsubscribers.push(onSnapshot(collection(db, 'modules'), (snap) => {
          setModules(snap.docs.map(d => ({ id: d.id, ...d.data() } as Module)));
        }));

        unsubscribers.push(onSnapshot(collection(db, 'rooms'), (snap) => {
          setRooms(snap.docs.map(d => ({ id: d.id, ...d.data() } as Room)));
        }));

        unsubscribers.push(onSnapshot(query(collection(db, 'users'), where('role', 'in', ['admin', 'vice_admin', 'teacher', 'specialty_manager'])), (snap) => {
          const uniqueTeachers = Array.from(new Map(snap.docs.map(d => {
            const data = d.data();
            const teacher = { 
              uid: d.id, 
              ...data,
              displayName: data.displayName || data.name || t('no_teacher')
            } as User;
            return [teacher.uid, teacher];
          })).values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
          setTeachers(uniqueTeachers);
        }));

        unsubscribers.push(onSnapshot(doc(db, 'settings', 'examDates'), (snap) => {
          if (snap.exists()) {
            setLevelExtraExamDates(snap.data().levelExtraExamDates || {});
          }
        }));

        // Real-time synchronization for sessions
        const schedQuery = query(collection(db, 'scheduleSessions'), where('academicYear', 'in', yearQueries));
        unsubscribers.push(onSnapshot(schedQuery, (snap) => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data(), academicYear: selectedYear } as ScheduleSession));
          setScheduleSessions(docs);
        }));

        const examQuery = query(collection(db, 'examSessions'), where('academicYear', 'in', yearQueries));
        unsubscribers.push(onSnapshot(examQuery, (snap) => {
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data(), academicYear: selectedYear } as ExamSession));
          setExamSessions(docs);
        }));

        setLoading(false);
      } catch (err) {
        console.error('Fetch error:', err);
        setLoading(false);
      }
    };

    setupListeners();
    return () => unsubscribers.forEach(unsub => unsub());
  }, [selectedYear]);

  // Auto-healer for legacy name-based teacher IDs
  useEffect(() => {
    if ((isAdmin || isViceAdmin) && !loading && teachers.length > 0) {
      const healData = async () => {
        let healedCount = 0;
        const batch = writeBatch(db);
        
        // Fix scheduleSessions
        scheduleSessions.forEach(s => {
          if (s.teacherId && !teachers.some(t => t.uid === s.teacherId)) {
            const matched = teachers.find(t => t.displayName.toLowerCase().trim() === s.teacherId.toLowerCase().trim());
            if (matched) {
              batch.update(doc(db, 'scheduleSessions', s.id), { teacherId: matched.uid });
              healedCount++;
            }
          }
        });

        // Fix examSessions
        examSessions.forEach(s => {
          let updated = false;
          const newInvigs = s.invigilators?.map(id => {
            if (id && !teachers.some(t => t.uid === id)) {
              const matched = teachers.find(t => t.displayName.toLowerCase().trim() === id.toLowerCase().trim());
              if (matched) {
                updated = true;
                return matched.uid;
              }
            }
            return id;
          });

          if (updated) {
            batch.update(doc(db, 'examSessions', s.id), { invigilators: newInvigs });
            healedCount++;
          }
          
          // Fix roomAssignments
          let raUpdated = false;
          const newRA = s.roomAssignments?.map(ra => {
            let invigsUpdated = false;
            const newRaInvigs = ra.invigilators?.map(id => {
              if (id && !teachers.some(t => t.uid === id)) {
                const matched = teachers.find(t => t.displayName.toLowerCase().trim() === id.toLowerCase().trim());
                if (matched) {
                  invigsUpdated = true;
                  return matched.uid;
                }
              }
              return id;
            });
            if (invigsUpdated) {
              raUpdated = true;
              return { ...ra, invigilators: newRaInvigs };
            }
            return ra;
          });

          if (raUpdated) {
            batch.update(doc(db, 'examSessions', s.id), { roomAssignments: newRA });
            healedCount++;
          }
        });

        if (healedCount > 0) {
          try {
            await batch.commit();
            console.log(`Auto-healed ${healedCount} teacher bonds.`);
          } catch (err) {
            console.error('Auto-heal failed:', err);
          }
        }
      };
      
      const timeoutId = setTimeout(healData, 5000); // Wait 5s for everything to stabilize
      return () => clearTimeout(timeoutId);
    }
  }, [isAdmin, isViceAdmin, loading, teachers.length]);

  const resolveTeacher = (id: string | undefined | null) => {
    if (!id) return null;
    const cleanId = id.toLowerCase().trim();
    return teachers.find(t => 
      t.uid === id || 
      t.email?.toLowerCase().trim() === cleanId || 
      t.username?.toLowerCase().trim() === cleanId || 
      t.displayName?.toLowerCase().trim() === cleanId
    );
  };

  const formatTeacherName = (displayName: string | undefined | null) => {
    if (!displayName) return t('no_teacher');
    const names = displayName.trim().split(/\s+/).filter(Boolean);
    if (names.length === 0) return t('no_teacher');
    if (names.length === 1) return names[0].toUpperCase();
    
    const initial = names[0].charAt(0).toUpperCase();
    const lastName = names[names.length - 1].toUpperCase();
    return `${initial}.${lastName}`;
  };

  const getTeacherExamCount = (teacherId: string) => {
    return examSessions.filter(s => {
      if (s.academicYear !== selectedYear) return false;
      if (s.semester !== selectedSemester) return false;
      if (s.mode === 'Simple') return s.invigilators?.includes(teacherId);
      return s.roomAssignments?.some(ra => ra.invigilators.includes(teacherId));
    }).length;
  };

  const getTeacherDayExamCount = (teacherId: string, date: string) => {
    if (!date) return 0;
    return examSessions.filter(s => {
      if (s.academicYear !== selectedYear) return false;
      if (s.date !== date) return false;
      if (s.mode === 'Simple') return s.invigilators?.includes(teacherId);
      return s.roomAssignments?.some(ra => ra.invigilators.includes(teacherId));
    }).length;
  };

  const getConflict = (exam: Partial<ExamSession>) => {
    if (!exam.date || !exam.time) return null;
    
    const examSpec = specialties.find(s => s.id === exam.specialtyId);
    for (const other of examSessions) {
      if (other.id === exam.id) continue;
      if (other.date !== exam.date || other.time !== exam.time) continue;
      
      // Specialty/Level conflict
      const otherSpec = specialties.find(s => s.id === other.specialtyId);
      if (other.specialtyId === exam.specialtyId && otherSpec?.levelId === examSpec?.levelId) {
        return { type: 'تخصص', name: otherSpec?.name || '' };
      }

      // Room conflict (only if same semester)
      if (other.semester === exam.semester && other.moduleId !== exam.moduleId) {
        const rooms1 = exam.mode === 'Simple' ? (exam.roomIds || []) : exam.roomAssignments?.map(ra => ra.roomId) || [];
        const rooms2 = other.mode === 'Simple' ? (other.roomIds || []) : other.roomAssignments?.map(ra => ra.roomId) || [];
        const conflictingRoomId = rooms1.find(r => r && rooms2.includes(r));
        if (conflictingRoomId) {
          const room = rooms.find(r => r.id === conflictingRoomId);
          return { type: 'قاعة', name: room?.name || '' };
        }
      }

      // Teacher conflict
      const invigs1 = exam.mode === 'Simple' ? exam.invigilators : exam.roomAssignments?.flatMap(ra => ra.invigilators) || [];
      const invigs2 = other.mode === 'Simple' ? other.invigilators : other.roomAssignments?.flatMap(ra => ra.invigilators) || [];
      const conflictingTeacherId = invigs1?.find(id => invigs2?.includes(id));
      if (conflictingTeacherId) {
        const teacher = resolveTeacher(conflictingTeacherId);
        return { type: 'أستاذ', name: teacher?.displayName || '', isSameTime: true };
      }
    }

    // Daily Load Warning (different time, same day)
    const currentInvigs = exam.mode === 'Simple' ? exam.invigilators : exam.roomAssignments?.flatMap(ra => ra.invigilators) || [];
    if (exam.date) {
      for (const id of (currentInvigs || [])) {
        const otherSessionsSameDay = examSessions.filter(s => s.id !== exam.id && s.date === exam.date && s.time !== exam.time);
        const existsInOther = otherSessionsSameDay.some(s => 
          s.mode === 'Simple' 
            ? s.invigilators?.includes(id) 
            : s.roomAssignments?.some(ra => ra.invigilators.includes(id))
        );
        
        if (existsInOther) {
          const teacher = resolveTeacher(id);
          return { type: 'حراسة مكررة', name: teacher?.displayName || '', isSameTime: false };
        }
      }
    }

    return null;
  };

  const handleUpdateTimeForSpecialty = async (specId: string, newTime: string, scope: 'specialty' | 'level' | 'all' = 'specialty', currentSessions?: ExamSession[]) => {
    if (!isAdmin && !isViceAdmin) return;
    
    const targetSpec = specialties.find(s => s.id === specId);
    const targetLevelId = targetSpec?.levelId;
    const sessionsToUse = currentSessions || examSessions;

    const examsToUpdate = sessionsToUse.filter(s => {
      if (s.semester !== selectedSemester || s.academicYear !== selectedYear) return false;
      if (scope === 'all') return true;
      if (scope === 'level') {
        const sSpec = specialties.find(spec => spec.id === s.specialtyId);
        return sSpec?.levelId === targetLevelId;
      }
      return s.specialtyId === specId;
    });
    
    try {
      if (examsToUpdate.length > 0) {
        const batch = examsToUpdate.map(async (exam) => {
          const examRef = doc(db, 'examSessions', exam.id);
          await updateDoc(examRef, { time: newTime });
        });
        await Promise.all(batch);
        
        setExamSessions(prev => prev.map(s => {
          const isMatch = (scope === 'all') || 
                         (scope === 'level' && specialties.find(spec => spec.id === s.specialtyId)?.levelId === targetLevelId) ||
                         (s.specialtyId === specId);
          
          return (isMatch && s.semester === selectedSemester && s.academicYear === selectedYear) 
            ? { ...s, time: newTime } 
            : s;
        }));
        
        let successMsg = 'تم تحديث التوقيت بنجاح';
        if (scope === 'level') successMsg = 'تم تحديث التوقيت لجميع تخصصات هذا المستوى';
        if (scope === 'all') successMsg = 'تم تحديث التوقيت لجميع التخصصات';
        
        toast.success(successMsg);
      } else {
        toast.error('لا توجد امتحانات مضافة حالياً لتحديث توقيتها.');
      }
    } catch (err) {
      toast.error('فشل تحديث التوقيت');
    }
  };

  const filteredLevels = useMemo(() => 
    levels.filter(l => l.cycleId === selectedCycle),
    [levels, selectedCycle]
  );
  
  const correctedSpecialties = useMemo(() => {
    return specialties.map(spec => {
      if (!levels.some(l => l.id === spec.levelId)) {
        const foundLevel = levels.find(l => l.name === spec.levelId || (spec.levelId === 'L1' && l.name.includes("First Year")));
        if (foundLevel) return { ...spec, levelId: foundLevel.id };
      }
      return spec;
    });
  }, [specialties, levels]);

  const filteredSpecialties = useMemo(() => 
    correctedSpecialties.filter(s => s.levelId === selectedLevel),
    [correctedSpecialties, selectedLevel]
  );

  const semesterSessionsMap = useMemo(() => {
    const map = new Map<string, ScheduleSession>();
    if (activeTab === 'semester' && selectedSpecialty) {
      scheduleSessions.forEach(s => {
        if (s.specialtyId === selectedSpecialty && s.semester === selectedSemester) {
          map.set(`${s.day}-${s.period}`, s);
        }
      });
    }
    return map;
  }, [scheduleSessions, selectedSpecialty, selectedSemester, activeTab]);

  const examSessionsMap = useMemo(() => {
    const map = new Map<string, ExamSession[]>();
    if (activeTab === 'exams') {
      examSessions.forEach(s => {
        if (s.semester === selectedSemester && (selectedExamType === 'All' || s.type === selectedExamType)) {
          const key = `${s.date}-${s.specialtyId}`;
          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push(s);
        }
      });
    }
    return map;
  }, [examSessions, selectedSemester, selectedExamType, activeTab]);

  const filteredModules = useMemo(() => 
    modules.filter(m => m.specialtyId === selectedSpecialty && m.semester === selectedSemester),
    [modules, selectedSpecialty, selectedSemester]
  );

  const getExamSessionsAt = (date: string, specialtyId: string) => {
    return examSessionsMap.get(`${date}-${specialtyId}`)?.[0];
  };

  const getHallSessionsAt = (day: string, period: string, roomId: string) => {
    return scheduleSessions.find(s => s.day === day && s.period === period && s.roomId === roomId && s.semester === selectedSemester);
  };

  const getPersonalSessionsAt = (day: string, period: string) => {
    return scheduleSessions.filter(s => s.day === day && s.period === period && s.teacherId === selectedTeacherId && s.semester === selectedSemester);
  };

  const getSessionAt = (day: string, period: string) => {
    return semesterSessionsMap.get(`${day}-${period}`);
  };

  const currentLevelExamDates = useMemo(() => {
    if (activeTab !== 'exams' || !selectedLevel) return [];
    
    const specsIds = filteredSpecialties.map(s => s.id);
    const existingDates = Array.from(new Set(examSessions.filter(s => 
      s.semester === selectedSemester && 
      (selectedExamType === 'All' || s.type === selectedExamType) &&
      specsIds.includes(s.specialtyId)
    ).map(s => s.date)));
    
    const extraForLevel = levelExtraExamDates[selectedLevel] || [];
    return Array.from(new Set([...existingDates, ...extraForLevel])).sort();
  }, [examSessions, selectedSemester, selectedExamType, filteredSpecialties, levelExtraExamDates, selectedLevel, activeTab]);

  const getSessionSpan = (day: string, period: string) => {
    const session = getSessionAt(day, period);
    if (!session) return 1;

    const module = modules.find(m => m.id === session.moduleId);
    const isL2 = levels.find(l => l.id === selectedLevel)?.name.includes('Second Year');
    const isST = module?.isST;

    // If this is not the first cell of a sequence, it will be skipped
    const prevPeriodIdx = PERIODS.indexOf(period) - 1;
    if (prevPeriodIdx >= 0) {
      const prevSession = getSessionAt(day, PERIODS[prevPeriodIdx]);
      if (prevSession) {
        const prevModule = modules.find(m => m.id === prevSession.moduleId);
        const prevIsST = prevModule?.isST;

        const isSameModule = (isL2 && isST && prevIsST) || 
                           (session.isReserved && prevSession.isReserved) ||
                           (prevSession.moduleId === session.moduleId && session.moduleId !== '');
        
        if (isSameModule && 
            prevSession.type === session.type && 
            (prevSession.isReserved ? prevSession.reservedFor === session.reservedFor : true) &&
            (prevSession.isExternal === session.isExternal) &&
            (prevSession.isExternal ? prevSession.externalModuleName === session.externalModuleName : true)) {
          return 0; // Skip this cell
        }
      }
    }

    // Calculate how many consecutive periods have the same session
    let span = 1;
    let nextPeriodIdx = PERIODS.indexOf(period) + 1;
    while (nextPeriodIdx < PERIODS.length) {
      const nextSession = getSessionAt(day, PERIODS[nextPeriodIdx]);
      if (nextSession) {
        const nextModule = modules.find(m => m.id === nextSession.moduleId);
        const nextIsST = nextModule?.isST;

        const isSameModule = (isL2 && isST && nextIsST) || 
                           (session.isReserved && nextSession.isReserved) ||
                           (nextSession.moduleId === session.moduleId && session.moduleId !== '');

        if (isSameModule && 
            nextSession.type === session.type && 
            (nextSession.isReserved ? nextSession.reservedFor === session.reservedFor : true) &&
            (nextSession.isExternal === session.isExternal) &&
            (nextSession.isExternal ? nextSession.externalModuleName === session.externalModuleName : true)) {
          span++;
          nextPeriodIdx++;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return span;
  };

  const hasSemesterConflict = (session: ScheduleSession) => {
    return scheduleSessions.some(other => {
      if (other.id === session.id) return false;
      if (other.day !== session.day || other.period !== session.period || other.semester !== session.semester) return false;

      // Room Conflict (unless same module)
      if (other.roomId === session.roomId && other.moduleId !== session.moduleId) return true;

      // Teacher Conflict
      if (other.teacherId === session.teacherId) return true;

      // Specialty Conflict
      if (other.specialtyId === session.specialtyId) return true;

      return false;
    });
  };

  const handleCopySchedule = async () => {
    setPromptConfig({
      show: true,
      title: 'نسخ الجداول لسنة جديدة:',
      defaultValue: '',
      type: 'text',
      onConfirm: (nextYear) => {
        if (!nextYear) return;
        setConfirmState({
          show: true,
          title: 'تأكيد النسخ',
          message: `هل أنت متأكد من نسخ جداول السنة ${selectedYear} إلى السنة ${nextYear}؟`,
          type: 'warning',
          onConfirm: async () => {
            setConfirmState(prev => ({ ...prev, show: false }));
            setCopying(true);
            const toastId = toast.loading('جاري نسخ الجداول...');

            try {
              // 1. Copy Modules first (as sessions depend on them)
              const modulesToCopy = modules;
              const moduleMapping: Record<string, string> = {};

              for (const mod of modulesToCopy) {
                const { id, ...modData } = mod;
                const newMod = { ...modData, academicYear: nextYear };
                const docRef = await addDoc(collection(db, 'modules'), newMod);
                moduleMapping[id] = docRef.id;
              }

              // 2. Copy Schedule Sessions
              for (const session of scheduleSessions) {
                const { id, ...sessionData } = session;
                const newSession = { 
                  ...sessionData, 
                  academicYear: nextYear,
                  moduleId: moduleMapping[session.moduleId] || session.moduleId 
                };
                await addDoc(collection(db, 'scheduleSessions'), newSession);
              }

              // 3. Copy Exam Sessions
              for (const exam of examSessions) {
                const { id, ...examData } = exam;
                const newExam = {
                  ...examData,
                  academicYear: nextYear,
                  moduleId: moduleMapping[exam.moduleId] || exam.moduleId
                };
                await addDoc(collection(db, 'examSessions'), newExam);
              }

              toast.success('تم نسخ الجداول والامتحانات بنجاح', { id: toastId });
            } catch (err) {
              console.error('Copy failed:', err);
              toast.error('فشل نسخ الجداول', { id: toastId });
            } finally {
              setCopying(false);
            }
          }
        });
      }
    });
  };

  const handleDeleteAllExams = async () => {
    setConfirmState({
      show: true,
      title: 'حذف جميع الامتحانات',
      message: `هل أنت متأكد من حذف جميع امتحانات السنة ${selectedYear} السداسي ${selectedSemester === 'S1' ? 'الأول' : 'الثاني'}؟`,
      type: 'danger',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, show: false }));
        const toastId = toast.loading('جاري المسح...');
        try {
          const examsToDelete = examSessions.filter(s => s.semester === selectedSemester);
          
          for (const exam of examsToDelete) {
            await deleteDoc(doc(db, 'examSessions', exam.id));
          }

          setExamSessions(prev => prev.filter(e => e.semester !== selectedSemester));
          toast.success('تم حذف جميع الامتحانات المختارة بنجاح', { id: toastId });
        } catch (err) {
          console.error('Delete failed:', err);
          toast.error('فشل حذف الامتحانات', { id: toastId });
        }
      }
    });
  };

  const handleRepairExams = async () => {
    setConfirmState({
      show: true,
      title: 'إصلاح شامل للبيانات',
      message: 'سيقوم النظام بفحص قاعدة البيانات بالكامل لإصلاح التنسيقات الخاطئة للأعوام الدراسية وتصحيح ارتباطات الامتحانات والحصص. هل تريد الاستمرار؟',
      type: 'info',
      onConfirm: async () => {
        const toastId = toast.loading('جاري فحص وإصلاح قاعدة البيانات...');
        try {
          // 1. Fetch ALL fresh data to ensure accurate matching
          const [
            examSnap, scheduleSnap, specialtiesSnap, 
            modulesSnap, levelsSnap, teachersSnap
          ] = await Promise.all([
            getDocs(collection(db, 'examSessions')),
            getDocs(collection(db, 'scheduleSessions')),
            getDocs(collection(db, 'specialties')),
            getDocs(collection(db, 'modules')),
            getDocs(collection(db, 'levels')),
            getDocs(collection(db, 'users'))
          ]);

          const freshSpecialties = specialtiesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Specialty));
          const freshModules = modulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Module));
          const freshLevels = levelsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Level));
          const freshTeachers = teachersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as User));

          let repairCount = 0;
          let batch = writeBatch(db);
          let batchCount = 0;
          const alternateYear = selectedYear.includes('/') ? selectedYear.replace('/', '-') : selectedYear.replace('-', '/');

          // 1. Repair Exams
          for (const d of examSnap.docs) {
            const exam = d.data() as ExamSession;
            let needsUpdate = false;
            let newData: any = {};

            if (exam.academicYear === alternateYear || !exam.academicYear) {
              newData.academicYear = selectedYear;
              needsUpdate = true;
            }

            let currentSpecId = newData.specialtyId || exam.specialtyId;
            const existingSpec = freshSpecialties.find(s => s.id === currentSpecId);
            if (!existingSpec && currentSpecId) {
              const specByAnyMeans = freshSpecialties.find(s => s.id === currentSpecId || s.name === currentSpecId);
              if (specByAnyMeans) {
                newData.specialtyId = specByAnyMeans.id;
                currentSpecId = specByAnyMeans.id;
                needsUpdate = true;
              }
            }

            const existingMod = freshModules.find(m => m.id === exam.moduleId);
            if (!existingMod && exam.moduleId) {
              const modByName = freshModules.find(m => 
                (m.name === exam.moduleId || m.id === exam.moduleId) && 
                (currentSpecId ? m.specialtyId === currentSpecId : true)
              );
              if (modByName) {
                newData.moduleId = modByName.id;
                if (!currentSpecId && modByName.specialtyId) {
                   newData.specialtyId = modByName.specialtyId;
                   currentSpecId = modByName.specialtyId;
                }
                needsUpdate = true;
              }
            }

            const levelByName = freshLevels.find(l => l.name === currentSpecId || l.id === currentSpecId);
            if (levelByName && !freshSpecialties.some(s => s.id === currentSpecId)) {
               const spec = freshSpecialties.find(s => s.levelId === levelByName.id);
               if (spec) {
                 newData.specialtyId = spec.id;
                 needsUpdate = true;
               }
            }

            if (exam.invigilators && Array.isArray(exam.invigilators)) {
              let invigsChanged = false;
              const newInvigs = exam.invigilators.map(invigId => {
                const teacher = freshTeachers.find(t => t.uid === invigId || t.email === invigId || t.username === invigId);
                if (teacher && teacher.uid !== invigId) {
                  invigsChanged = true;
                  return teacher.uid;
                }
                return invigId;
              });
              if (invigsChanged) {
                newData.invigilators = newInvigs;
                needsUpdate = true;
              }
            }

            if (needsUpdate) {
              batch.update(d.ref, newData);
              repairCount++;
              batchCount++;
              if (batchCount === 450) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
              }
            }
          }

          // 2. Repair Schedule Sessions
          for (const d of scheduleSnap.docs) {
            const session = d.data() as ScheduleSession;
            let needsUpdate = false;
            let newData: any = {};

            if (session.academicYear === alternateYear || !session.academicYear) {
              newData.academicYear = selectedYear;
              needsUpdate = true;
            }

            if (!freshSpecialties.some(s => s.id === session.specialtyId)) {
              const foundSpec = freshSpecialties.find(s => s.name === session.specialtyId || s.id === session.specialtyId);
              if (foundSpec) {
                newData.specialtyId = foundSpec.id;
                needsUpdate = true;
              }
            }

            if (needsUpdate) {
              batch.update(d.ref, newData);
              repairCount++;
              batchCount++;
              if (batchCount === 450) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
              }
            }
          }

          if (batchCount > 0) await batch.commit();

          if (repairCount > 0) {
            toast.success(`تم إصلاح ${repairCount} سجل بنجاح. جاري تحديث بيانات الصفحة...`, { id: toastId });
            setTimeout(() => window.location.reload(), 1500);
          } else {
            toast.success('قاعدة البيانات سليمة، لم يتم العثور على أخطاء للعام المحدد.', { id: toastId });
          }
        } catch (err) {
          console.error('Global repair failed:', err);
          toast.error('فشل عملية الإصلاح الشاملة. يرجى التحقق من الاتصال.', { id: toastId });
        }
      }
    });
  };

  const handleCleanupInvisibleExams = async () => {
    setConfirmState({
      show: true,
      title: 'تنظيف الامتحانات الوهمية',
      message: 'هل تريد حذف جميع الامتحانات الوهمية (غير المرتبطة بتخصص أو مادة موجودة)؟',
      type: 'warning',
      onConfirm: async () => {
        setConfirmState(prev => ({ ...prev, show: false }));
        const toastId = toast.loading('جاري تنظيف الامتحانات الوهمية...');
        try {
          // Invisible exams are for current year but specialty or module is missing, or missing date/time
          const invisibleExams = examSessions.filter(exam => {
            const hasSpecialty = specialties.some(s => s.id === exam.specialtyId);
            const hasModule = modules.some(m => m.id === exam.moduleId);
            const hasDate = !!exam.date;
            const hasTime = !!exam.time;
            return !hasSpecialty || !hasModule || !hasDate || !hasTime;
          });

          if (invisibleExams.length === 0) {
            toast.success('لا توجد امتحانات وهمية لحذفها', { id: toastId });
            return;
          }

          for (const exam of invisibleExams) {
            await deleteDoc(doc(db, 'examSessions', exam.id));
          }

          setExamSessions(prev => prev.filter(e => !invisibleExams.map(ie => ie.id).includes(e.id)));
          toast.success(`تم حذف ${invisibleExams.length} امتحان وهمي بنجاح`, { id: toastId });
        } catch (err) {
          console.error('Cleanup failed:', err);
          toast.error('فشل عملية التنظيف', { id: toastId });
        }
      }
    });
  };

  const handleAddSession = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const sessionData = {
      moduleId: formData.get('moduleId') as string,
      teacherId: formData.get('teacherId') as string,
      roomId: formData.get('roomId') as string,
      specialtyId: selectedSpecialty,
      semester: selectedSemester,
      day: formData.get('day') as any,
      period: formData.get('period') as any,
      type: formData.get('type') as any,
      academicYear: selectedYear.replace('-', '/'),
      isExternal: formData.get('isExternal') === 'true',
      externalModuleName: formData.get('externalModuleName') as string,
      isReserved: formData.get('isReserved') === 'true',
      reservedFor: formData.get('reservedFor') as string,
    };

    try {
      if (editingSession) {
        await updateDoc(doc(db, 'scheduleSessions', editingSession.id), sessionData);
      } else {
        await addDoc(collection(db, 'scheduleSessions'), sessionData);
      }
      
      setShowAddModal(false);
      setEditingSession(null);
    } catch (err) {
      handleFirestoreError(err, editingSession ? OperationType.UPDATE : OperationType.CREATE, 'scheduleSessions');
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      // Try to delete from both collections to be sure
      await deleteDoc(doc(db, 'scheduleSessions', id));
      await deleteDoc(doc(db, 'examSessions', id));
      
      setScheduleSessions(prev => prev.filter(s => s.id !== id));
      setExamSessions(prev => prev.filter(s => s.id !== id));
      
      // Close modal and clear state
      setShowAddModal(false);
      setEditingSession(null);
      setEditingExam(null);
      setSessionToDelete(null);
      
      toast.success('تم الحذف بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'sessions/' + id);
    }
  };

  const exportPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const specialty = specialties.find(s => s.id === selectedSpecialty);
    const level = levels.find(l => l.id === selectedLevel);
    const cycle = cycles.find(c => c.id === selectedCycle);

    // Header (Always English)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Mechanical Engineering Department - Laghouat University', 148.5, 12, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text(`${level?.name || ''} - ${specialty?.name || ''} | Semester Schedule`, 148.5, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`Academic Year 2025/2026 - ${selectedSemester === 'S1' ? 'Semester 1' : 'Semester 2'}`, 148.5, 27, { align: 'center' });

    const tableData = DAYS.map(day => {
      const row: any[] = [day];
      const periodsToSkip: number[] = [];

      PERIODS.forEach((period, pIdx) => {
        if (periodsToSkip.includes(pIdx)) return;

        const span = getSessionSpan(day, period);
        const session = getSessionAt(day, period);

        if (session) {
          const module = modules.find(m => m.id === session.moduleId);
          const teacher = resolveTeacher(session.teacherId);
          const room = rooms.find(r => r.id === session.roomId);
          
          row.push({
            content: '',
            colSpan: span,
            module: module?.name || t('unknown_module'),
            teacher: teacher?.displayName || t('no_teacher'),
            room: room?.name || t('no_room'),
            type: session.type
          });

          // Mark next periods to skip if span > 1
          for (let i = 1; i < span; i++) {
            periodsToSkip.push(pIdx + i);
          }
        } else {
          row.push('');
        }
      });
      return row;
    });

    autoTable(doc, {
      head: [['DAY / TIME', ...PERIODS.map(p => `${p}\n${PERIOD_TIMES[p as keyof typeof PERIOD_TIMES]}`)]],
      body: tableData,
      startY: 35,
      margin: { top: 5, right: 5, bottom: 5, left: 5 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        halign: 'center',
        valign: 'middle',
        cellPadding: 2,
        lineWidth: 0.1,
        lineColor: [0, 0, 0],
        minCellHeight: 25,
      },
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        fontSize: 9,
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { fillColor: [250, 250, 250], fontStyle: 'bold', fontSize: 10, cellWidth: 25 },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index > 0 && typeof data.cell.raw === 'object') {
          const type = data.cell.raw.type;
          // Set background color based on type
          if (type === 'Cours') data.cell.styles.fillColor = [255, 249, 196]; // Light Yellow
          else if (type === 'TD') data.cell.styles.fillColor = [220, 252, 231]; // Light Green
          else if (type === 'TP') data.cell.styles.fillColor = [219, 234, 254]; // Light Blue
          
          data.cell.text = []; // Clear default text drawing
        }
      },
      didDrawCell: (data: any) => {
        if (data.section === 'body' && data.column.index > 0 && data.cell.raw && typeof data.cell.raw === 'object') {
          const { module, teacher, room, type } = data.cell.raw;
          const { x, y, width, height } = data.cell;
          const padding = 2;

          // 1. Module: Center, Bold Black
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(0, 0, 0);
          const splitModule = doc.splitTextToSize(module, width - padding * 2);
          doc.text(splitModule, x + width / 2, y + height / 2, { align: 'center', baseline: 'middle' });

          // 2. Teacher: Top-Right, Bold Black
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6); // Smaller font to help stay on one line
          doc.setTextColor(0, 0, 0);
          doc.text(teacher, x + width - padding, y + padding + 2, { align: 'right' });

          // 3. Room: Bottom-Left, Red
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6);
          doc.setTextColor(220, 38, 38); // Red-600
          doc.text(room, x + padding, y + height - padding, { align: 'left', baseline: 'bottom' });

          // 4. Type: Bottom-Right, Blue
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(37, 99, 235); // Blue-600
          doc.text(type, x + width - padding, y + height - padding, { align: 'right', baseline: 'bottom' });
          
          // Reset for next cells
          doc.setTextColor(0, 0, 0);
        }
      },
    });

    doc.save(`Schedule_${specialty?.name || 'Export'}.pdf`);
  };

  const exportExamPDF = (includeInvigilators: boolean = true) => {
    const specs = specialties.filter(s => s.levelId === selectedLevel);
    const specIds = specs.map(s => s.id);
    const filteredExams = examSessions.filter(s => 
      s.semester === selectedSemester && 
      (selectedExamType === 'All' || s.type === selectedExamType) &&
      specIds.includes(s.specialtyId)
    );
    
    let dates: string[] = [];
    if (examStartDate && examEndDate) {
      let current = new Date(examStartDate);
      const end = new Date(examEndDate);
      while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
    } else {
      const extraForLevel = levelExtraExamDates[selectedLevel] || [];
      dates = Array.from(new Set([...filteredExams.map(s => s.date), ...extraForLevel])).sort();
    }

    // Determine format based on number of specialties
    let format = 'a4';
    if (specs.length > 8) format = 'a2';
    else if (specs.length > 5) format = 'a3';
    else format = 'a4';

    const doc = new jsPDF('l', 'mm', format);
    const level = levels.find(l => l.id === selectedLevel);
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const centerX = pageWidth / 2;

    // Calculate optimal cell height to force single page
    // startY is 35, margins are 5 top/bottom. Available height = pageHeight - 35 - 10
    const availableHeight = pageHeight - 45; 
    const rowCount = dates.length + 1; // +1 for header
    const optimalCellHeight = Math.floor(availableHeight / rowCount);
    
    // Adjust font size based on available space
    let baseFontSize = 7;
    if (format === 'a2') baseFontSize = 10;
    else if (format === 'a3') baseFontSize = 9;
    else baseFontSize = 8;

    // If rows are very tight, shrink font
    if (optimalCellHeight < 20) baseFontSize = Math.max(6, baseFontSize - 1);

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Mechanical Engineering Department - Laghouat University', centerX, 12, { align: 'center' });
    
    doc.setFontSize(14);
    const sessionType = selectedExamType === 'Resit' ? 'Remedial Session' : 
                        selectedExamType === 'Regular' ? 'Normal Session' : 'Exam Schedule';
    const currentLevel = levels.find(l => l.id === selectedLevel);
    doc.text(`${currentLevel?.name || ''} | ${sessionType}`, centerX, 20, { align: 'center' });
    
    doc.setFontSize(11);
    doc.text(`Academic Year ${selectedYear} - ${selectedSemester === 'S1' ? 'Semester 1' : 'Semester 2'}`, centerX, 27, { align: 'center' });

    const specHeaders = specs.map(spec => {
      const specExams = filteredExams.filter(s => s.specialtyId === spec.id);
      const time = specExams.length > 0 ? specExams[0].time : '';
      // Make time and specialty more prominent with a gap
      return time ? `${time}\n\n${spec.name.toUpperCase()}` : spec.name.toUpperCase();
    });

    const SPECIALTY_COLORS = [
      [253, 242, 233], // Peach
      [236, 253, 245], // Mint
      [239, 246, 255], // Blue
      [255, 251, 235], // Amber
      [250, 245, 255], // Purple
      [254, 242, 242], // Rose
    ];

    const tableData = dates.map(date => {
      const dateObj = new Date(date);
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      const row: any[] = [`${dayName}\n${date}`];
      specs.forEach(spec => {
        const sessions = filteredExams.filter(s => s.date === date && s.specialtyId === spec.id);
        if (sessions.length > 0) {
          row.push(sessions.map(s => {
            const module = modules.find(m => m.id === s.moduleId);
            if (s.mode === 'Detailed') {
              const assignments = s.roomAssignments?.map(ra => {
                const room = rooms.find(r => r.id === ra.roomId);
                const invigs = includeInvigilators ? ra.invigilators.map(id => {
                  const t = resolveTeacher(id);
                  return formatTeacherName(t?.displayName || id);
                }).join(', ') : '';
                return {
                  room: room?.name || '',
                  invigs,
                  groups: ra.groups?.join(', ') || '',
                  studentCount: ra.studentCount
                };
              });
              return {
                module: module?.name || '',
                time: s.time,
                assignments,
                mode: 'Detailed'
              };
            } else {
              const roomNames = s.roomIds?.map((id: string) => rooms.find(r => r.id === id)?.name).filter(Boolean).join(' + ') || '';
              const invigs = includeInvigilators ? s.invigilators?.map((id: string) => {
                const t = resolveTeacher(id);
                return formatTeacherName(t?.displayName || id);
              }).join(', ') || '' : '';
              return {
                module: module?.name || '',
                room: roomNames,
                invigs: invigs,
                time: s.time,
                studentCount: s.studentCount,
                mode: 'Simple'
              };
            }
          }));
        } else {
          row.push('');
        }
      });
      return row;
    });

    // Calculate equal column widths for specialties
    const firstColWidth = 30;
    const marginTotal = 10;
    const remainingWidth = pageWidth - marginTotal - firstColWidth;
    const specColWidth = remainingWidth / specs.length;

    const columnStyles: { [key: number]: any } = {
      0: { cellWidth: firstColWidth, fontStyle: 'bold', fillColor: [241, 245, 249] },
    };
    specs.forEach((_, idx) => {
      columnStyles[idx + 1] = { cellWidth: specColWidth };
    });

    autoTable(doc, {
      head: [['', ...specHeaders]], // Empty string for diagonal header
      body: tableData,
      startY: 35,
      margin: { top: 5, right: 5, bottom: 5, left: 5 },
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: baseFontSize,
        halign: 'center',
        valign: 'middle',
        lineWidth: 0.5,
        lineColor: [0, 0, 0],
        minCellHeight: optimalCellHeight,
        overflow: 'linebreak',
      },
      columnStyles,
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontSize: baseFontSize + 1,
        fontStyle: 'bold',
        lineWidth: 0.5,
        lineColor: [0, 0, 0],
      },
      didParseCell: (data: any) => {
        if (data.section === 'head' && data.column.index > 0) {
          data.cell.styles.fillColor = [253, 224, 71]; // Yellow-300
        }
        if (data.section === 'body' && data.column.index > 0) {
          const specIdx = data.column.index - 1;
          data.cell.styles.fillColor = SPECIALTY_COLORS[specIdx % SPECIALTY_COLORS.length];
          if (Array.isArray(data.cell.raw)) {
            data.cell.text = [];
          }
        }
      },
      didDrawCell: (data: any) => {
        if (data.section === 'head' && data.column.index === 0) {
          const { x, y, width, height } = data.cell;
          doc.setDrawColor(0, 0, 0);
          doc.setLineWidth(0.5);
          doc.line(x, y, x + width, y + height);
          
          doc.setFontSize(baseFontSize + 1);
          doc.text('Hour', x + width - 4, y + 8, { align: 'right' });
          doc.text('Day', x + 4, y + height - 5, { align: 'left' });
        }

        if (data.section === 'body' && data.column.index > 0 && Array.isArray(data.cell.raw)) {
          const sessions = data.cell.raw;
          const { x, y, width, height } = data.cell;
          const padding = 2;
          let currentY = y;

          sessions.forEach((s: any, idx: number) => {
            const cellHeight = height / sessions.length;
            
            if (s.mode === 'Simple') {
              // 1. Module: Center, Bold Black
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(baseFontSize + 2); // Increased size for prominence
              doc.setTextColor(0, 0, 0);
              const splitModule = doc.splitTextToSize(s.module, width - padding * 2);
              doc.text(splitModule, x + width / 2, currentY + cellHeight / 2, { align: 'center', baseline: 'middle' });
              
              // 2. Invigilators: Top-Right, Black
              doc.setFontSize(baseFontSize - 2);
              doc.setTextColor(0, 0, 0);
              doc.text(s.invigs, x + width - padding, currentY + padding + 2, { align: 'right' });

              // 3. Rooms: Bottom-Left, Black
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(0, 0, 0);
              doc.text(s.room, x + padding, currentY + cellHeight - padding, { align: 'left', baseline: 'bottom' });

              if (s.studentCount > 0) {
                doc.setFontSize(baseFontSize - 2);
                doc.setTextColor(153, 27, 27); // Dark Red
                doc.text(`Resit: ${s.studentCount}`, x + padding, currentY + padding + 2, { align: 'left' });
              }
            } else {
              // Detailed Mode
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(baseFontSize + 2); // Increased size for prominence
              doc.setTextColor(0, 0, 0);
              const splitModule = doc.splitTextToSize(s.module, width - padding * 2);
              doc.text(splitModule, x + width / 2, currentY + 8, { align: 'center' });

              // Position assignments at the bottom: distributed horizontally from bottom-left to right
              const assignmentY = currentY + cellHeight - padding - 1;
              if (s.assignments && s.assignments.length > 0) {
                const count = s.assignments.length;
                const step = count > 1 ? (width - padding * 2) / (count - 1) : 0;
                
                s.assignments.forEach((ra: any, rIdx: number) => {
                  doc.setFont('helvetica', 'bold');
                  doc.setFontSize(baseFontSize - 2);
                  doc.setTextColor(0, 0, 0);
                  
                  const info = `${ra.room} (${ra.groups || 'All'}) : ${ra.invigs}`;
                  
                  let align: 'left' | 'center' | 'right' = 'center';
                  let posX: number;
                  
                  if (count === 1) {
                    align = 'center';
                    posX = x + width / 2;
                  } else {
                    posX = x + padding + rIdx * step;
                    if (rIdx === 0) align = 'left';
                    else if (rIdx === count - 1) align = 'right';
                    else align = 'center';
                  }
                  
                  // Ensure info stays on one line as requested
                  doc.text(info, posX, assignmentY, { align, baseline: 'bottom' });
                });
              }
            }

            if (idx < sessions.length - 1) {
              currentY += cellHeight;
              doc.setDrawColor(0, 0, 0);
              doc.line(x, currentY, x + width, currentY);
            }
          });
        }
      }
    });

    doc.save(`Exam_Schedule_${level?.name || 'Export'}.pdf`);
  };

  const exportPersonalInvigilationPDF = async () => {
    if (!invigilationRef.current) return null;
    
    const toastId = toast.loading('جاري تحضير الملف...');
    try {
      const canvas = await html2canvas(invigilationRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
      const width = canvas.width * ratio;
      const height = canvas.height * ratio;
      
      const x = (pdfWidth - width) / 2;
      const y = 0;
      
      pdf.addImage(imgData, 'PNG', x, y, width, height);
      toast.success('تم تحضير الملف بنجاح', { id: toastId });
      return pdf;
    } catch (err) {
      console.error('PDF Export Error:', err);
      toast.error('فشل تحضير الملف', { id: toastId });
      return null;
    }
  };

  const handleEmailInvigilation = async () => {
    console.log('handleEmailInvigilation called', { selectedTeacherId });
    const teacher = resolveTeacher(selectedTeacherId);
    
    if (!teacher) {
      toast.error('لم يتم العثور على بيانات الأستاذ');
      return;
    }

    if (!teacher.email) {
      toast.error('البريد الإلكتروني للأستاذ غير متوفر');
      return;
    }

    const loadingToast = toast.loading('جاري إرسال البريد الإلكتروني...');
    try {
      const subject = `قائمة الحراسة - ${selectedSemester === 'S1' ? 'السداسي 1' : 'السداسي 2'} - جامعة الأغواط`;
      const html = `
        <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #334155; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #ea580c; padding: 24px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 20px;">قائمة الحراسة - قسم الهندسة الميكانيكية</h1>
          </div>
          <div style="padding: 32px; line-height: 1.6;">
            <h2 style="color: #1e293b; margin-top: 0;">مرحباً ${teacher.displayName}،</h2>
            <p>يرجى الاطلاع على قائمة الحراسة الخاصة بك للموسم الدراسي الحالي:</p>
            
            <div style="background-color: #fff7ed; padding: 20px; border-radius: 8px; border: 1px solid #ffedd5; margin: 24px 0;">
              <p style="margin: 8px 0;"><strong>السنة الدراسية:</strong> ${selectedYear}</p>
              <p style="margin: 8px 0;"><strong>السداسي:</strong> ${selectedSemester === 'S1' ? 'الأول' : 'الثاني'}</p>
            </div>
            
            <p>يمكنك عرض التفاصيل الكاملة وتحميل الجدول بصيغة PDF من خلال الرابط أدناه:</p>
            
            <div style="text-align: center; margin-top: 32px;">
              <a href="${window.location.origin}/schedules" style="background-color: #ea580c; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">عرض قائمة الحراسة</a>
            </div>
          </div>
          <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
            هذا البريد مرسل تلقائياً من نظام إدارة القسم - جامعة عمار ثليجي بالأغواط
          </div>
        </div>
      `;
      
      console.log('Sending email to:', teacher.email);
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: teacher.email,
          subject,
          body: `مرحباً ${teacher.displayName}، يرجى الاطلاع على قائمة الحراسة الخاصة بك في المنصة. السنة الدراسية: ${selectedYear}، السداسي: ${selectedSemester}`,
          html
        })
      });

      const result = await response.json();
      console.log('Email API response:', result);

      if (response.ok && result.success) {
        toast.success(result.message || 'تم إرسال البريد الإلكتروني بنجاح');
      } else {
        throw new Error(result.message || 'Failed to send email');
      }
    } catch (error) {
      console.error('Email error:', error);
      toast.error(`فشل إرسال البريد الإلكتروني: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally {
      toast.dismiss(loadingToast);
    }
  };

  const exportPersonalWeeklyPDF = async () => {
    if (!weeklyScheduleRef.current) return null;
    
    const toastId = toast.loading('جاري تحضير الملف...');
    try {
      const canvas = await html2canvas(weeklyScheduleRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
      const width = canvas.width * ratio;
      const height = canvas.height * ratio;
      
      const x = (pdfWidth - width) / 2;
      const y = (pdfHeight - height) / 2;
      
      pdf.addImage(imgData, 'PNG', x, y, width, height);
      toast.success('تم تحضير الملف بنجاح', { id: toastId });
      return pdf;
    } catch (err) {
      console.error('PDF Export Error:', err);
      toast.error('فشل تحضير الملف', { id: toastId });
      return null;
    }
  };

  const handleEmailWeeklySchedule = async () => {
    console.log('handleEmailWeeklySchedule called', { selectedTeacherId });
    const teacher = resolveTeacher(selectedTeacherId);
    
    if (!teacher) {
      toast.error('لم يتم العثور على بيانات الأستاذ');
      return;
    }

    if (!teacher.email) {
      toast.error('البريد الإلكتروني للأستاذ غير متوفر');
      return;
    }

    const loadingToast = toast.loading('جاري إرسال البريد الإلكتروني...');
    try {
      const subject = `جدول الحصص الأسبوعي - ${selectedSemester === 'S1' ? 'السداسي 1' : 'السداسي 2'} - جامعة الأغواط`;
      const html = `
        <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #334155; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #2563eb; padding: 24px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 20px;">جدول الحصص الأسبوعي - قسم الهندسة الميكانيكية</h1>
          </div>
          <div style="padding: 32px; line-height: 1.6;">
            <h2 style="color: #1e293b; margin-top: 0;">مرحباً ${teacher.displayName}،</h2>
            <p>يرجى الاطلاع على جدول حصصك الأسبوعي المحدث للموسم الدراسي الحالي:</p>
            
            <div style="background-color: #eff6ff; padding: 20px; border-radius: 8px; border: 1px solid #dbeafe; margin: 24px 0;">
              <p style="margin: 8px 0;"><strong>السنة الدراسية:</strong> ${selectedYear}</p>
              <p style="margin: 8px 0;"><strong>السداسي:</strong> ${selectedSemester === 'S1' ? 'الأول' : 'الثاني'}</p>
            </div>
            
            <p>يمكنك عرض الجدول الكامل وتحميله بصيغة PDF من خلال الرابط أدناه:</p>
            
            <div style="text-align: center; margin-top: 32px;">
              <a href="${window.location.origin}/schedules" style="background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">عرض الجدول الأسبوعي</a>
            </div>
          </div>
          <div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8;">
            هذا البريد مرسل تلقائياً من نظام إدارة القسم - جامعة عمار ثليجي بالأغواط
          </div>
        </div>
      `;
      
      console.log('Sending email to:', teacher.email);
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: teacher.email,
          subject,
          body: `مرحباً ${teacher.displayName}، يرجى الاطلاع على جدول حصصك الأسبوعي في المنصة. السنة الدراسية: ${selectedYear}، السداسي: ${selectedSemester}`,
          html
        })
      });

      const result = await response.json();
      console.log('Email API response:', result);

      if (response.ok && result.success) {
        toast.success(result.message || 'تم إرسال البريد الإلكتروني بنجاح');
      } else {
        throw new Error(result.message || 'Failed to send email');
      }
    } catch (error) {
      console.error('Email error:', error);
      toast.error(`فشل إرسال البريد الإلكتروني: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally {
      toast.dismiss(loadingToast);
    }
  };

  const handleAddExam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin && !isViceAdmin) return;
    
    // Validation
    if (!examModule || !examSpecialty || !examDate || !examTime) {
      toast.error('يرجى ملء جميع البيانات الأساسية');
      return;
    }

    const examData: any = {
      moduleId: examModule,
      specialtyId: examSpecialty,
      semester: selectedSemester,
      date: examDate,
      time: examTime,
      type: formExamType,
      mode: examMode,
      academicYear: selectedYear.replace('-', '/'),
    };

    if (examMode === 'Simple') {
      if (examRooms.length === 0) {
        toast.error('يجب اختيار قاعة واحدة على الأقل');
        return;
      }
      if (examInvigilators.length === 0) {
        toast.error('يجب اختيار حارس واحد على الأقل');
        return;
      }
      examData.roomIds = examRooms;
      examData.invigilators = examInvigilators;
      const formData = new FormData(e.currentTarget);
      examData.studentCount = formExamType === 'Resit' ? Number(formData.get('studentCount')) || 0 : 0;
    } else {
      const invalid = roomAssignments.some(ra => !ra.roomId || !ra.invigilators || ra.invigilators.length === 0);
      if (invalid) {
        toast.error('يرجى اختيار القاعة وجميع الحراس لكل تعيين');
        return;
      }
      examData.roomAssignments = roomAssignments;
    }

    try {
      if (editingExam) {
        await updateDoc(doc(db, 'examSessions', editingExam.id), examData);
      } else {
        await addDoc(collection(db, 'examSessions'), examData);
      }

      setShowAddModal(false);
      setEditingExam(null);
      setExamDate('');
      setExamTime('');
      setExamModule('');
      setExamRooms([]);
      setExamInvigilators([]);
      setApplyTimeToLevel(false);
      setRoomAssignments([{ roomId: '', invigilators: [], groups: [], studentCount: 0 }]);

      if (applyTimeToLevel && examTime) {
        await handleUpdateTimeForSpecialty(examSpecialty, examTime, 'level', examSessions);
      }
      toast.success(editingExam ? 'تم تحديث الامتحان بنجاح' : 'تم إضافة الامتحان بنجاح');
    } catch (err) {
      handleFirestoreError(err, editingExam ? OperationType.UPDATE : OperationType.CREATE, 'examSessions');
    }
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">الجداول الزمنية</h1>
          <p className="text-slate-500">إدارة جداول السداسي، الامتحانات، واستغلال القاعات</p>
        </div>
        <div className="flex gap-2">
          {(isAdmin || isViceAdmin) && (
            <>
              <button 
                onClick={() => setShowImporter(true)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-600 border border-purple-100 rounded-xl hover:bg-purple-100 transition-all shadow-sm"
                title="استيراد من ملف PDF"
              >
                <FileText className="w-4 h-4" />
                <span>استيراد PDF</span>
              </button>
              <button 
                onClick={handleRepairExams}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-all shadow-sm border border-blue-100"
                title="إصلاح الامتحانات غير المرئية أو المرتبطة ببيانات قديمة"
              >
                <RefreshCw className="w-4 h-4" />
                <span>إصلاح وتحديث</span>
              </button>
              <button 
                onClick={handleCopySchedule}
                disabled={copying}
                className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-600 rounded-xl hover:bg-amber-100 transition-all shadow-sm border border-amber-100"
              >
                <Copy className="w-4 h-4" />
                <span>نسخ للسنة القادمة</span>
              </button>
              <button 
                onClick={handleCleanupInvisibleExams}
                className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all shadow-sm border border-slate-100"
                title="حذف الامتحانات المتبقية لمواد أو تخصصات محذوفة"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>تنظيف الوهمي</span>
              </button>
              <button 
                onClick={handleDeleteAllExams}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-all shadow-sm border border-red-100"
              >
                <Trash2 className="w-4 h-4" />
                <span>حذف الكل</span>
              </button>
            </>
          )}
          <button 
            onClick={() => {
              if (activeTab === 'exams') exportExamPDF();
              else if (activeTab === 'personal') exportPersonalInvigilationPDF();
              else exportPDF();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
          >
            <Download className="w-4 h-4" />
            <span>تحميل PDF</span>
          </button>
          {activeTab === 'exams' && (
            <button 
              onClick={() => exportExamPDF(false)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-xl text-blue-600 hover:bg-blue-100 transition-all shadow-sm"
              title="نسخة خاصة بالطلبة لا تحتوي على أسماء الحراس"
            >
              <FileText className="w-4 h-4" />
              <span>نسخة الطلبة (بدون حراس)</span>
            </button>
          )}
          {(isAdmin || isViceAdmin) && (
            <button 
              onClick={() => { 
                setEditingSession(null); 
                setEditingExam(null);
                setExamDate('');
                setExamTime('');
                setExamModule('');
                setExamSpecialty('');
                setExamRooms([]);
                setExamInvigilators([]);
                setFormTeacherId('');
                setShowAddModal(true); 
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة {activeTab === 'exams' ? 'امتحان' : 'حصة'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
        {[
          { id: 'semester', label: 'جدول السداسي', icon: Calendar, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
          { id: 'exams', label: 'جدول الامتحانات', icon: ClipboardList, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
          { id: 'halls', label: 'استغلال القاعات', icon: MapPin, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
          { id: 'personal', label: 'جدولي الشخصي', icon: UserIcon, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
        ].filter(tab => tab.roles.includes(user?.role || '')).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as ScheduleTab)}
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all",
              activeTab === tab.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <tab.icon className="w-4 h-4" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        {activeTab !== 'halls' && (
          <>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase">الطور</label>
              <select 
                value={selectedCycle} 
                onChange={(e) => { setSelectedCycle(e.target.value); setSelectedLevel(''); setSelectedSpecialty(''); }}
                className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-slate-900"
              >
                <option value="" className="text-slate-900">اختر الطور</option>
                {cycles.map(c => <option key={c.id} value={c.id} className="text-slate-900">{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase">المستوى</label>
              <select 
                value={selectedLevel} 
                onChange={(e) => { setSelectedLevel(e.target.value); setSelectedSpecialty(''); }}
                className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-slate-900"
                disabled={!selectedCycle}
              >
                <option value="" className="text-slate-900">اختر المستوى</option>
                {filteredLevels.map(l => <option key={l.id} value={l.id} className="text-slate-900">{l.name}</option>)}
              </select>
            </div>
            {activeTab !== 'exams' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase">التخصص</label>
                <select 
                  value={selectedSpecialty} 
                  onChange={(e) => setSelectedSpecialty(e.target.value)}
                  className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-slate-900"
                  disabled={!selectedLevel}
                >
                  <option value="" className="text-slate-900">اختر التخصص</option>
                  {filteredSpecialties.map(s => <option key={s.id} value={s.id} className="text-slate-900">{s.name}</option>)}
                </select>
              </div>
            )}
          </>
        )}
        {activeTab === 'halls' && (
          <div className="space-y-2 md:col-span-3">
            <label className="text-xs font-bold text-slate-400 uppercase">القاعة</label>
            <select 
              value={selectedRoom} 
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-slate-900"
            >
              <option value="" className="text-slate-900">اختر القاعة</option>
              {rooms.map(r => <option key={r.id} value={r.id} className="text-slate-900">{r.name} ({r.type})</option>)}
            </select>
          </div>
        )}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-400 uppercase">السنة الدراسية</label>
          <input 
            type="text"
            value={selectedYear}
            readOnly
            className="w-full bg-slate-100 border-none rounded-xl px-4 py-3 text-slate-500 cursor-not-allowed"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-400 uppercase">السداسي</label>
          <select 
            value={selectedSemester} 
            onChange={(e) => setSelectedSemester(e.target.value as any)}
            className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-slate-900"
          >
            <option value="S1" className="text-slate-900">السداسي الأول</option>
            <option value="S2" className="text-slate-900">السداسي الثاني</option>
          </select>
        </div>
        {activeTab === 'exams' && (
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase">نوع الدورة</label>
            <select 
              value={selectedExamType} 
              onChange={(e) => setSelectedExamType(e.target.value as any)}
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-slate-900"
            >
              <option value="All" className="text-slate-900">الكل</option>
              <option value="Regular" className="text-slate-900">الدورة العادية</option>
              <option value="Resit" className="text-slate-900">الدورة الاستدراكية</option>
            </select>
          </div>
        )}
      </div>

      {/* Semester Schedule Grid */}
      {activeTab === 'semester' && (
        <div className="space-y-6">
          {(!isAdmin && !isViceAdmin) && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {specialties.map(spec => {
                const level = levels.find(l => l.id === spec.levelId);
                return (
                  <div key={spec.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group hover:border-blue-200 transition-all">
                    <div>
                      <h4 className="font-bold text-slate-900">{spec.name}</h4>
                      <p className="text-xs text-slate-500">{level?.name}</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setSelectedSpecialty(spec.id)}
                        className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-all"
                        title="عرض الجدول"
                      >
                        <Calendar className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => {
                          setSelectedSpecialty(spec.id);
                          // Small delay to ensure state updates before PDF generation
                          setTimeout(() => exportPDF(), 100);
                        }}
                        className="p-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-all"
                        title="تحميل PDF"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedSpecialty && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-900">
                  جدول تخصص: {specialties.find(s => s.id === selectedSpecialty)?.name}
                </h3>
                {(!isAdmin && !isViceAdmin) && (
                  <button 
                    onClick={() => setSelectedSpecialty('')}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    العودة للقائمة
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="p-4 text-right text-sm font-bold text-slate-500 border-l border-slate-100 w-32">اليوم / الوقت</th>
                      {PERIODS.map(p => (
                        <th key={p} className="p-4 text-center border-l border-slate-100 min-w-[150px]">
                          <div className="text-sm font-bold text-slate-900">{p}</div>
                          <div className="text-[10px] text-slate-500 font-medium">{PERIOD_TIMES[p as keyof typeof PERIOD_TIMES]}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map(day => (
                      <tr key={day} className="border-b border-slate-50 last:border-0">
                        <td className="p-4 bg-slate-50/50 border-l border-slate-100">
                          <span className="font-bold text-slate-700">{DAY_LABELS[day]}</span>
                        </td>
                        {PERIODS.map(period => {
                          const span = getSessionSpan(day, period);
                          if (span === 0) return null;

                          const session = getSessionAt(day, period);
                          const module = modules.find(m => m.id === session?.moduleId);
                          const teacher = resolveTeacher(session?.teacherId);
                          const room = rooms.find(r => r.id === session?.roomId);
                          const hasConflict = session ? hasSemesterConflict(session) : false;

                          // Check if this is an ST module and we are in L2
                          const isL2 = levels.find(l => l.id === selectedLevel)?.name.includes('Second Year');
                          const isST = module?.isST;

                          return (
                            <td key={period} colSpan={span} className="p-2 border-l border-slate-100 h-32 relative group">
                              {session ? (
                                <div className={cn(
                                  "h-full w-full rounded-xl p-3 flex flex-col justify-between transition-all border relative",
                                  session.isReserved ? "bg-slate-100 border-slate-200 text-slate-500" :
                                  session.type === 'Cours' 
                                    ? "bg-yellow-50 border-yellow-100 text-yellow-900" 
                                    : session.type === 'TD'
                                    ? "bg-green-50 border-green-100 text-green-900"
                                    : "bg-blue-50 border-blue-100 text-blue-900",
                                  hasConflict && "border-red-500 ring-1 ring-red-500"
                                )}>
                                  {hasConflict && (
                                    <div className="absolute -top-2 -right-2 bg-red-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold shadow-lg z-10">
                                      تضارب!
                                    </div>
                                  )}
                                  <div className="flex justify-between items-start">
                                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                                      {session.isReserved ? 'محجوزة' : session.type}
                                    </span>
                                    {(isAdmin || isViceAdmin) && (
                                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => { setEditingSession(session); setShowAddModal(true); }} className="p-1 hover:bg-white/50 rounded-lg"><Edit2 className="w-3 h-3" /></button>
                                        <button onClick={() => setSessionToDelete({ id: session.id, type: 'schedule' })} className="p-1 hover:bg-white/50 rounded-lg text-red-600"><Trash2 className="w-3 h-3" /></button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="font-bold text-sm leading-tight text-center my-1">
                                    {session.isReserved ? (session.reservedFor || 'قسم آخر') : 
                                     (isL2 && isST) ? 'S&T Department' : (module?.name || t('unknown_module'))}
                                  </div>
                                  {!session.isReserved && (
                                    <div className="flex flex-col gap-0.5 mt-auto">
                                      <div className="flex items-center gap-1.5 text-[10px] font-medium opacity-70">
                                        <MapPin className="w-3 h-3" />
                                        <span>{room?.name || t('no_room')}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 text-[10px] font-medium opacity-70">
                                        <UserIcon className="w-3 h-3" />
                                        <span>{teacher?.displayName || t('no_teacher')}</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                (isAdmin || isViceAdmin) && (
                                  <button 
                                    onClick={() => { 
                                      setEditingSession(null); 
                                      setFormDay(day);
                                      setFormPeriod(period);
                                      setFormTeacherId('');
                                      setShowAddModal(true); 
                                    }}
                                    className="h-full w-full rounded-xl border-2 border-dashed border-slate-100 flex items-center justify-center text-slate-300 hover:border-blue-200 hover:text-blue-300 transition-all"
                                  >
                                    <Plus className="w-6 h-6" />
                                  </button>
                                )
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Exam Schedule Grid */}
      {activeTab === 'exams' && (
        <div className="space-y-4">
          {!selectedLevel ? (
            <div className="bg-white p-12 rounded-2xl border-2 border-dashed border-slate-200 text-center">
              <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-900">يرجى اختيار الطور والمستوى لعرض جدول الامتحانات</h3>
              <p className="text-slate-500">سيظهر الجدول هنا بمجرد تحديد الفلاتر المطلوبة</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border-2 border-black shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-black">
              <thead>
                <tr className="bg-white border-b-2 border-black">
                  <th className="relative p-0 w-48 h-24 border-l-2 border-black bg-white group">
                    <div className="absolute inset-0">
                      <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                        <line x1="0" y1="0" x2="100" y2="100" stroke="black" strokeWidth="1.5" />
                      </svg>
                    </div>
                    <span className="absolute bottom-4 left-4 text-sm font-bold text-black">اليوم</span>
                    <span className="absolute top-4 right-4 text-sm font-bold text-black">الساعة</span>
                    {(isAdmin || isViceAdmin) && (
                      <button 
                        onClick={() => {
                          setPromptValue('');
                          setPromptConfig({
                            show: true,
                            title: 'إضافة يوم جديد:',
                            defaultValue: '',
                            type: 'date',
                            onConfirm: (newDate) => {
                              if (newDate && !isNaN(Date.parse(newDate))) {
                                setLevelExtraExamDates(prev => ({
                                  ...prev,
                                  [selectedLevel]: [...new Set([...(prev[selectedLevel] || []), newDate])].sort()
                                }));
                              }
                            }
                          });
                        }}
                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-white/80 transition-opacity z-10"
                      >
                        <Plus className="w-6 h-6 text-blue-600" />
                        <span className="text-xs font-bold text-blue-600 mr-2">إضافة يوم</span>
                      </button>
                    )}
                  </th>
                  {specialties.filter(s => s.levelId === selectedLevel).map((spec) => {
                    // Find the time for this specialty
                    const specExams = examSessions.filter(s => s.specialtyId === spec.id && s.semester === selectedSemester);
                    const specTime = specExams.length > 0 ? specExams[0].time : '09:50 - 11:20';

                    return (
                      <th key={spec.id} className="p-4 text-center border-l-2 border-black min-w-[220px] bg-white">
                        <div 
                          className="text-sm font-bold text-black mb-3 cursor-pointer hover:underline flex items-center justify-center gap-1 group"
                          onClick={() => {
                            if (!isAdmin && !isViceAdmin) return;
                            setPromptValue(specTime);
                            setPromptConfig({
                              show: true,
                              title: 'اختر التوقيت الجديد:',
                              defaultValue: specTime,
                              type: 'select',
                              options: EXAM_TIMES,
                              showApplyAll: true,
                              onConfirm: (newTime, applyToLevel) => {
                                if (newTime && newTime !== specTime) {
                                  handleUpdateTimeForSpecialty(spec.id, newTime, applyToLevel ? 'level' : 'specialty');
                                }
                              }
                            });
                          }}
                        >
                          {specTime}
                          <Clock className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="inline-block px-2 py-0.5 bg-yellow-300 text-black text-sm font-bold border-b-2 border-black">
                          {spec.name}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const extraForLevel = levelExtraExamDates[selectedLevel] || [];
                  return currentLevelExamDates.map(date => {
                  const dateObj = new Date(date);
                  const dayName = dateObj.toLocaleDateString('ar-DZ', { weekday: 'long' });
                  const formattedDate = date.split('-').reverse().join('/');
                  const isExtra = extraForLevel.includes(date);
                  const existingDatesInState = Array.from(new Set(examSessions.filter(s => s.semester === selectedSemester).map(s => s.date)));
                  const hasExamsOnThisDate = existingDatesInState.includes(date);
                  
                  return (
                    <tr key={date} className="border-b-2 border-black last:border-0">
                      <td className="p-4 bg-white border-l-2 border-black text-center align-middle relative group">
                        <div className="font-bold text-black text-sm whitespace-nowrap flex items-center justify-center gap-2">
                          {dayName} &nbsp; {formattedDate}
                          {(isAdmin || isViceAdmin) && (
                            <div className="flex gap-1">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const specsInThisLevel = specialties.filter(s => s.levelId === selectedLevel).map(s => s.id);
                                  const affectedExams = examSessions.filter(s => s.date === date && specsInThisLevel.includes(s.specialtyId));
                                  
                                  setConfirmState({
                                    show: true,
                                    title: 'حذف يوم الامتحان',
                                    message: affectedExams.length > 0 
                                      ? `هذا اليوم يحتوي على ${affectedExams.length} امتحانات لهذا المستوى. هل أنت متأكد من حذف اليوم وجميع امتحاناته؟`
                                      : 'هل أنت متأكد من حذف هذا اليوم؟',
                                    type: 'danger',
                                    onConfirm: async () => {
                                      setConfirmState(prev => ({ ...prev, show: false }));
                                      if (affectedExams.length > 0) {
                                        const toastId = toast.loading('جاري حذف الامتحانات...');
                                        try {
                                          const deletePromises = affectedExams.map(exam => deleteDoc(doc(db, 'examSessions', exam.id)));
                                          await Promise.all(deletePromises);
                                          setExamSessions(prev => prev.filter(e => !affectedExams.some(ae => ae.id === e.id)));
                                          toast.success('تم حذف اليوم والامتحانات بنجاح', { id: toastId });
                                        } catch (err) {
                                          console.error('Delete exams failed:', err);
                                          toast.error('فشل حذف الامتحانات', { id: toastId });
                                        }
                                      }
                                      
                                      const newLevelDates = {
                                        ...levelExtraExamDates,
                                        [selectedLevel]: (levelExtraExamDates[selectedLevel] || []).filter(d => d !== date)
                                      };
                                      setLevelExtraExamDates(newLevelDates);
                                      await setDoc(doc(db, 'settings', 'examDates'), { levelExtraExamDates: newLevelDates }, { merge: true });
                                    }
                                  });
                                }}
                                className="p-1 hover:bg-red-50 text-red-400 hover:text-red-600 rounded-lg transition-all"
                                title="حذف اليوم"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPromptValue(date);
                                  setPromptConfig({
                                    show: true,
                                    title: 'تعديل التاريخ:',
                                    defaultValue: date,
                                    type: 'date',
                                    onConfirm: async (newDate) => {
                                      if (newDate && !isNaN(Date.parse(newDate)) && newDate !== date) {
                                        const specsInThisLevel = specialties.filter(s => s.levelId === selectedLevel).map(s => s.id);
                                        const examsToUpdate = examSessions.filter(s => s.date === date && specsInThisLevel.includes(s.specialtyId));
                                        
                                        const toastId = toast.loading('جاري تحديث التاريخ...');
                                        try {
                                          if (examsToUpdate.length > 0) {
                                            const updatePromises = examsToUpdate.map(exam => 
                                              updateDoc(doc(db, 'examSessions', exam.id), { date: newDate })
                                            );
                                            await Promise.all(updatePromises);
                                            
                                            // Update local examSessions state
                                            setExamSessions(prev => prev.map(e => 
                                              examsToUpdate.some(ae => ae.id === e.id) 
                                                ? { ...e, date: newDate } 
                                                : e
                                            ));
                                          }

                                          const newLevelDates = {
                                            ...levelExtraExamDates,
                                            [selectedLevel]: (levelExtraExamDates[selectedLevel] || []).map(d => d === date ? newDate : d)
                                          };
                                          setLevelExtraExamDates(newLevelDates);
                                          await setDoc(doc(db, 'settings', 'examDates'), { levelExtraExamDates: newLevelDates }, { merge: true });
                                          
                                          toast.success('تم تحديث التاريخ بنجاح', { id: toastId });
                                        } catch (err) {
                                          console.error('Update date failed:', err);
                                          toast.error('فشل تحديث التاريخ', { id: toastId });
                                        }
                                      }
                                    }
                                  });
                                }}
                                className="p-1 hover:bg-blue-50 text-blue-400 hover:text-blue-600 rounded-lg transition-all"
                                title="تعديل التاريخ"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      {specialties.filter(s => s.levelId === selectedLevel).map((spec) => {
                        const sessions = examSessionsMap.get(`${date}-${spec.id}`) || [];
                        
                        return (
                          <td 
                            key={spec.id} 
                            className="p-0 border-l-2 border-black align-top bg-[#fdf2e9] transition-colors hover:bg-[#fae5d3] cursor-pointer h-full"
                            onClick={() => {
                              if (!isAdmin && !isViceAdmin) return;
                              if (sessions.length > 0) {
                                setEditingExam(sessions[0]);
                                setExamDate(sessions[0].date);
                                setExamSpecialty(sessions[0].specialtyId);
                                setExamLevel(selectedLevel || '');
                                setExamMode(sessions[0].mode || 'Simple');
                                setFormExamType(sessions[0].type || 'Regular');
                                setExamTime(sessions[0].time || '');
                                setExamModule(sessions[0].moduleId || '');
                                setExamRooms(sessions[0].roomIds || []);
                                setExamInvigilators(sessions[0].invigilators || []);
                                setRoomAssignments(sessions[0].roomAssignments || [{ roomId: '', invigilators: [], groups: [], studentCount: 0 }]);
                              } else {
                                setEditingExam(null);
                                setExamDate(date);
                                setExamSpecialty(spec.id);
                                setExamLevel(selectedLevel || '');
                                setExamMode('Simple');
                                setFormExamType('Regular');
                                setExamTime('');
                                setExamModule('');
                                setExamRooms([]);
                                setExamInvigilators([]);
                                setRoomAssignments([{ roomId: '', invigilators: [], groups: [], studentCount: 0 }]);
                              }
                              setShowAddModal(true);
                            }}
                          >
                            <div className="p-4 min-h-[160px] h-full w-full flex flex-col">
                              {sessions.map(exam => {
                                const module = modules.find(m => m.id === exam.moduleId || m.name === exam.moduleId);
                                
                                const renderRoomInfo = () => {
                                  if (exam.mode === 'Simple') {
                                    const roomNames = exam.roomIds?.map(id => rooms.find(r => r.id === id || r.name === id)?.name).filter(Boolean).join(' + ') || 'Room --/--';
                                    const invigNames = exam.invigilators?.map(id => {
                                      const t = resolveTeacher(id);
                                      return formatTeacherName(t?.displayName || id);
                                    }).filter(Boolean).sort().join(', ') || '';

                                    return (
                                      <div className="relative h-full min-h-[120px] flex flex-col justify-between">
                                        {/* Teacher: Top Right */}
                                        <div className="absolute top-0 right-0 text-[11px] font-bold text-black text-right max-w-[70%]">
                                          {invigNames}
                                        </div>

                                        {/* Module: Center */}
                                        <div className="flex-1 flex items-center justify-center">
                                          <div className="font-bold text-sm text-black text-center leading-tight mt-4">
                                            {module?.name || 'Unknown Module'}
                                          </div>
                                        </div>

                                          {/* Bottom Row: Room */}
                                          <div className="flex justify-start items-end mt-4">
                                            <div className="text-[11px] font-bold text-black">
                                              {roomNames}
                                            </div>
                                          </div>

                                        {exam.type === 'Resit' && exam.studentCount && exam.studentCount > 0 && (
                                          <div className="absolute top-0 left-0 text-[9px] font-bold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded border border-orange-200">
                                            Resit: {exam.studentCount}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  } else {
                                    return (
                                      <div className="relative h-full min-h-[120px] flex flex-col justify-between gap-4">
                                        {/* Module: Center */}
                                        <div className="flex-1 flex items-center justify-center">
                                          <div className="font-bold text-sm text-black text-center leading-tight">
                                            {module?.name || 'Unknown Module'}
                                          </div>
                                        </div>

                                          {/* Rooms/Groups at Bottom */}
                                          <div className="flex flex-wrap justify-between items-end mt-auto gap-2">
                                            {exam.roomAssignments?.map((ra, idx) => {
                                              const room = rooms.find(r => r.id === ra.roomId || r.name === ra.roomId);
                                              const groupText = ra.groups && ra.groups.length > 0 ? ` (${ra.groups.join(', ')})` : '';
                                              return (
                                                <div 
                                                  key={idx} 
                                                  className="text-[10px] font-bold text-black"
                                                >
                                                  {room?.name}{groupText}
                                                </div>
                                              );
                                            })}
                                          </div>
                                      </div>
                                    );
                                  }
                                };

                                 const conflict = getConflict(exam) as { type: string, name: string } | null;

                                 return (
                                   <div 
                                     key={exam.id} 
                                     className={cn(
                                       "mb-3 p-4 rounded-2xl border transition-all relative group shadow-sm hover:shadow-lg hover:-translate-y-0.5",
                                       exam.type === 'Regular' ? "bg-white border-slate-200" : "bg-orange-50 border-orange-200",
                                       conflict && "border-red-500 ring-2 ring-red-500/20"
                                     )}
                                     onClick={(e) => {
                                       if (!isAdmin && !isViceAdmin) return;
                                       e.stopPropagation();
                                       setEditingExam(exam);
                                       setExamMode(exam.mode);
                                       setFormExamType(exam.type);
                                       setExamDate(exam.date);
                                       setExamTime(exam.time);
                                       setExamSpecialty(exam.specialtyId);
                                       setExamModule(exam.moduleId);
                                       if (exam.mode === 'Detailed') {
                                         setRoomAssignments(exam.roomAssignments || []);
                                       } else {
                                         setExamRooms(exam.roomIds || []);
                                         setExamInvigilators(exam.invigilators || []);
                                       }
                                       setShowAddModal(true);
                                     }}
                                   >
                                     {conflict && (
                                       <div className="absolute -top-2.5 -right-2.5 bg-red-600 text-white text-[9px] px-2 py-1 rounded-full font-bold shadow-xl z-10 animate-pulse">
                                         تضارب {conflict.type}: {conflict.name}
                                       </div>
                                     )}
                                    <div className="flex justify-end items-start mb-2">
                                      {(isAdmin || isViceAdmin) && (
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSessionToDelete({ id: exam.id, type: 'exam' });
                                            }} 
                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    {renderRoomInfo()}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                });
              })()}
              {(isAdmin || isViceAdmin) && (
                <tr className="border-b-2 border-black last:border-0">
                  <td className="p-4 bg-slate-50 border-l-2 border-black text-center align-middle">
                    <button 
                      onClick={() => {
                        setPromptValue('');
                        setPromptConfig({
                          show: true,
                          title: 'اختر تاريخ اليوم الجديد:',
                          defaultValue: '',
                          type: 'date',
                          onConfirm: async (newDate) => {
                            if (newDate && !isNaN(Date.parse(newDate))) {
                              const newLevelDates = {
                                ...levelExtraExamDates,
                                [selectedLevel]: [...new Set([...(levelExtraExamDates[selectedLevel] || []), newDate])].sort()
                              };
                              setLevelExtraExamDates(newLevelDates);
                              await setDoc(doc(db, 'settings', 'examDates'), { levelExtraExamDates: newLevelDates }, { merge: true });
                            }
                          }
                        });
                      }}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all mx-auto font-bold text-sm shadow-lg shadow-blue-100"
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة يوم</span>
                    </button>
                  </td>
                  {specialties.filter(s => s.levelId === selectedLevel).map((spec) => (
                    <td key={spec.id} className="p-0 border-l-2 border-black bg-slate-50/30"></td>
                  ))}
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )}

      {/* Hall Utilization Grid */}
      {activeTab === 'halls' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="p-4 text-right text-sm font-bold text-slate-500 border-l border-slate-100 w-32">اليوم / الوقت</th>
                  {PERIODS.map(p => (
                    <th key={p} className="p-4 text-center border-l border-slate-100 min-w-[150px]">
                      <div className="text-sm font-bold text-slate-900">{p}</div>
                      <div className="text-[10px] text-slate-500 font-medium">{PERIOD_TIMES[p as keyof typeof PERIOD_TIMES]}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map(day => (
                  <tr key={day} className="border-b border-slate-50 last:border-0">
                    <td className="p-4 bg-slate-50/50 border-l border-slate-100">
                      <span className="font-bold text-slate-700">{DAY_LABELS[day]}</span>
                    </td>
                    {PERIODS.map(period => {
                      const session = getHallSessionsAt(day, period, selectedRoom);
                      const module = modules.find(m => m.id === session?.moduleId || m.name === session?.moduleId);
                      const specialty = specialties.find(s => s.id === session?.specialtyId || s.name === session?.specialtyId);

                      return (
                        <td key={period} className="p-2 border-l border-slate-100 h-32 relative group">
                          {session ? (
                            <div className={cn(
                              "h-full w-full rounded-xl p-3 flex flex-col justify-center text-center border",
                              session.isReserved ? "bg-slate-100 border-slate-200 text-slate-500" : "bg-slate-50 border-slate-100 text-slate-900"
                            )}>
                              <div className="font-bold text-sm">
                                {session.isReserved ? (session.reservedFor || 'محجوزة') : module?.name}
                              </div>
                              {!session.isReserved && <div className="text-[10px] font-medium text-slate-500 mt-1">{specialty?.name}</div>}
                              {(isAdmin || isViceAdmin) && (
                                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                  <button onClick={() => { setEditingSession(session); setShowAddModal(true); }} className="p-1 hover:bg-white rounded-lg text-blue-600"><Edit2 className="w-3 h-3" /></button>
                                  <button onClick={() => setSessionToDelete({ id: session.id, type: 'schedule' })} className="p-1 hover:bg-white rounded-lg text-red-600"><Trash2 className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                          ) : (
                            (isAdmin || isViceAdmin) ? (
                              <button 
                                onClick={() => {
                                  setEditingSession(null);
                                  setFormDay(day);
                                  setFormPeriod(period);
                                  setIsReserved(true);
                                  setFormTeacherId('');
                                  setShowAddModal(true);
                                }}
                                className="h-full w-full rounded-xl border-2 border-dashed border-slate-100 flex items-center justify-center text-slate-300 hover:border-blue-200 hover:text-blue-300 transition-all"
                              >
                                <Plus className="w-6 h-6" />
                              </button>
                            ) : (
                              <div className="h-full w-full flex items-center justify-center text-emerald-500 text-[10px] font-bold uppercase tracking-widest">
                                شاغرة
                              </div>
                            )
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Personal Schedule Grid */}
      {activeTab === 'personal' && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-6">
            {(isAdmin || isViceAdmin) && (
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 flex-1">
                <label className="text-sm font-bold text-slate-700">اختر الأستاذ لعرض جدوله:</label>
                <select 
                  value={selectedTeacherId}
                  onChange={(e) => setSelectedTeacherId(e.target.value)}
                  className="bg-slate-50 border-none rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500 text-sm font-bold min-w-[250px]"
                >
                  {teachers.map(t => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                </select>
              </div>
            )}
            {(isAdmin || isViceAdmin) && (
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
                <label className="text-sm font-bold text-slate-700">تحميل شعار المؤسسة:</label>
                <div className="relative">
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleLogoUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    <span>اختر صورة</span>
                  </div>
                </div>
                {appLogo && (
                  <button 
                    onClick={() => { setAppLogo(null); localStorage.removeItem('appLogo'); }}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between min-w-[1200px]">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                جدول الحصص الأسبوعي ({resolveTeacher(selectedTeacherId)?.displayName || t('loading')})
              </h3>
              <div className="flex gap-2">
                <button 
                  onClick={handleEmailWeeklySchedule}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                  title="إرسال عبر البريد الإلكتروني"
                >
                  <Mail className="w-4 h-4" />
                  <span className="hidden md:inline">إرسال عبر البريد</span>
                </button>
                <button 
                  onClick={async () => {
                    const pdf = await exportPersonalWeeklyPDF();
                    if (pdf) {
                      const teacher = teachers.find(t => t.uid === selectedTeacherId);
                      pdf.save(`Weekly_Schedule_${teacher?.displayName || 'Export'}.pdf`);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                >
                  <Download className="w-4 h-4" />
                  <span>تحميل الجدول الأسبوعي</span>
                </button>
              </div>
            </div>
            <div ref={weeklyScheduleRef} className="p-8 bg-white min-w-[1200px]" dir="ltr">
              <div className="relative mb-8">
                {/* Logo Circles */}
                <div className="absolute left-0 top-0 w-24 h-24 rounded-full border-2 border-slate-200 overflow-hidden flex items-center justify-center bg-slate-50">
                  {appLogo ? (
                    <img src={appLogo} alt="Logo Left" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-400">LOGO</span>
                  )}
                </div>
                <div className="absolute right-0 top-0 w-24 h-24 rounded-full border-2 border-slate-200 overflow-hidden flex items-center justify-center bg-slate-50">
                  {appLogo ? (
                    <img src={appLogo} alt="Logo Right" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-400">LOGO</span>
                  )}
                </div>

                <div className="text-center space-y-1">
                  <div className="text-2xl font-bold">Weekly Class Schedule</div>
                  <div className="text-lg text-slate-500 mt-2">Teacher: {resolveTeacher(selectedTeacherId)?.displayName}</div>
                  <div className="text-sm text-slate-400 font-bold">Semester: {selectedSemester === 'S1' ? 'Semester 1' : 'Semester 2'} | Academic Year: {selectedYear}</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-center text-sm font-bold text-slate-900 border border-slate-200 w-32 whitespace-nowrap">Day / Time</th>
                      {PERIODS.map(p => (
                        <th key={p} className="p-4 text-center border border-slate-200 min-w-[150px] whitespace-nowrap">
                          <div className="text-sm font-bold text-slate-900">{p}</div>
                          <div className="text-[10px] text-slate-500 font-medium">{PERIOD_TIMES[p as keyof typeof PERIOD_TIMES]}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map(day => (
                      <tr key={day} className="border-b border-slate-200 last:border-0">
                        <td className="p-4 bg-slate-50 border border-slate-200 text-center whitespace-nowrap">
                          <span className="font-bold text-slate-700">{day}</span>
                        </td>
                        {PERIODS.map(period => {
                          const sessions = getPersonalSessionsAt(day, period);

                          return (
                            <td key={period} className="p-2 border border-slate-200 h-32 relative group">
                              <div className="flex flex-col gap-2 h-full">
                                {sessions.length > 0 ? (
                                  sessions.map((session, idx) => {
                                    const module = modules.find(m => m.id === session.moduleId || m.name === session.moduleId);
                                    const room = rooms.find(r => r.id === session.roomId || r.name === session.roomId);
                                    const specialty = specialties.find(s => s.id === session.specialtyId || s.name === session.specialtyId);

                                    return (
                                      <div key={idx} className={cn(
                                        "flex-1 rounded-xl p-3 flex flex-col justify-between border relative",
                                        session.isExternal ? "bg-purple-50 border-purple-100 text-purple-900" :
                                        session.isReserved ? "bg-slate-100 border-slate-200 text-slate-500" :
                                        session.type === 'Cours' ? "bg-emerald-50 border-emerald-100" : "bg-blue-50 border-blue-100"
                                      )}>
                                        <div className="text-[10px] font-bold uppercase opacity-60">
                                          {session.isExternal ? t('external') : session.isReserved ? t('reserved') : session.type}
                                        </div>
                                        <div className="font-bold text-xs text-center leading-tight line-clamp-2">
                                          {session.isExternal ? session.externalModuleName : 
                                           session.isReserved ? (session.reservedFor || t('other')) :
                                           module?.name}
                                        </div>
                                        <div className="text-[10px] font-medium text-center opacity-70">
                                          {session.isExternal ? t('external') : 
                                           session.isReserved ? t('reserved') :
                                           `${specialty?.name} | ${room?.name}`}
                                        </div>
                                        {(isAdmin || isViceAdmin) && (
                                          <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                            <button onClick={() => { setEditingSession(session); setShowAddModal(true); }} className="p-1 hover:bg-white rounded-lg text-blue-600"><Edit2 className="w-2 h-2" /></button>
                                            <button onClick={() => setSessionToDelete({ id: session.id, type: 'schedule' })} className="p-1 hover:bg-white rounded-lg text-red-600"><Trash2 className="w-2 h-2" /></button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                ) : (
                                  (isAdmin || isViceAdmin) && (
                                    <button 
                                      onClick={() => {
                                        setEditingSession(null);
                                        setFormDay(day);
                                        setFormPeriod(period);
                                        setFormTeacherId(selectedTeacherId);
                                        setIsExternal(true);
                                        setShowAddModal(true);
                                      }}
                                      className="h-full w-full rounded-xl border-2 border-dashed border-slate-100 flex items-center justify-center text-slate-300 hover:border-blue-200 hover:text-blue-300 transition-all"
                                    >
                                      <Plus className="w-6 h-6" />
                                    </button>
                                  )
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between min-w-[1000px]">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-orange-600" />
                قائمة الحراسة الشخصية
              </h3>
              <div className="flex gap-2">
                <button 
                  onClick={handleEmailInvigilation}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                  title="إرسال عبر البريد الإلكتروني"
                >
                  <Mail className="w-4 h-4" />
                  <span className="hidden md:inline">إرسال عبر البريد</span>
                </button>
                <button 
                  onClick={async () => {
                    const pdf = await exportPersonalInvigilationPDF();
                    if (pdf) {
                      const teacher = teachers.find(t => t.uid === selectedTeacherId);
                      pdf.save(`Invigilation_Schedule_${teacher?.displayName || 'Export'}.pdf`);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl hover:bg-orange-700 transition-all shadow-lg shadow-orange-100"
                >
                  <Download className="w-4 h-4" />
                  <span>تحميل قائمة الحراسة</span>
                </button>
              </div>
            </div>
            <div ref={invigilationRef} className="p-8 bg-white min-w-[1000px]">
              {/* Arabic Header for PDF Capture */}
              <div className="relative mb-8">
                {/* Logo Circles */}
                <div className="absolute left-0 top-0 w-24 h-24 rounded-full border-2 border-slate-200 overflow-hidden flex items-center justify-center bg-slate-50">
                  {appLogo ? (
                    <img src={appLogo} alt="Logo Left" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-400">LOGO</span>
                  )}
                </div>
                <div className="absolute right-0 top-0 w-24 h-24 rounded-full border-2 border-slate-200 overflow-hidden flex items-center justify-center bg-slate-50">
                  {appLogo ? (
                    <img src={appLogo} alt="Logo Right" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-slate-400">LOGO</span>
                  )}
                </div>

                <div className="text-center space-y-1">
                  <div className="font-bold text-lg">الجمهوريـة الجزائرية الديمقراطية الشعبية</div>
                  <div className="font-bold text-lg">وزارة التعليم العــالي و البحث العلمي</div>
                  <div className="font-bold text-lg">جــامعة عمـار ثليجي – الأغــواط</div>
                  <div className="font-bold text-lg">كلية التكنولوجيا</div>
                  <div className="font-bold text-lg">قسم الهندسة الميكانيكية</div>
                  <div className="h-0.5 bg-black w-full my-4"></div>
                  <div className="text-xl font-bold mt-6">
                    استدعاء للأستاذ (ة) الفاضل (ة): {resolveTeacher(selectedTeacherId)?.displayName}
                  </div>
                  <div className="text-2xl font-bold mt-4 underline">جدول الحراسة - {selectedSemester === 'S1' ? 'السداسي الأول' : 'السداسي الثاني'}</div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="p-4 text-right text-sm font-bold text-slate-900 border border-slate-200 whitespace-nowrap">التاريخ</th>
                      <th className="p-4 text-right text-sm font-bold text-slate-900 border border-slate-200 whitespace-nowrap">التوقيت</th>
                      <th className="p-4 text-right text-sm font-bold text-slate-900 border border-slate-200 whitespace-nowrap">المقياس</th>
                      <th className="p-4 text-right text-sm font-bold text-slate-900 border border-slate-200 whitespace-nowrap">القاعة</th>
                      <th className="p-4 text-right text-sm font-bold text-slate-900 border border-slate-200 whitespace-nowrap">التخصص</th>
                    </tr>
                  </thead>
                  <tbody>
                    {examSessions.filter(s => {
                      const isAssigned = s.mode === 'Simple' 
                        ? s.invigilators?.includes(selectedTeacherId || '')
                        : s.roomAssignments?.some(ra => ra.invigilators.includes(selectedTeacherId || ''));
                      return isAssigned && s.semester === selectedSemester;
                    })
                    .sort((a, b) => {
                      const dateComp = (a.date || '').localeCompare(b.date || '');
                      if (dateComp !== 0) return dateComp;
                      return (a.time || '').localeCompare(b.time || '');
                    })
                    .map(exam => {
                      const module = modules.find(m => m.id === exam.moduleId);
                      const specialty = specialties.find(s => s.id === (exam.specialtyId || module?.specialtyId));
                      
                      let roomInfo = '';
                      const mode = exam.mode || (exam.roomAssignments && exam.roomAssignments.length > 0 ? 'Detailed' : 'Simple');
                      
                      if (mode === 'Simple') {
                        roomInfo = exam.roomIds?.map(id => rooms.find(r => r.id === id)?.name).filter(Boolean).join(' + ') || '';
                      } else {
                        const myAssignment = exam.roomAssignments?.find(ra => ra.invigilators.includes(selectedTeacherId || ''));
                        const room = rooms.find(r => r.id === myAssignment?.roomId);
                        roomInfo = room ? `${room.name}${myAssignment?.groups?.length ? ` (${myAssignment.groups.join(', ')})` : ''}` : '';
                      }

                      return (
                        <tr key={exam.id} className="border-b border-slate-200 last:border-0">
                          <td className="p-4 font-bold text-slate-900 border border-slate-200 whitespace-nowrap">{exam.date}</td>
                          <td className="p-4 text-blue-600 font-medium border border-slate-200 whitespace-nowrap">{exam.time}</td>
                          <td className="p-4 font-bold text-slate-700 border border-slate-200 whitespace-nowrap">{module?.name}</td>
                          <td className="p-4 text-slate-600 border border-slate-200 whitespace-nowrap">{roomInfo}</td>
                          <td className="p-4 text-slate-500 border border-slate-200 whitespace-nowrap">{specialty?.name}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-12 flex justify-between items-start px-8">
                <div className="text-sm font-bold">
                  الأغواط في: {new Date().toLocaleDateString('fr-FR')}
                </div>
                <div className="text-center">
                  <div className="font-bold text-lg mb-12">رئيس القسم</div>
                  <div className="w-48 h-0.5 bg-slate-200 mx-auto"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden my-auto">
            <div key={activeTab === 'exams' ? 'exam' : (editingSession?.id || `${formDay}-${formPeriod}`)} className="flex flex-col h-full max-h-[95vh]">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">
                {activeTab === 'exams' 
                  ? (editingExam ? 'تعديل امتحان' : 'إضافة امتحان جديد') 
                  : (editingSession ? 'تعديل حصة' : 'إضافة حصة جديدة')}
              </h2>
              <button 
                onClick={() => {
                  setShowAddModal(false);
                  setEditingSession(null);
                  setEditingExam(null);
                }} 
                className="p-2 hover:bg-white rounded-xl transition-all"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            
            {activeTab === 'semester' || activeTab === 'personal' || activeTab === 'halls' ? (
              <form onSubmit={handleAddSession} className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        name="isExternal" 
                        id="isExternal"
                        checked={isExternal}
                        onChange={(e) => {
                          setIsExternal(e.target.checked);
                          if (e.target.checked) {
                            setIsReserved(false);
                            setIsST(false);
                          }
                        }}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <label htmlFor="isExternal" className="text-sm font-bold text-slate-700">مقياس خارجي</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        name="isReserved" 
                        id="isReserved"
                        checked={isReserved}
                        onChange={(e) => {
                          setIsReserved(e.target.checked);
                          if (e.target.checked) {
                            setIsExternal(false);
                            setIsST(false);
                          }
                        }}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <label htmlFor="isReserved" className="text-sm font-bold text-slate-700">قاعة محجوزة</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        name="isST" 
                        id="isST"
                        checked={isST}
                        onChange={(e) => {
                          setIsST(e.target.checked);
                          if (e.target.checked) {
                            setIsExternal(false);
                            setIsReserved(false);
                          }
                        }}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <label htmlFor="isST" className="text-sm font-bold text-slate-700">مقياس ST</label>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">المقياس / اسم الحجز</label>
                    <div className="flex flex-col gap-2">
                      {!isReserved && !isExternal && (
                        <select 
                          name="moduleId" 
                          defaultValue={editingSession?.moduleId} 
                          required={!isReserved && !isExternal}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900"
                        >
                          <option value="" className="text-slate-900">اختر المقياس</option>
                          {filteredModules.map(m => <option key={m.id} value={m.id} className="text-slate-900">{m.name}</option>)}
                        </select>
                      )}
                      {isExternal && (
                        <input 
                          type="text" 
                          name="externalModuleName" 
                          placeholder="اسم المقياس الخارجي"
                          required={isExternal}
                          defaultValue={editingSession?.externalModuleName}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900"
                        />
                      )}
                      {isReserved && (
                        <input 
                          type="text" 
                          name="reservedFor" 
                          placeholder="محجوزة لـ (مثلاً: قسم الكهرباء)"
                          required={isReserved}
                          defaultValue={editingSession?.reservedFor}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900"
                        />
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">نوع الحصة</label>
                    <select name="type" defaultValue={editingSession?.type} required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900">
                      <option value="Cours" className="text-slate-900">محاضرة (Cours)</option>
                      <option value="TD" className="text-slate-900">أعمال موجهة (TD)</option>
                      <option value="TP" className="text-slate-900">أعمال تطبيقية (TP)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">الأستاذ</label>
                    <select 
                      name="teacherId" 
                      defaultValue={editingSession?.teacherId || formTeacherId} 
                      required={!isST && !isReserved}
                      disabled={isST || isReserved}
                      className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 disabled:opacity-50"
                    >
                      <option value="" className="text-slate-900">اختر الأستاذ</option>
                      {teachers.map(t => (
                        <option key={t.uid} value={t.uid} className="text-slate-900">
                          {t.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">القاعة</label>
                    <select 
                      name="roomId" 
                      defaultValue={editingSession?.roomId} 
                      required={!isST}
                      disabled={isST}
                      className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 disabled:opacity-50"
                    >
                      <option value="" className="text-slate-900">اختر القاعة</option>
                      {[...rooms].sort((a, b) => {
                        const order = { 'classroom': 1, 'lab': 2, 'amphi': 3 };
                        return (order[a.type as keyof typeof order] || 99) - (order[b.type as keyof typeof order] || 99);
                      }).map(r => (
                        <option key={r.id} value={r.id} className="text-slate-900">
                          {r.name} ({r.type === 'classroom' ? 'أعمال موجهة' : r.type === 'lab' ? 'أعمال تطبيقية' : 'مدرج'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">اليوم</label>
                    <select 
                      name="day" 
                      defaultValue={editingSession?.day || formDay} 
                      required 
                      className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900"
                    >
                      {DAYS.map(d => <option key={d} value={d} className="text-slate-900">{DAY_LABELS[d]}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">الفترة</label>
                    <select 
                      name="period" 
                      defaultValue={editingSession?.period || formPeriod} 
                      required 
                      className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900"
                    >
                      {PERIODS.map(p => <option key={p} value={p} className="text-slate-900">{p} ({PERIOD_TIMES[p as keyof typeof PERIOD_TIMES]})</option>)}
                    </select>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">
                    {editingSession ? 'حفظ التعديلات' : 'إضافة الحصة'}
                  </button>
                  {editingSession && (
                    <button 
                      type="button"
                      onClick={() => setSessionToDelete({ id: editingSession.id, type: 'schedule' })}
                      className="px-6 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-all flex items-center gap-2"
                    >
                      <Trash2 className="w-5 h-5" />
                      <span>حذف</span>
                    </button>
                  )}
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">
                    إلغاء
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleAddExam} className="flex flex-col h-full max-h-[85vh]">
                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                  {/* Mode Toggle */}
                  <div className="flex p-1.5 bg-slate-100 rounded-2xl">
                    <button
                      type="button"
                      onClick={() => setExamMode('Simple')}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                        examMode === 'Simple' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <ClipboardList className="w-4 h-4" />
                      الوضع البسيط
                    </button>
                    <button
                      type="button"
                      onClick={() => setExamMode('Detailed')}
                      className={cn(
                        "flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                        examMode === 'Detailed' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      <ClipboardList className="w-4 h-4" />
                      الوضع التفصيلي
                    </button>
                  </div>

                  {/* Basic Info Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-blue-600">
                      <Calendar className="w-5 h-5" />
                      <h3 className="font-bold">المعلومات الأساسية</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">التخصص</label>
                        <select 
                          required 
                          value={examSpecialty}
                          onChange={(e) => setExamSpecialty(e.target.value)}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="" className="text-slate-900">اختر التخصص</option>
                          {specialties
                            .filter(s => s.levelId === selectedLevel)
                            .map(s => <option key={s.id} value={s.id} className="text-slate-900">{s.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">المقياس</label>
                        <select 
                          name="moduleId" 
                          required 
                          value={examModule}
                          onChange={(e) => {
                            const modId = e.target.value;
                            setExamModule(modId);
                            if (!examTime) {
                              const specExams = examSessions.filter(s => s.specialtyId === examSpecialty && s.semester === selectedSemester);
                              if (specExams.length > 0) setExamTime(specExams[0].time);
                              else {
                                const dateExams = examSessions.filter(s => s.date === examDate);
                                if (dateExams.length > 0) setExamTime(dateExams[0].time);
                              }
                            }
                          }}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="" className="text-slate-900">اختر المقياس</option>
                          {modules
                            .filter(m => m.specialtyId === examSpecialty && m.semester === selectedSemester)
                            .filter(m => {
                              if (editingExam && editingExam.moduleId === m.id) return true;
                              return !examSessions.some(s => 
                                s.moduleId === m.id && 
                                s.semester === selectedSemester && 
                                s.academicYear === selectedYear
                              );
                            })
                            .map(m => <option key={m.id} value={m.id} className="text-slate-900">{m.name}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">نوع الامتحان</label>
                        <select 
                          name="type" 
                          required 
                          value={formExamType}
                          onChange={(e) => setFormExamType(e.target.value as any)}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="Regular" className="text-slate-900">عادي (Regular)</option>
                          <option value="Resit" className="text-slate-900">استدراكي (Resit)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">التاريخ</label>
                        <input 
                          type="date" 
                          name="date" 
                          required 
                          value={examDate}
                          onChange={(e) => setExamDate(e.target.value)}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">التوقيت</label>
                        <input 
                          list="exam-times" 
                          name="time" 
                          placeholder="اختر أو اكتب التوقيت" 
                          required 
                          value={examTime}
                          onChange={(e) => setExamTime(e.target.value)}
                          className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20" 
                        />
                        <datalist id="exam-times">
                          {EXAM_TIMES.map(t => <option key={t} value={t} />)}
                        </datalist>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100">
                      <input 
                        type="checkbox" 
                        id="applyTimeToLevel"
                        checked={applyTimeToLevel}
                        onChange={(e) => setApplyTimeToLevel(e.target.checked)}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                      />
                      <label htmlFor="applyTimeToLevel" className="text-xs font-bold text-blue-700 cursor-pointer">
                        تعميم هذا التوقيت على جميع تخصصات المستوى
                      </label>
                    </div>
                  </div>

                  {/* Conflict Alert */}
                  {(() => {
                    const conflict = getConflict({
                      id: editingExam?.id,
                      date: examDate,
                      time: examTime,
                      specialtyId: examSpecialty,
                      moduleId: examModule,
                      semester: selectedSemester,
                      mode: examMode,
                      roomIds: examRooms,
                      invigilators: examInvigilators,
                      roomAssignments: roomAssignments
                    }) as { type: string, name: string, isSameTime: boolean } | null;

                    if (conflict) {
                      return (
                        <div className={cn(
                          "p-4 border rounded-2xl flex items-start gap-3",
                          conflict.isSameTime ? "bg-red-50 border-red-200 animate-pulse" : "bg-orange-50 border-orange-200"
                        )}>
                          <AlertTriangle className={cn("w-5 h-5 mt-0.5", conflict.isSameTime ? "text-red-600" : "text-orange-600")} />
                          <div>
                            <h4 className={cn("font-bold text-sm", conflict.isSameTime ? "text-red-900" : "text-orange-900")}>
                              {conflict.isSameTime ? 'تنبيه تضارب!' : 'تنبيه: حراسة إضافية'}
                            </h4>
                            <p className={cn("text-xs mt-1", conflict.isSameTime ? "text-red-700" : "text-orange-700")}>
                              {conflict.isSameTime 
                                ? `يوجد تضارب من نوع (${conflict.type}) مع: ${conflict.name} في نفس التوقيت.`
                                : `الأستاذ ${conflict.name} لديه حراسة أخرى في نفس اليوم بنجاح.`}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Room & Invigilators Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-orange-600">
                      <MapPin className="w-5 h-5" />
                      <h3 className="font-bold">توزيع القاعات والحراسة</h3>
                    </div>

                    {examMode === 'Simple' ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">القاعات</label>
                            <div className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 h-48 overflow-y-auto space-y-1 custom-scrollbar">
                              {[...rooms].sort((a, b) => {
                                const order = { 'classroom': 1, 'lab': 2, 'amphi': 3 };
                                return (order[a.type as keyof typeof order] || 99) - (order[b.type as keyof typeof order] || 99);
                              }).map(r => (
                                <label key={r.id} className={cn(
                                  "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all border border-transparent",
                                  examRooms.includes(r.id) ? "bg-blue-50 border-blue-100" : "hover:bg-white hover:border-slate-200"
                                )}>
                                  <input 
                                    type="checkbox"
                                    checked={examRooms.includes(r.id)}
                                    onChange={() => {
                                      setExamRooms(prev => 
                                        prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id]
                                      );
                                    }}
                                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                  />
                                  <div className="flex flex-col">
                                    <span className="text-sm text-slate-700 font-bold">{r.name}</span>
                                    <span className="text-[10px] text-slate-400 capitalize">
                                      {r.type === 'classroom' ? 'أعمال موجهة' : r.type === 'lab' ? 'أعمال تطبيقية' : 'مدرج'}
                                    </span>
                                  </div>
                                </label>
                              ))}
                            </div>
                            <p className="text-[10px] text-slate-400">يمكنك اختيار قاعة واحدة أو أكثر</p>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">الأساتذة الحراس</label>
                            <div className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 h-48 overflow-y-auto space-y-1 custom-scrollbar">
                              {teachers.map(t => {
                                const count = getTeacherExamCount(t.uid);
                                const dayCount = getTeacherDayExamCount(t.uid, examDate);
                                const isSelected = examInvigilators.includes(t.uid);
                                return (
                                  <label key={t.uid} className={cn(
                                    "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all border border-transparent",
                                    isSelected ? "bg-blue-50 border-blue-100" : "hover:bg-white hover:border-slate-200"
                                  )}>
                                    <input 
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setExamInvigilators(prev => 
                                          prev.includes(t.uid) ? prev.filter(id => id !== t.uid) : [...prev, t.uid]
                                        );
                                      }}
                                      className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                    />
                                    <div className="flex flex-col">
                                      <span className={cn("text-sm font-bold", (count >= 4 || dayCount > 0) ? "text-red-600" : "text-slate-700")}>
                                        {t.displayName}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-400">
                                          الفصل: {count}
                                        </span>
                                        {dayCount > 0 && (
                                          <span className="text-[10px] text-orange-500 font-bold">
                                            اليوم: {dayCount}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                            <p className="text-[10px] text-slate-400">يمكنك اختيار أكثر من أستاذ</p>
                          </div>
                        </div>

                        {formExamType === 'Resit' && (
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">عدد الطلبة الراسبين</label>
                            <input 
                              type="number" 
                              name="studentCount" 
                              placeholder="مثلاً: 15" 
                              defaultValue={editingExam?.studentCount || ''}
                              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20" 
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-bold text-slate-700">تعيينات القاعات</label>
                          <button
                            type="button"
                            onClick={() => setRoomAssignments([...roomAssignments, { roomId: '', invigilators: [], groups: [], studentCount: 0 }])}
                            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100"
                          >
                            <Plus className="w-3 h-3" />
                            إضافة قاعة
                          </button>
                        </div>
                        
                        <div className="space-y-4">
                          {roomAssignments.map((ra, idx) => (
                            <div key={idx} className="p-5 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-4 relative group/item">
                              {roomAssignments.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setRoomAssignments(roomAssignments.filter((_, i) => i !== idx))}
                                  className="absolute top-4 left-4 text-slate-300 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              )}
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="text-xs font-bold text-slate-400 uppercase">القاعة</label>
                                  <select
                                    value={ra.roomId}
                                    onChange={(e) => {
                                      const newRa = [...roomAssignments];
                                      newRa[idx].roomId = e.target.value;
                                      setRoomAssignments(newRa);
                                    }}
                                    required
                                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-2.5 text-sm text-slate-900"
                                  >
                                    <option value="">اختر القاعة</option>
                                    {[...rooms].sort((a, b) => {
                                      const order = { 'classroom': 1, 'lab': 2, 'amphi': 3 };
                                      return (order[a.type as keyof typeof order] || 99) - (order[b.type as keyof typeof order] || 99);
                                    }).map(r => (
                                      <option key={r.id} value={r.id}>
                                        {r.name} ({r.type === 'classroom' ? 'أعمال موجهة' : r.type === 'lab' ? 'أعمال تطبيقية' : 'مدرج'})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-bold text-slate-400 uppercase">الأفواج (G1, G2...)</label>
                                  <input
                                    type="text"
                                    placeholder="مثال: G1, G2"
                                    value={ra.groups?.join(', ')}
                                    onChange={(e) => {
                                      const newRa = [...roomAssignments];
                                      newRa[idx].groups = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                      setRoomAssignments(newRa);
                                    }}
                                    className="w-full bg-slate-50 border-none rounded-xl px-4 py-2.5 text-sm text-slate-900"
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase">الحراس لهذه القاعة</label>
                                <div className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 h-32 overflow-y-auto space-y-1 custom-scrollbar">
                                  {teachers.map(t => {
                                    const count = getTeacherExamCount(t.uid);
                                    const dayCount = getTeacherDayExamCount(t.uid, examDate);
                                    const isSelected = ra.invigilators.includes(t.uid);
                                    return (
                                      <label key={t.uid} className={cn(
                                        "flex items-center gap-3 p-1.5 rounded-lg cursor-pointer transition-all border border-transparent",
                                        isSelected ? "bg-blue-50 border-blue-100" : "hover:bg-white hover:border-slate-200"
                                      )}>
                                        <input 
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => {
                                            const newRa = [...roomAssignments];
                                            const currentInvigs = newRa[idx].invigilators || [];
                                            newRa[idx].invigilators = currentInvigs.includes(t.uid)
                                              ? currentInvigs.filter(id => id !== t.uid)
                                              : [...currentInvigs, t.uid];
                                            setRoomAssignments(newRa);
                                          }}
                                          className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                        />
                                        <div className="flex flex-col">
                                          <span className={cn("text-xs font-bold", (count >= 4 || dayCount > 0) ? "text-red-600" : "text-slate-700")}>
                                            {t.displayName}
                                          </span>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[9px] text-slate-400">
                                              الفصل: {count}
                                            </span>
                                            {dayCount > 0 && (
                                              <span className="text-[9px] text-orange-500 font-bold">
                                                اليوم: {dayCount}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                  <button type="submit" className="flex-1 bg-blue-600 text-white py-3.5 rounded-2xl font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
                    {editingExam ? 'تحديث الامتحان' : 'إضافة الامتحان'}
                  </button>
                  {editingExam && (
                    <button 
                      type="button"
                      onClick={() => setSessionToDelete({ id: editingExam.id, type: 'exam' })}
                      className="px-6 bg-red-50 text-red-600 rounded-2xl font-black hover:bg-red-100 transition-all flex items-center gap-2"
                    >
                      <Trash2 className="w-5 h-5" />
                      <span>حذف</span>
                    </button>
                  )}
                  <button 
                    type="button" 
                    onClick={() => {
                      setShowAddModal(false);
                      setEditingExam(null);
                    }} 
                    className="flex-1 bg-white border border-slate-200 text-slate-600 py-3.5 rounded-2xl font-black hover:bg-slate-50 transition-all"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Custom Prompt Modal */}
    {promptConfig.show && (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-slate-900">{promptConfig.title}</h3>
          
          {promptConfig.type === 'select' ? (
            <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto p-1">
              {promptConfig.options?.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    promptConfig.onConfirm(option);
                    setPromptConfig(prev => ({ ...prev, show: false }));
                  }}
                  className={`w-full text-right px-4 py-3 rounded-xl font-bold transition-all ${
                    promptValue === option 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {option}
                </button>
              ))}
              <div className="mt-2 pt-2 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-2">أو أدخل توقيت مخصص:</p>
                <input 
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder="مثال: 08:00 - 09:30"
                  className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          ) : (
            <input 
              type={promptConfig.type}
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  promptConfig.onConfirm(promptValue, false);
                  setPromptConfig(prev => ({ ...prev, show: false }));
                }
                if (e.key === 'Escape') {
                  setPromptConfig(prev => ({ ...prev, show: false }));
                }
              }}
            />
          )}

          <div className="flex gap-3">
            <button 
              onClick={() => {
                promptConfig.onConfirm(promptValue, false);
                setPromptConfig(prev => ({ ...prev, show: false }));
              }}
              className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all"
            >
              تأكيد
            </button>
            {promptConfig.showApplyAll && (
              <button 
                onClick={() => {
                  promptConfig.onConfirm(promptValue, true);
                  setPromptConfig(prev => ({ ...prev, show: false }));
                }}
                className="flex-1 bg-amber-600 text-white py-3 rounded-xl font-bold hover:bg-amber-700 transition-all"
              >
                تعميم على المستوى
              </button>
            )}
            <button 
              onClick={() => setPromptConfig(prev => ({ ...prev, show: false }))}
              className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    )}

    {/* General Confirmation Modal */}
    {confirmState.show && (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-8 space-y-6 text-center">
          <div className={cn(
            "w-20 h-20 rounded-full flex items-center justify-center mx-auto",
            confirmState.type === 'danger' ? "bg-red-50" : confirmState.type === 'warning' ? "bg-amber-50" : "bg-blue-50"
          )}>
            {confirmState.type === 'danger' ? (
              <Trash2 className="w-10 h-10 text-red-600" />
            ) : confirmState.type === 'warning' ? (
              <AlertTriangle className="w-10 h-10 text-amber-600" />
            ) : (
              <ShieldCheck className="w-10 h-10 text-blue-600" />
            )}
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">{confirmState.title}</h3>
            <p className="text-slate-500 mt-2">
              {confirmState.message}
            </p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={(e) => {
                e.preventDefault();
                setConfirmState(prev => ({ ...prev, show: false }));
                confirmState.onConfirm();
              }}
              className={cn(
                "flex-1 text-white py-3 rounded-xl font-bold transition-all",
                confirmState.type === 'danger' ? "bg-red-600 hover:bg-red-700" : confirmState.type === 'warning' ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              تأكيد
            </button>
            <button 
              onClick={() => setConfirmState(prev => ({ ...prev, show: false }))}
              className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Delete Confirmation Modal */}
    {sessionToDelete && (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 space-y-6 text-center">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <Trash2 className="w-10 h-10 text-red-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">تأكيد الحذف</h3>
            <p className="text-slate-500 mt-2">
              هل أنت متأكد من حذف هذه {sessionToDelete.type === 'exam' ? 'الامتحان' : 'الحصة'}؟ لا يمكن التراجع عن هذه العملية.
            </p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => handleDeleteSession(sessionToDelete.id)}
              className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all"
            >
              تأكيد الحذف
            </button>
            <button 
              onClick={() => setSessionToDelete(null)}
              className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    )}
    {/* Import PDF Modal */}
    {showImporter && (
      <PDFScheduleImporter 
        onClose={() => setShowImporter(false)}
        academicYear={selectedYear}
        modules={modules}
        teachers={teachers}
        rooms={rooms}
        specialties={specialties}
        type={activeTab === 'exams' ? 'exams' : 'semester'}
        selectedLevelId={selectedLevel}
        selectedLevelName={levels.find(l => l.id === selectedLevel)?.name}
      />
    )}
  </div>
);
}
