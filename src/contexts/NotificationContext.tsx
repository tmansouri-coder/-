import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, orderBy, limit, Timestamp, getDocs } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import toast from 'react-hot-toast';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  link?: string;
  read: boolean;
  createdAt: any;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  sendNotification: (userId: string, title: string, message: string, type: Notification['type'], link?: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!auth.currentUser) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newNotifications = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Notification));
      setNotifications(newNotifications);
      setUnreadCount(newNotifications.filter(n => !n.read).length);
      
      // Show toast for new unread notifications
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' && !change.doc.data().read) {
          const data = change.doc.data();
          // Only toast if it's not too old (to avoid toasting on initial load)
          const createdAt = data.createdAt?.toDate?.() || new Date();
          if (new Date().getTime() - createdAt.getTime() < 10000) {
            toast(data.title, { icon: '🔔' });
          }
        }
      });
    });

    return () => unsubscribe();
  }, [auth.currentUser]);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unread = notifications.filter(n => !n.read);
      await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', n.id), { read: true })));
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const sendNotification = async (userId: string, title: string, message: string, type: Notification['type'], link?: string) => {
    try {
      await addDoc(collection(db, 'notifications'), {
        userId,
        title,
        message,
        type,
        link,
        read: false,
        createdAt: Timestamp.now()
      });
      
      // Try to send email via API
      try {
        const userSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', userId)));
        if (!userSnap.empty) {
          const userData = userSnap.docs[0].data();
          if (userData.email) {
            await fetch('/api/send-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: userData.email,
                subject: title,
                body: `${message}\n\n${link ? `View details: ${window.location.origin}${link}` : ''}`
              })
            });
          }
        }
      } catch (e) {
        console.error('Email sending failed:', e);
      }
    } catch (err) {
      console.error('Failed to send notification:', err);
    }
  };

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, sendNotification }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
