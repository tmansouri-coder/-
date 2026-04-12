import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { User, UserRole } from '../types';
import { seedInitialData } from '../lib/seed';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  isAdmin: boolean;
  isViceAdmin: boolean;
  isSpecialtyManager: boolean;
  isTeacher: boolean;
  setSimulatedRole: (role: UserRole | null) => void;
  simulatedRole: UserRole | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulatedRole, setSimulatedRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fUser) => {
      setFirebaseUser(fUser);
      if (fUser) {
        const userDocRef = doc(db, 'users', fUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        let userData: User;
        if (userDoc.exists()) {
          userData = userDoc.data() as User;
        } else {
          // Check if user was seeded by email
          const q = query(collection(db, 'users'), where('email', '==', fUser.email));
          const querySnapshot = await getDocs(q);
          
          if (!querySnapshot.empty) {
            // Link seeded user to this UID
            const seededDoc = querySnapshot.docs[0];
            const seededData = seededDoc.data();
            const username = (fUser.email || seededData.email).split('@')[0].toLowerCase();
            userData = {
              ...seededData,
              uid: fUser.uid,
              displayName: fUser.displayName || seededData.displayName,
              username,
            } as User;
            
            await setDoc(userDocRef, userData);
            await setDoc(doc(db, 'usernames', username), { email: userData.email });
            // Delete the seeded doc with random ID to avoid duplicates
            if (seededDoc.id !== fUser.uid) {
              await deleteDoc(seededDoc.ref);
            }
          } else {
            // Create new profile
            const username = (fUser.email || '').split('@')[0].toLowerCase();
            userData = {
              uid: fUser.uid,
              email: fUser.email || '',
              displayName: fUser.displayName || 'User',
              username,
              role: fUser.email === 't.mansouri@lagh-univ.dz' ? 'admin' : 'teacher',
              createdAt: new Date().toISOString(),
            };
            await setDoc(userDocRef, userData);
            if (username) {
              await setDoc(doc(db, 'usernames', username), { email: userData.email });
            }
          }
        }
        console.log('AuthContext: User data loaded:', userData);
        setUser(userData);
        if (userData.role === 'admin') {
          console.log('AuthContext: User is admin, triggering seedInitialData');
          seedInitialData();
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const isAdmin = user?.role === 'admin';
  const effectiveRole = (isAdmin && simulatedRole) ? simulatedRole : user?.role;

  const value = {
    user: user ? { ...user, role: effectiveRole as UserRole } : null,
    firebaseUser,
    loading,
    isAdmin,
    isViceAdmin: effectiveRole === 'vice_admin',
    isSpecialtyManager: effectiveRole === 'specialty_manager',
    isTeacher: effectiveRole === 'teacher',
    setSimulatedRole: isAdmin ? setSimulatedRole : () => {},
    simulatedRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
