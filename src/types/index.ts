export type UserRole = 'admin' | 'vice_admin' | 'specialty_manager' | 'teacher';
export type Rank = 'Pr' | 'MCA' | 'MCB' | 'MAA' | 'MAB' | 'Vacataire';
export type EmploymentType = 'internal' | 'external' | 'temporary';
export type CycleType = 'Licence' | 'Master' | 'Engineer' | 'Doctorate' | 'ليسانس' | 'ماستر' | 'مهندس';
export type SessionType = 'Cours' | 'TD' | 'TP';
export type ProjectStatus = 'Proposed' | 'Validated' | 'Distributed' | 'InProgress' | 'Ready' | 'Defended' | 'Completed';
export type ProjectStage = 'Start' | 'References' | 'Theory' | 'Practical' | 'Writing' | 'Ready';
export type ProblemType = 'No Response' | 'Absence' | 'Delay' | 'Technical' | 'Data Lack' | 'Other';
export type AbandonmentReason = 'No Commitment' | 'Repeated Absence' | 'Interruption' | 'Work Pressure' | 'Administrative' | 'Other';

export interface User {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  rank?: Rank;
  employmentType?: EmploymentType;
  specialtyId?: string;
  specialtyIds?: string[]; // For specialty managers managing multiple levels
  appointmentDate?: string;
  appointmentEndDate?: string;
  isRenewed?: boolean;
  phoneNumber?: string;
  createdAt: string;
  isActive?: boolean;
  username?: string;
  password?: string;
  lastEmailSent?: string | null;
  photoURL?: string;
}

export interface MonthlyHours {
  month: string;
  hours: number;
}

export interface OvertimeRequest {
  id: string;
  teacherId: string;
  semester: 'S1' | 'S2';
  weeklyQuota: number;
  actualWeeklyHours: number;
  monthlyBreakdown: MonthlyHours[];
  totalOvertimeHours: number;
  status: 'Pending' | 'Approved' | 'Rejected';
  academicYear: string;
  createdAt: string;
  notes?: string;
}

export interface Cycle {
  id: string;
  name: CycleType;
}

export interface Level {
  id: string;
  name: string;
  cycleId: string;
}

export interface Specialty {
  id: string;
  name: string;
  field?: string;
  levelId: string;
  managerId?: string;
}

export interface Module {
  id: string;
  name: string;
  specialtyId: string;
  semester: 'S1' | 'S2';
  credits?: number;
  coefficient?: number;
  academicYear: string;
  progress?: number; // Progress percentage (0-100)
  teacherId?: string; // Main teacher assigned
  isST?: boolean; // Is it an ST (Tronc Commun) module?
}

export interface Room {
  id: string;
  name: string;
  type: 'classroom' | 'lab' | 'amphi';
  capacity: number;
}

export interface ScheduleSession {
  id: string;
  moduleId: string;
  teacherId: string;
  roomId: string;
  specialtyId: string;
  semester: 'S1' | 'S2';
  day: 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday';
  period: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6';
  type: SessionType;
  academicYear: string;
  isExternal?: boolean; // For personal schedule (modules outside department)
  externalModuleName?: string;
  isReserved?: boolean; // For room utilization (reserved for other department)
  reservedFor?: string;
}

export interface RoomAssignment {
  roomId: string;
  invigilators: string[]; // teacherIds
  groups?: string[]; // e.g., ["Group 1", "Group 2"]
  studentCount?: number;
}

export interface ExamSession {
  id: string;
  moduleId: string;
  specialtyId: string;
  semester: 'S1' | 'S2';
  date: string;
  time: string;
  mode: 'Simple' | 'Detailed';
  // For Simple Mode
  roomIds?: string[]; 
  invigilators?: string[]; 
  studentCount?: number; // Only for Resit (failed students)
  // For Detailed Mode
  roomAssignments?: RoomAssignment[];
  type: 'Regular' | 'Resit';
  academicYear: string;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  students: string[];
  supervisorId: string;
  coSupervisorId?: string;
  specialtyId: string;
  levelId: string;
  progress: number;
  status: ProjectStatus;
  stage: ProjectStage;
  isDecision1275: boolean;
  academicYear: string;
  fieldVisits?: {
    date: string;
    location: string;
    description: string;
    createdAt: string;
  }[];
  stages?: {
    name: string;
    status: 'Pending' | 'InProgress' | 'Completed';
    date?: string;
  }[];
  defenseInfo?: {
    proposedDate?: string;
    proposedTime?: string;
    confirmedDate?: string;
    confirmedTime?: string;
    roomId?: string;
    presidentId?: string;
    examinerIds?: string[];
    status: 'Proposed' | 'Confirmed' | 'Completed';
    thesisUrl?: string;
  };
  problems?: {
    id: string;
    type: ProblemType;
    description: string;
    date: string;
    createdAt: string;
  }[];
  abandonmentRequest?: {
    reason: AbandonmentReason;
    date: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    notes?: string;
    createdAt: string;
  };
  createdAt: string;
}

export interface SessionLog {
  id: string;
  scheduleSessionId: string;
  date: string;
  status: 'taught' | 'student_absence' | 'technical_problem' | 'internship';
  comment?: string;
  teacherId: string;
  moduleId?: string;
  content?: string;
  academicYear: string;
}

export type CalendarEventType = 
  | 'holiday' 
  | 'exam_s1' 
  | 'exam_s2' 
  | 'review' 
  | 'deliberation' 
  | 'resit_s1' 
  | 'resit_s2' 
  | 'thesis_submission' 
  | 'thesis_defense' 
  | 'final_deliberation' 
  | 'certificates' 
  | 'master_app';

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  type: CalendarEventType;
}

export interface PedagogicalCalendar {
  id: string;
  academicYear: string;
  s1Start: string;
  s1End: string;
  s2Start: string;
  s2End: string;
  excludedDays?: string[]; // Keep for backward compatibility
  events?: CalendarEvent[];
}

export interface CertificateRequest {
  id: string;
  teacherId: string;
  type: 'Teaching' | 'Supervision';
  status: 'Pending' | 'Approved' | 'Rejected';
  academicYear: string;
  createdAt: string;
  // For Teaching Certificate
  teachingData?: {
    dateOfBirth: string;
    placeOfBirth: string;
    years: {
      year: string;
      moduleName: string;
      type: SessionType;
      cycleId?: string;
      levelId?: string;
      specialtyId?: string;
    }[];
  };
  // For Supervision Certificate
  supervisionData?: {
    projectId: string;
    projectTitle: string;
    students: string[];
    academicYear: string;
  };
}

export interface Student {
  id: string;
  name: string;
  registrationNumber?: string;
  specialtyId: string;
  levelId: string;
  cycleId: string;
  createdAt: string;
  academicYear: string;
}

export interface DepartmentStats {
  id: string;
  date: string;
  academicYear: string;
  
  // Student Stats
  totalStudents: number;
  internationalStudents: number;
  
  // Licence Stats
  licenceStudents: number;
  licenceGroups: number;
  licenceCours: number;
  licenceTD: number;
  licenceTP: number;
  
  // Engineer Stats
  engineerStudents: number;
  engineerGroups: number;
  engineerCours: number;
  engineerTD: number;
  engineerTP: number;
  
  // Master Stats
  masterStudents: number;
  masterGroups: number;
  masterCours: number;
  masterTD: number;
  masterTP: number;
  
  // Teacher Stats (by Rank)
  assistantProfessors: number; // MAA + MAB
  lecturersB: number; // MCB
  lecturersA: number; // MCA
  professors: number; // Pr
  temporaryTeachers: number; // Vacataire
  
  // Internal vs External breakdown
  internalTeachersCount: number;
  externalTeachersCount: number;
  
  // Detailed Rank Breakdown (Internal)
  internalAssistantProfs: number;
  internalLecturersB: number;
  internalLecturersA: number;
  internalProfessors: number;

  // Detailed Rank Breakdown (External)
  externalAssistantProfs: number;
  externalLecturersB: number;
  externalLecturersA: number;
  externalProfessors: number;
  
  // Temporary Teacher Load
  temporaryCours: number;
  temporaryTD: number;
  temporaryTP: number;
  temporaryFirstYearCours: number;
  
  // Failure Rates
  failureRatePerYear: Record<string, number>; // e.g., {"L1": 20, "L2": 15...}
  
  // Infrastructure
  amphisUsed: number;
  tdRoomsUsed: number;
  tpRoomsUsed: number;
  tpComputers: number;
  labSeats: number;
  consumableSatisfaction: number; // Percentage
  
  // Curriculum
  teachesAI: boolean;
  teachesEntrepreneurship: boolean;
  englishModulesCount: number;
  remoteLessonsCount: number;
  
  // Staff
  itEngineersCount: number;
  itTechniciansCount: number;
  adminStaffCount: number;
  createdAt: string;
}

export interface FieldVisit {
  id: string;
  teacherId: string;
  destination: string;
  moduleId: string;
  specialtyId: string;
  levelId: string;
  proposedDate: string;
  studentCount: number;
  supervisors: string[]; // List of names or teacher IDs
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
  academicYear: string;
}

export interface TeacherReport {
  id: string;
  teacherId: string;
  type: 'Problem' | 'Request' | 'Other';
  subject: string;
  content: string;
  status: 'Pending' | 'InProgress' | 'Resolved';
  response?: string;
  academicYear: string;
  createdAt: string;
}

