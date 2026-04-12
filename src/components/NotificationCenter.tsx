import React, { useState } from 'react';
import { Bell, Check, Trash2, ExternalLink, Info, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useNotifications, Notification } from '../contexts/NotificationContext';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';

export function NotificationCenter() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'info': return <Info className="w-4 h-4 text-blue-500" />;
      case 'success': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Bell className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
            {unreadCount > 9 ? '+9' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 mt-2 w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-600" />
                {t('notifications')}
              </h3>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllAsRead()}
                  className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  {t('mark_all_read')}
                </button>
              )}
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length > 0 ? (
                <div className="divide-y divide-slate-50">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={cn(
                        "p-4 transition-colors relative group",
                        !n.read ? "bg-blue-50/30" : "hover:bg-slate-50"
                      )}
                    >
                      <div className="flex gap-3">
                        <div className="mt-1">{getIcon(n.type)}</div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <p className={cn("text-sm font-bold", !n.read ? "text-slate-900" : "text-slate-600")}>
                              {n.title}
                            </p>
                            <span className="text-[10px] text-slate-400">
                              {n.createdAt?.toDate ? format(n.createdAt.toDate(), 'HH:mm', { locale: ar }) : ''}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">
                            {n.message}
                          </p>
                          {n.link && (
                            <a
                              href={n.link}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline mt-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {t('view_details')}
                            </a>
                          )}
                        </div>
                      </div>
                      {!n.read && (
                        <button
                          onClick={() => markAsRead(n.id)}
                          className="absolute top-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white rounded-lg shadow-sm border border-slate-100 text-blue-600"
                          title={t('mark_read')}
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center space-y-3">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                    <Bell className="w-8 h-8 text-slate-200" />
                  </div>
                  <p className="text-sm text-slate-400 font-medium">{t('no_notifications')}</p>
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="p-3 border-t border-slate-100 bg-slate-50/50 text-center">
                <button className="text-xs font-bold text-slate-500 hover:text-slate-700">
                  {t('view_all_notifications')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
