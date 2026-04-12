import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Room } from '../types';
import { Plus, Search, FlaskConical, Trash2, Edit2, X, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';

export default function RoomManagement() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRoom, setNewRoom] = useState<Partial<Room>>({
    type: 'classroom',
    capacity: 40
  });

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const snap = await getDocs(collection(db, 'rooms'));
        setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'rooms');
      } finally {
        setLoading(false);
      }
    };
    fetchRooms();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const docRef = await addDoc(collection(db, 'rooms'), newRoom);
      setRooms([...rooms, { id: docRef.id, ...newRoom } as Room]);
      setIsModalOpen(false);
      setNewRoom({ type: 'classroom', capacity: 40 });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'rooms');
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">إدارة القاعات والمخابر</h1>
          <p className="text-slate-500">إدارة أماكن التدريس والبحث العلمي</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 text-white px-4 py-2.5 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          إضافة قاعة جديدة
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {rooms.map((room) => (
          <div key={room.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-center text-center group relative">
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110",
              room.type === 'lab' ? "bg-amber-50 text-amber-600" : 
              room.type === 'amphi' ? "bg-indigo-50 text-indigo-600" : "bg-blue-50 text-blue-600"
            )}>
              {room.type === 'lab' ? <FlaskConical className="w-8 h-8" /> : <MapPin className="w-8 h-8" />}
            </div>
            <h3 className="font-bold text-slate-900 mb-1">{room.name}</h3>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              <span>{room.type === 'lab' ? 'مخبر' : room.type === 'amphi' ? 'مدرج' : 'قاعة'}</span>
              <span>•</span>
              <span>{room.capacity} مقعد</span>
            </div>
            
            <button className="absolute top-4 left-4 p-2 text-slate-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 border border-slate-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-900">إضافة قاعة / مخبر</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">اسم القاعة</label>
                <input
                  type="text"
                  required
                  value={newRoom.name || ''}
                  onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">النوع</label>
                  <select
                    value={newRoom.type}
                    onChange={(e) => setNewRoom({ ...newRoom, type: e.target.value as any })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="classroom">قاعة تدريس</option>
                    <option value="lab">مخبر</option>
                    <option value="amphi">مدرج</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">السعة</label>
                  <input
                    type="number"
                    required
                    value={newRoom.capacity || ''}
                    onChange={(e) => setNewRoom({ ...newRoom, capacity: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all mt-6"
              >
                حفظ القاعة
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
