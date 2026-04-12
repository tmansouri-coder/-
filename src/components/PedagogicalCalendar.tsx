import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { PedagogicalCalendar } from '../types';
import { Calendar as CalendarIcon, Plus, Trash2, Save, X, AlertCircle, Clock, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { CalendarEvent, CalendarEventType } from '../types';
import { useAcademicYear } from '../contexts/AcademicYearContext';

const EVENT_TYPES: { type: CalendarEventType; label: string; color: string }[] = [
  { type: 'holiday', label: 'عطلة / أيام مستثناة', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { type: 'exam_s1', label: 'امتحانات السداسي الأول', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { type: 'exam_s2', label: 'امتحانات السداسي الثاني', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { type: 'review', label: 'اطلاع الطلبة على النتائج', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { type: 'deliberation', label: 'مداولات الدورة العادية', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { type: 'resit_s1', label: 'استدراكي السداسي الأول', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { type: 'resit_s2', label: 'استدراكي السداسي الثاني', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { type: 'thesis_submission', label: 'إيداع مذكرات التخرج', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { type: 'thesis_defense', label: 'مناقشة مذكرات التخرج', color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  { type: 'final_deliberation', label: 'المداولات النهائية', color: 'bg-rose-100 text-rose-700 border-rose-200' },
  { type: 'certificates', label: 'تسليم الشهادات النهائية', color: 'bg-teal-100 text-teal-700 border-teal-200' },
  { type: 'master_app', label: 'الترشح للماستر', color: 'bg-violet-100 text-violet-700 border-violet-200' },
];

export default function PedagogicalCalendarManager() {
  const { selectedYear } = useAcademicYear();
  const [calendars, setCalendars] = useState<PedagogicalCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newExcludedDay, setNewExcludedDay] = useState('');
  const [showEventModal, setShowEventModal] = useState<{ calendarId: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const snap = await getDocs(query(collection(db, 'pedagogicalCalendars'), where('academicYear', '==', selectedYear)));
      setCalendars(snap.docs.map(d => ({ id: d.id, ...d.data() } as PedagogicalCalendar)));
      setLoading(false);
    };
    fetchData();
  }, [selectedYear]);

  const handleAddCalendar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      academicYear: formData.get('academicYear') as string,
      s1Start: formData.get('s1Start') as string,
      s1End: formData.get('s1End') as string,
      s2Start: formData.get('s2Start') as string,
      s2End: formData.get('s2End') as string,
      excludedDays: [],
      events: [],
    };

    try {
      const docRef = await addDoc(collection(db, 'pedagogicalCalendars'), data);
      setCalendars(prev => [{ id: docRef.id, ...data }, ...prev]);
      setShowAddModal(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddExcludedDay = async (calendarId: string) => {
    if (!newExcludedDay) return;
    const calendar = calendars.find(c => c.id === calendarId);
    if (!calendar) return;

    const updatedDays = [...calendar.excludedDays, newExcludedDay].sort();
    try {
      await updateDoc(doc(db, 'pedagogicalCalendars', calendarId), { excludedDays: updatedDays });
      setCalendars(prev => prev.map(c => c.id === calendarId ? { ...c, excludedDays: updatedDays } : c));
      setNewExcludedDay('');
    } catch (err) {
      console.error(err);
    }
  };

  const removeExcludedDay = async (calendarId: string, day: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا اليوم المستثنى؟')) return;
    const calendar = calendars.find(c => c.id === calendarId);
    if (!calendar) return;

    const updatedDays = calendar.excludedDays.filter(d => d !== day);
    try {
      await updateDoc(doc(db, 'pedagogicalCalendars', calendarId), { excludedDays: updatedDays });
      setCalendars(prev => prev.map(c => c.id === calendarId ? { ...c, excludedDays: updatedDays } : c));
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!showEventModal) return;
    const { calendarId } = showEventModal;
    const calendar = calendars.find(c => c.id === calendarId);
    if (!calendar) return;

    const formData = new FormData(e.currentTarget);
    const type = formData.get('type') as CalendarEventType;
    const eventTypeInfo = EVENT_TYPES.find(t => t.type === type);
    
    const newEvent: CalendarEvent = {
      id: crypto.randomUUID(),
      title: eventTypeInfo?.label || 'حدث جديد',
      startDate: formData.get('startDate') as string,
      endDate: formData.get('endDate') as string,
      type: type,
    };

    const updatedEvents = [...(calendar.events || []), newEvent].sort((a, b) => a.startDate.localeCompare(b.startDate));
    try {
      await updateDoc(doc(db, 'pedagogicalCalendars', calendarId), { events: updatedEvents });
      setCalendars(prev => prev.map(c => c.id === calendarId ? { ...c, events: updatedEvents } : c));
      setShowEventModal(null);
    } catch (err) {
      console.error(err);
    }
  };

  const removeEvent = async (calendarId: string, eventId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الموعد؟')) return;
    const calendar = calendars.find(c => c.id === calendarId);
    if (!calendar) return;

    const updatedEvents = (calendar.events || []).filter(e => e.id !== eventId);
    try {
      await updateDoc(doc(db, 'pedagogicalCalendars', calendarId), { events: updatedEvents });
      setCalendars(prev => prev.map(c => c.id === calendarId ? { ...c, events: updatedEvents } : c));
    } catch (err) {
      console.error(err);
    }
  };

  const deleteCalendar = async (calendarId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه السنة الجامعية بالكامل؟')) return;
    try {
      await deleteDoc(doc(db, 'pedagogicalCalendars', calendarId));
      setCalendars(prev => prev.filter(c => c.id !== calendarId));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-8 text-center">جاري التحميل...</div>;

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">الرزنامة البيداغوجية</h1>
          <p className="text-slate-500">تحديد فترات السداسيات وأيام العطل</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة سنة جامعية</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {calendars.map((cal) => (
          <div key={cal.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-100">
                  <CalendarIcon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">السنة الجامعية: {cal.academicYear}</h3>
                  <p className="text-sm text-slate-500">الجدول الزمني الرسمي للقسم</p>
                </div>
              </div>
              <button 
                onClick={() => deleteCalendar(cal.id)}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                title="حذف السنة الجامعية"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-12">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Semester Dates */}
                <div className="space-y-6">
                  <h4 className="font-bold text-slate-900 flex items-center gap-2">
                    <div className="w-1.5 h-6 bg-blue-600 rounded-full" />
                    فترات السداسيات
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                      <p className="text-xs font-bold text-emerald-600 uppercase mb-2">السداسي الأول</p>
                      <div className="space-y-1">
                        <p className="text-sm text-slate-600">البداية: <span className="font-bold">{cal.s1Start}</span></p>
                        <p className="text-sm text-slate-600">النهاية: <span className="font-bold">{cal.s1End}</span></p>
                      </div>
                    </div>
                    <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100">
                      <p className="text-xs font-bold text-blue-600 uppercase mb-2">السداسي الثاني</p>
                      <div className="space-y-1">
                        <p className="text-sm text-slate-600">البداية: <span className="font-bold">{cal.s2Start}</span></p>
                        <p className="text-sm text-slate-600">النهاية: <span className="font-bold">{cal.s2End}</span></p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Excluded Days */}
                <div className="space-y-6">
                  <h4 className="font-bold text-slate-900 flex items-center gap-2">
                    <div className="w-1.5 h-6 bg-orange-600 rounded-full" />
                    الأيام المستثناة (العطل الفردية)
                  </h4>
                  <div className="flex gap-2">
                    <input 
                      type="date" 
                      value={newExcludedDay}
                      onChange={(e) => setNewExcludedDay(e.target.value)}
                      className="flex-1 bg-slate-50 border-none rounded-xl px-4 py-2 focus:ring-2 focus:ring-orange-500"
                    />
                    <button 
                      onClick={() => handleAddExcludedDay(cal.id)}
                      className="px-4 py-2 bg-orange-600 text-white rounded-xl hover:bg-orange-700 transition-all font-bold"
                    >
                      إضافة
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {cal.excludedDays.length > 0 ? cal.excludedDays.map(day => (
                      <div key={day} className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium group">
                        <span>{day}</span>
                        <button 
                          onClick={() => removeExcludedDay(cal.id, day)}
                          className="text-slate-400 hover:text-red-600 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )) : (
                      <p className="text-sm text-slate-400 italic">لا توجد أيام مستثناة مضافة بعد</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Events Section */}
              <div className="space-y-6 pt-8 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 flex items-center gap-2">
                    <div className="w-1.5 h-6 bg-indigo-600 rounded-full" />
                    الأحداث والمواعيد الهامة
                  </h4>
                  <button 
                    onClick={() => setShowEventModal({ calendarId: cal.id })}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-all font-bold text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    إضافة موعد/فترة
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {cal.events && cal.events.length > 0 ? cal.events.map(event => {
                    const typeInfo = EVENT_TYPES.find(t => t.type === event.type);
                    return (
                      <div key={event.id} className={cn("p-4 rounded-2xl border flex flex-col justify-between group relative", typeInfo?.color)}>
                        <button 
                          onClick={() => removeEvent(cal.id, event.id)}
                          className="absolute top-2 left-2 p-1.5 bg-white/80 hover:bg-white text-red-600 rounded-lg transition-all shadow-sm z-10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <div>
                          <p className="text-xs font-bold uppercase mb-2 opacity-80">{typeInfo?.label}</p>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm font-bold">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{event.startDate} {event.endDate !== event.startDate && `إلى ${event.endDate}`}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="col-span-full p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <Info className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">لم يتم إضافة مواعيد هامة بعد</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">إضافة سنة جامعية جديدة</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddCalendar} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">السنة الجامعية (مثلاً: 2024/2025)</label>
                <input name="academicYear" required placeholder="2024/2025" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">بداية السداسي 1</label>
                  <input type="date" name="s1Start" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">نهاية السداسي 1</label>
                  <input type="date" name="s1End" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">بداية السداسي 2</label>
                  <input type="date" name="s2Start" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">نهاية السداسي 2</label>
                  <input type="date" name="s2End" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">حفظ الرزنامة</button>
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Add Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-slate-900">إضافة موعد أو فترة</h2>
              <button onClick={() => setShowEventModal(null)} className="p-2 hover:bg-white rounded-xl transition-all"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={handleAddEvent} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">نوع الموعد</label>
                <select name="type" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500">
                  {EVENT_TYPES.map(t => (
                    <option key={t.type} value={t.type}>{t.label}</option>
                  ))}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تاريخ البداية</label>
                  <input type="date" name="startDate" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">تاريخ النهاية</label>
                  <input type="date" name="endDate" required className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>

              <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  إذا كان الموعد ليوم واحد فقط، يرجى اختيار نفس التاريخ في البداية والنهاية.
                </p>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="submit" className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all">حفظ الموعد</button>
                <button type="button" onClick={() => setShowEventModal(null)} className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all">إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
