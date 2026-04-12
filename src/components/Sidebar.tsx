import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  BookOpen, 
  FlaskConical, 
  Calendar, 
  ClipboardList, 
  Settings, 
  LogOut,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Globe,
  MessageSquare
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../lib/firebase';
import { cn } from '../lib/utils';
import { seedInitialData } from '../lib/seed';
import { useTranslation } from 'react-i18next';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { user, isAdmin } = useAuth();
  const [seeding, setSeeding] = useState(false);
  const { t, i18n } = useTranslation();

  const isRtl = i18n.language === 'ar';

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await seedInitialData(true);
      window.location.reload();
    } catch (err) {
      console.error(err);
      setSeeding(false);
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lng;
  };

  const menuItems = [
    { id: 'dashboard', label: t('dashboard'), icon: LayoutDashboard, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
    { id: 'teachers', label: t('teachers'), icon: Users, roles: ['admin', 'vice_admin'] },
    { id: 'specialties', label: t('specialties'), icon: Settings, roles: ['admin', 'vice_admin', 'specialty_manager'] },
    { id: 'structure', label: t('academic_structure'), icon: BookOpen, roles: ['admin', 'vice_admin'] },
    { id: 'schedules', label: t('schedules'), icon: Calendar, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
    { id: 'calendar', label: t('pedagogical_calendar'), icon: Calendar, roles: ['admin', 'vice_admin'] },
    { id: 'sessions', label: t('session_followup'), icon: ClipboardList, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
    { id: 'projects', label: t('projects'), icon: ClipboardList, roles: ['admin', 'vice_admin', 'specialty_manager', 'teacher'] },
    { id: 'rooms', label: t('rooms'), icon: FlaskConical, roles: ['admin', 'vice_admin'] },
    { id: 'stats', label: t('stats'), icon: LayoutDashboard, roles: ['admin', 'vice_admin'] },
    { id: 'overtime', label: t('overtime'), icon: Settings, roles: ['admin', 'vice_admin', 'teacher', 'specialty_manager'] },
    { id: 'certificates', label: t('certificates'), icon: BookOpen, roles: ['admin', 'vice_admin', 'teacher', 'specialty_manager'] },
    { id: 'field_visits', label: t('field_visits'), icon: Globe, roles: ['admin', 'vice_admin', 'teacher', 'specialty_manager'] },
    { id: 'reports', label: t('reports'), icon: MessageSquare, roles: ['admin', 'vice_admin', 'teacher', 'specialty_manager'] },
    { id: 'settings', label: t('settings'), icon: Settings, roles: ['admin'] },
  ];

  const filteredItems = menuItems.filter(item => item.roles.includes(user?.role || ''));

  return (
    <aside className={cn("w-64 bg-white border-slate-100 flex flex-col h-screen sticky top-0", isRtl ? "border-l" : "border-r")} dir={isRtl ? "rtl" : "ltr"}>
      <div className="p-6 border-b border-slate-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 leading-tight">{t('department_management')}</h2>
            <p className="text-xs text-slate-500">{t('mechanical_engineering')}</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 border-b border-slate-50">
        <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl">
          {['ar', 'fr', 'en'].map((lng) => (
            <button
              key={lng}
              onClick={() => changeLanguage(lng)}
              className={cn(
                "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all uppercase",
                i18n.language === lng ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
              )}
            >
              {lng}
            </button>
          ))}
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {filteredItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all group",
              activeTab === item.id 
                ? "bg-blue-50 text-blue-600" 
                : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className={cn("w-5 h-5", activeTab === item.id ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600")} />
              <span className="font-medium">{item.label}</span>
            </div>
            {activeTab === item.id && (isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
          </button>
        ))}

        {(isAdmin || user?.email === 't.mansouri@lagh-univ.dz') && (
          <div className="pt-4 mt-4 border-t border-slate-50">
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="w-full flex items-center gap-3 px-4 py-3 text-orange-600 hover:bg-orange-50 rounded-xl transition-all font-bold animate-pulse"
            >
              <RefreshCw className={cn("w-5 h-5", seeding ? "animate-spin" : "")} />
              <span>{seeding ? t('generating') : t('generate_data')}</span>
            </button>
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-slate-50">
        <button
          onClick={() => auth.signOut()}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">{t('logout')}</span>
        </button>
      </div>
    </aside>
  );
}
