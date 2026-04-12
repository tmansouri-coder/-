import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, getDocs, setDoc, doc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';

interface AcademicYearContextType {
  selectedYear: string;
  setSelectedYear: (year: string) => void;
  availableYears: string[];
  addYear: (year: string) => Promise<void>;
  isYearArchived: boolean;
  loading: boolean;
}

const AcademicYearContext = createContext<AcademicYearContextType | undefined>(undefined);

export function AcademicYearProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, loading: authLoading } = useAuth();
  const [selectedYear, setSelectedYear] = useState<string>(() => {
    return localStorage.getItem('selectedAcademicYear') || '2025/2026';
  });

  const [availableYears, setAvailableYears] = useState<string[]>(['2025/2026']);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser) {
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'academicYears'), orderBy('year', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        // Initialize if empty
        setAvailableYears(['2025/2026']);
      } else {
        const years = snapshot.docs.map(doc => doc.data().year as string);
        setAvailableYears(years);
        // If selected year is not in available years, pick the first one
        if (!years.includes(selectedYear)) {
          setSelectedYear(years[0]);
        }
      }
      setLoading(false);
    }, (error) => {
      console.error('AcademicYear snapshot error:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [firebaseUser, authLoading]);

  useEffect(() => {
    localStorage.setItem('selectedAcademicYear', selectedYear);
  }, [selectedYear]);

  const addYear = async (year: string) => {
    if (!availableYears.includes(year)) {
      try {
        await setDoc(doc(db, 'academicYears', year.replace('/', '-')), { 
          year,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        console.error('Failed to add academic year:', err);
        throw err;
      }
    }
  };

  const isYearArchived = selectedYear !== availableYears[0];

  return (
    <AcademicYearContext.Provider value={{ selectedYear, setSelectedYear, availableYears, addYear, isYearArchived, loading }}>
      {children}
    </AcademicYearContext.Provider>
  );
}

export function useAcademicYear() {
  const context = useContext(AcademicYearContext);
  if (context === undefined) {
    throw new Error('useAcademicYear must be used within an AcademicYearProvider');
  }
  return context;
}
