import React, { useState, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useAcademicYear } from './contexts/AcademicYearContext';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import TeacherManagement from './components/TeacherManagement';
import SessionLogging from './components/SessionLogging';
import ProjectManagement from './components/ProjectManagement';
import SpecialtyManagement from './components/SpecialtyManagement';
import RoomManagement from './components/RoomManagement';
import AcademicStructure from './components/AcademicStructure';
import Schedules from './components/Schedules';
import PedagogicalCalendarManager from './components/PedagogicalCalendar';
import DepartmentStats from './components/DepartmentStats';
import Settings from './components/Settings';
import OvertimeCalc from './components/OvertimeCalc';
import Certificates from './components/Certificates';
import FieldVisits from './components/FieldVisits';
import TeacherReports from './components/TeacherReports';
import { Bell, Search, User as UserIcon, Plus, Archive, MessageSquare } from 'lucide-react';
import { cn } from './lib/utils';
import { seedInitialData } from './lib/seed';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { NotificationProvider } from './contexts/NotificationContext';
import { NotificationCenter } from './components/NotificationCenter';

export default function App() {
  const { user, loading: authLoading, isAdmin, setSimulatedRole, simulatedRole } = useAuth();
  const { selectedYear, setSelectedYear, availableYears, addYear, isYearArchived, loading: yearLoading } = useAcademicYear();
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [promptConfig, setPromptConfig] = useState<{
    show: boolean;
    title: string;
    onConfirm: (value: string) => void;
  }>({
    show: false,
    title: '',
    onConfirm: () => {},
  });
  const [promptValue, setPromptValue] = useState('');

  const loading = authLoading || yearLoading;

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin': return t('role_admin');
      case 'vice_admin': return t('role_vice_admin');
      case 'specialty_manager': return t('role_specialty_manager');
      case 'teacher': return t('role_teacher');
      default: return role;
    }
  };

  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    if (user?.role === 'admin' || user?.email === 't.mansouri@lagh-univ.dz') {
      const autoSeed = async () => {
        try {
          const lastSeed = localStorage.getItem('last_seed_v2');
          if (lastSeed === 'done') return;

          console.log('Admin detected: Triggering one-time auto-seed for new modules...');
          const seeded = await seedInitialData(true); // Force seed to ensure all new modules are added
          if (seeded) {
            console.log('Seeding done, marking as complete and reloading...');
            localStorage.setItem('last_seed_v2', 'done');
            window.location.reload();
          }
        } catch (err) {
          console.error('Auto-seed failed:', err);
        }
      };
      autoSeed();
    }
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  // Check if account is active (except for the main admin)
  if (user.role !== 'admin' && user.isActive === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 border border-slate-100 text-center space-y-6">
          <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
            <Bell className="w-10 h-10 text-amber-600 animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{t('account_review')}</h2>
          <p className="text-slate-500 leading-relaxed">
            {t('account_review_desc')}
          </p>
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-sm text-slate-600">
            {t('contact_admin')}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all"
          >
            {t('refresh_page')}
          </button>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'teachers': return <TeacherManagement />;
      case 'sessions': return <SessionLogging />;
      case 'projects': return <ProjectManagement />;
      case 'specialties': return <SpecialtyManagement />;
      case 'rooms': return <RoomManagement />;
      case 'structure': return <AcademicStructure />;
      case 'schedules': return <Schedules />;
      case 'calendar': return <PedagogicalCalendarManager />;
      case 'stats': return <DepartmentStats />;
      case 'overtime': return <OvertimeCalc />;
      case 'certificates': return <Certificates />;
      case 'field_visits': return <FieldVisits />;
      case 'reports': return <TeacherReports />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  return (
    <NotificationProvider>
      <div className="flex min-h-screen bg-slate-50" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 sticky top-0 z-30">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative max-w-md w-full hidden md:block">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder={t('quick_search')} 
                className="w-full pr-10 pl-4 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
              {/* Academic Year Selector */}
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all",
                isYearArchived ? "bg-amber-50 border-amber-100" : "bg-slate-50 border-slate-100"
              )}>
                <span className={cn(
                  "text-[10px] font-bold uppercase",
                  isYearArchived ? "text-amber-600" : "text-slate-400"
                )}>
                  {isYearArchived ? t('archived_year_label') : t('academic_year_label')}
                </span>
                <select 
                  value={selectedYear} 
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className={cn(
                    "bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer",
                    isYearArchived ? "text-amber-700" : "text-blue-600"
                  )}
                >
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                {isAdmin && (
                  <button 
                    onClick={() => {
                      setPromptValue('');
                      setPromptConfig({
                        show: true,
                        title: t('new_year_prompt'),
                        onConfirm: async (nextYear) => {
                          if (nextYear) {
                            try {
                              await addYear(nextYear);
                              toast.success(t('add_year_success'));
                            } catch (err) {
                              toast.error(t('add_year_error'));
                            }
                          }
                        }
                      });
                    }}
                    className="p-1 hover:bg-white rounded-lg text-slate-400 hover:text-blue-600 transition-all"
                    title={t('add')}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>

              <NotificationCenter />
              
              <div className="h-8 w-px bg-slate-100 mx-2"></div>
              
              <div className="flex items-center gap-3">
              {isAdmin && (
                <div className="hidden lg:flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
                  <select 
                    value={simulatedRole || 'admin'} 
                    onChange={(e) => setSimulatedRole(e.target.value === 'admin' ? null : e.target.value as any)}
                    className="bg-transparent border-none text-[10px] font-bold uppercase tracking-wider text-slate-500 focus:ring-0 cursor-pointer"
                  >
                    <option value="admin">Admin View</option>
                    <option value="vice_admin">Vice Admin View</option>
                    <option value="specialty_manager">Specialty Manager View</option>
                    <option value="teacher">Teacher View</option>
                  </select>
                </div>
              )}
              <div className="text-left hidden sm:block">
                <p className="text-sm font-bold text-slate-900 leading-none">{user.displayName}</p>
                <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider font-bold">
                  {getRoleLabel(user.role)}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-100">
                <UserIcon className="w-6 h-6" />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </div>
      </main>

      {/* Custom Prompt Modal */}
      {promptConfig.show && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">{promptConfig.title}</h3>
            <input 
              type="text"
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-blue-500/20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  promptConfig.onConfirm(promptValue);
                  setPromptConfig(prev => ({ ...prev, show: false }));
                }
                if (e.key === 'Escape') {
                  setPromptConfig(prev => ({ ...prev, show: false }));
                }
              }}
            />
            <div className="flex gap-3">
              <button 
                onClick={() => {
                  promptConfig.onConfirm(promptValue);
                  setPromptConfig(prev => ({ ...prev, show: false }));
                }}
                className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all"
              >
                {t('confirm')}
              </button>
              <button 
                onClick={() => setPromptConfig(prev => ({ ...prev, show: false }))}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </NotificationProvider>
  );
}
