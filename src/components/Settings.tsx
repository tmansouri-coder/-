import React, { useState, useRef } from 'react';
import { Settings as SettingsIcon, Bell, Shield, Database, Globe, Save, Download, Upload, Trash2, Loader2 } from 'lucide-react';
import { collection, getDocs, writeBatch, doc, deleteDoc } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, handleFirestoreError, OperationType, firebaseConfig } from '../lib/firebase';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

export default function Settings() {
  const { isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState<{ file: File } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const collectionsToBackup = [
    'users', 'specialties', 'levels', 'cycles', 'modules', 'rooms', 
    'students', 'overtimeRequests', 'projects', 'scheduleSessions', 
    'sessionLogs', 'certificateRequests', 'pedagogicalCalendar', 
    'pedagogicalCalendars', 'examSessions', 'settings'
  ];

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const backupData: any = {};
      
      for (const collName of collectionsToBackup) {
        const snap = await getDocs(collection(db, collName));
        backupData[collName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم تصدير النسخة الاحتياطية بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'backup_export');
      toast.error('فشل تصدير النسخة الاحتياطية');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShowImportConfirm({ file });
    e.target.value = '';
  };

  const proceedWithImport = async () => {
    if (!showImportConfirm) return;
    const { file } = showImportConfirm;
    setShowImportConfirm(null);

    setIsImporting(true);
    console.log('Starting import for file:', file.name);
    const loadingToast = toast.loading('جاري استيراد البيانات...');
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        if (!content) throw new Error('الملف فارغ');
        
        const backupData = JSON.parse(content);
        let totalDocs = 0;
        
        // Ensure backupData is an object
        if (typeof backupData !== 'object' || backupData === null) {
          throw new Error('تنسيق الملف غير صحيح');
        }

        for (const collName in backupData) {
          const data = backupData[collName];
          if (!Array.isArray(data)) continue;

          let batch = writeBatch(db);
          let count = 0;
          
          for (const item of data) {
            const { id, ...rest } = item;
            if (!id) continue;
            
            const docRef = doc(db, collName, id);
            // Use set with merge: true to add/update without deleting existing fields
            // and without clearing the collection
            batch.set(docRef, rest, { merge: true });
            count++;
            totalDocs++;

            if (count === 400) {
              await batch.commit();
              batch = writeBatch(db);
              count = 0;
            }
          }
          if (count > 0) await batch.commit();
        }
        
        toast.dismiss(loadingToast);
        if (totalDocs === 0) {
          toast.error('لم يتم العثور على بيانات صالحة في الملف');
        } else {
          toast.success(`تم استيراد النسخة الاحتياطية بنجاح! تم تحديث/إضافة ${totalDocs} وثيقة.`);
        }
      } catch (err) {
        console.error('Import error:', err);
        toast.dismiss(loadingToast);
        toast.error(`❌ فشل الاستيراد: ${err instanceof Error ? err.message : 'تأكد من صحة الملف'}`);
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
  };

  const handleClearData = async () => {
    setShowClearConfirm(true);
  };

  const proceedWithClear = async () => {
    setShowClearConfirm(false);
    setIsClearing(true);
    try {
      for (const collName of [...collectionsToBackup, 'usernames']) {
        const snap = await getDocs(collection(db, collName));
        let batch = writeBatch(db);
        let count = 0;
        
        for (const d of snap.docs) {
          batch.delete(d.ref);
          count++;
          if (count === 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }
      toast.success('تم مسح كافة البيانات بنجاح');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'clear_data');
      toast.error('فشل مسح البيانات');
    } finally {
      setIsClearing(false);
    }
  };

  const handleSyncUsernames = async () => {
    setIsSyncing(true);
    const loadingToast = toast.loading('جاري مزامنة الحسابات وأسماء المستخدمين...');
    
    const secondaryApp = initializeApp(firebaseConfig, 'SyncApp');
    const secondaryAuth = getAuth(secondaryApp);

    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      let batch = writeBatch(db);
      let count = 0;
      let totalSynced = 0;
      let authCreated = 0;

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const email = userData.email;
        if (!email) continue;

        const username = email.split('@')[0].toLowerCase();
        
        // 1. Sync to Firebase Auth if password exists and user is active
        if (userData.isActive && userData.password) {
          try {
            await createUserWithEmailAndPassword(secondaryAuth, email, userData.password);
            authCreated++;
          } catch (authErr: any) {
            // Ignore if already exists
          }
        }

        // 2. Update user doc with username if missing
        if (!userData.username) {
          batch.update(userDoc.ref, { username });
        }

        // 3. Create/Update username mapping
        const usernameRef = doc(db, 'usernames', username);
        batch.set(usernameRef, { email });

        count++;
        totalSynced++;

        if (count === 100) { // Smaller batches because of async auth calls
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) await batch.commit();
      toast.dismiss(loadingToast);
      toast.success(`تمت المزامنة بنجاح! تم تحديث ${totalSynced} مستخدم وإنشاء ${authCreated} حساب دخول جديد.`);
    } catch (err) {
      toast.dismiss(loadingToast);
      handleFirestoreError(err, OperationType.UPDATE, 'sync_usernames');
      toast.error('فشل مزامنة الحسابات');
    } finally {
      setIsSyncing(false);
      await deleteApp(secondaryApp);
    }
  };

  return (
    <div className="space-y-8" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">إعدادات النظام</h1>
        <p className="text-slate-500">تخصيص تفضيلات التطبيق والخيارات العامة</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* General Settings */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
              <SettingsIcon className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-slate-900">الإعدادات العامة</h3>
            </div>
            <div className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">اسم القسم</label>
                  <input defaultValue="قسم الهندسة الميكانيكية" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">الكلية</label>
                  <input defaultValue="كلية التكنولوجيا" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">البريد الإلكتروني للقسم</label>
                <input defaultValue="mech.eng@univ.dz" className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
              <Bell className="w-5 h-5 text-orange-600" />
              <h3 className="font-bold text-slate-900">التنبيهات</h3>
            </div>
            <div className="p-8 space-y-4">
              {[
                { label: 'تنبيهات غياب الأساتذة', desc: 'إرسال إشعار للإدارة عند تسجيل غياب' },
                { label: 'تذكير بمواعيد الامتحانات', desc: 'إرسال تذكير للأساتذة والطلبة قبل الامتحان بـ 24 ساعة' },
                { label: 'تحديثات الجداول', desc: 'إشعار المستخدمين عند تغيير أي حصة في الجدول' },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 transition-all">
                  <div>
                    <p className="font-bold text-slate-900">{item.label}</p>
                    <p className="text-xs text-slate-500">{item.desc}</p>
                  </div>
                  <div className="w-12 h-6 bg-blue-600 rounded-full relative cursor-pointer">
                    <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all translate-x-6" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Security */}
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Shield className="w-5 h-5 text-emerald-600" />
              <h3 className="font-bold text-slate-900">الأمان</h3>
            </div>
            <button className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all text-sm">تغيير كلمة المرور</button>
            <button className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all text-sm">سجل الدخول</button>
          </div>

          {/* Data Management - Only for Admin */}
          {isAdmin && (
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Database className="w-5 h-5 text-purple-600" />
                <h3 className="font-bold text-slate-900">إدارة البيانات</h3>
              </div>
              
              <button 
                onClick={handleSyncUsernames}
                disabled={isSyncing}
                className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-bold hover:bg-blue-100 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                مزامنة أسماء المستخدمين
              </button>

              <button 
                onClick={handleExportBackup}
                disabled={isExporting}
                className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-bold hover:bg-blue-100 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                نسخ احتياطي (Backup)
              </button>

              <div className="relative">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept=".json" 
                  onChange={handleImportBackup}
                  className="hidden"
                  disabled={isImporting}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className="w-full py-3 bg-emerald-50 text-emerald-600 rounded-xl font-bold hover:bg-emerald-100 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  استيراد نسخة احتياطية
                </button>
              </div>

              <button 
                onClick={handleClearData}
                disabled={isClearing}
                className="w-full py-3 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isClearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                مسح كافة البيانات
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button className="flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
          <Save className="w-5 h-5" />
          حفظ كافة التغييرات
        </button>
      </div>

      {/* Import Confirmation Modal */}
      {showImportConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 space-y-6 text-center">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
              <Upload className="w-10 h-10 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">تأكيد استيراد البيانات</h3>
              <p className="text-slate-500 mt-2">⚠️ تنبيه هام: استيراد نسخة احتياطية سيقوم بتحديث البيانات الموجودة وربما استبدالها. هل أنت متأكد من رغبتك في المتابعة؟</p>
              <p className="text-xs text-slate-400 mt-2">الملف: {showImportConfirm.file.name}</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={proceedWithImport}
                className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all"
              >
                بدء الاستيراد
              </button>
              <button 
                onClick={() => setShowImportConfirm(null)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Data Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 space-y-6 text-center">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <Trash2 className="w-10 h-10 text-red-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">تأكيد مسح كافة البيانات</h3>
              <p className="text-slate-500 mt-2">هل أنت متأكد تماماً من مسح كافة البيانات؟ لا يمكن التراجع عن هذه العملية.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={proceedWithClear}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                مسح البيانات
              </button>
              <button 
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
