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
    <aside className={cn("w-72 bg-white border-slate-100 flex flex-col h-screen sticky top-0 shadow-sm", isRtl ? "border-l" : "border-r")} dir={isRtl ? "rtl" : "ltr"}>
      <div className="p-8 border-b border-slate-50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-200/50">
            <BookOpen className="w-7 h-7" />
          </div>
          <div>
            <h2 className="font-extrabold text-slate-900 leading-tight text-lg">{t('department_management')}</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">{t('mechanical_engineering')}</p>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
          {['ar', 'fr', 'en'].map((lng) => (
            <button
              key={lng}
              onClick={() => changeLanguage(lng)}
              className={cn(
                "flex-1 py-2 rounded-xl text-[10px] font-extrabold transition-all uppercase tracking-widest",
                i18n.language === lng ? "bg-white text-blue-600 shadow-sm border border-slate-100" : "text-slate-400 hover:text-slate-600"
              )}
            >
              {lng}
            </button>
          ))}
        </div>
      </div>

      <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
        {filteredItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all duration-200 group relative",
              activeTab === item.id 
                ? "bg-blue-50/50 text-blue-600 font-bold" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            <div className="flex items-center gap-3.5">
              <item.icon className={cn("w-5 h-5 transition-colors", activeTab === item.id ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600")} />
              <span className="text-sm">{item.label}</span>
            </div>
            {activeTab === item.id && (
              <div className={cn("absolute w-1 h-6 bg-blue-600 rounded-full", isRtl ? "-left-1" : "-right-1")} />
            )}
          </button>
        ))}

        {(isAdmin || user?.email === 't.mansouri@lagh-univ.dz') && (
          <div className="pt-6 mt-6 border-t border-slate-50 px-2">
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-orange-600 hover:bg-orange-50 rounded-2xl transition-all font-bold text-sm group"
            >
              <RefreshCw className={cn("w-4 h-4 transition-transform duration-500", seeding ? "animate-spin" : "group-hover:rotate-180")} />
              <span>{seeding ? t('generating') : t('generate_data')}</span>
            </button>
          </div>
        )}
      </nav>

      <div className="p-6 border-t border-slate-50">
        <button
          onClick={() => auth.signOut()}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-slate-500 hover:bg-red-50 hover:text-red-600 rounded-2xl transition-all font-bold text-sm"
        >
          <LogOut className="w-5 h-5" />
          <span>{t('logout')}</span>
        </button>
      </div>
    </aside>
  );
}
