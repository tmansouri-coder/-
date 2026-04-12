import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { LogIn, Settings, ShieldCheck, Mail, Lock, User } from 'lucide-react';
import { motion } from 'motion/react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError('فشل تسجيل الدخول عبر جوجل');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      
      let loginEmail = email;
      
      // If the input doesn't look like an email, try to find it as a username
      if (!email.includes('@')) {
        const usernameDoc = await getDoc(doc(db, 'usernames', email.toLowerCase()));
        
        if (usernameDoc.exists()) {
          loginEmail = usernameDoc.data().email;
        } else {
          throw new Error('اسم المستخدم غير موجود');
        }
      }
      
      await signInWithEmailAndPassword(auth, loginEmail, password);
    } catch (err: any) {
      console.error('Login error:', err);
      if (err.code === 'auth/invalid-credential') {
        setError('خطأ في بيانات الدخول. تأكد من صحة كلمة المرور، أو تأكد من تفعيل حسابك في نظام Authentication.');
      } else if (err.message === 'اسم المستخدم غير موجود') {
        setError('اسم المستخدم هذا غير مسجل في النظام.');
      } else {
        setError('حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden font-sans" dir="rtl">
      {/* Background Image with Overlay */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: 'url("https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&q=80&w=2000")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-[2px]"></div>
      </div>

      {/* Animated Gears Decoration */}
      <div className="absolute top-[-10%] left-[-5%] opacity-10 pointer-events-none">
        <Settings className="w-64 h-64 text-white animate-[spin_20s_linear_infinite]" />
      </div>
      <div className="absolute bottom-[-10%] right-[-5%] opacity-10 pointer-events-none">
        <Settings className="w-96 h-96 text-white animate-[spin_30s_linear_infinite_reverse]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/20 z-10 m-4"
      >
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-500/20 rotate-3 hover:rotate-0 transition-transform duration-300">
            <Settings className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">قسم الهندسة الميكانيكية</h1>
          <p className="text-slate-500 mt-2 font-medium">نظام الإدارة والجدولة المتكامل</p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm mb-6 border border-red-100 flex items-center gap-3"
          >
            <ShieldCheck className="w-5 h-5 shrink-0" />
            {error}
          </motion.div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-5">
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700 mr-1">اسم المستخدم أو البريد الإلكتروني</label>
            <div className="relative">
              <User className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pr-12 pl-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all font-medium"
                placeholder="أدخل اسم المستخدم"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-700 mr-1">كلمة المرور</label>
            <div className="relative">
              <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pr-12 pl-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all font-medium"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>تسجيل الدخول</span>
              </>
            )}
          </button>
        </form>

        <div className="relative my-10">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-slate-400 font-medium">أو الدخول السريع عبر</span>
          </div>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-white border-2 border-slate-100 text-slate-700 py-4 rounded-2xl font-bold hover:bg-slate-50 active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
          <span>البريد الإلكتروني الجامعي</span>
        </button>

        <p className="text-center text-slate-400 text-xs mt-8 font-medium">
          جميع الحقوق محفوظة &copy; {new Date().getFullYear()} قسم الهندسة الميكانيكية
        </p>
      </motion.div>
    </div>
  );
}
