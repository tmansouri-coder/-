import { collection, getDocs, query, limit, doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { cyclesData, roomsData, levelsData, specialtiesData, modulesData, teachersData } from './seedData';

export type SeedProgress = {
  step: string;
  percentage: number;
};

export async function seedInitialData(force = false, onProgress?: (progress: SeedProgress) => void) {
  try {
    if (!force) {
      const specialtiesSnap = await getDocs(query(collection(db, 'specialties'), limit(1)));
      if (!specialtiesSnap.empty) return false; // Already seeded
    }

    const report = (step: string, percentage: number) => {
      console.log(`Seed Progress: ${step} (${percentage}%)`);
      if (onProgress) onProgress({ step, percentage });
    };

    report('جاري البدء...', 0);

    if (force) {
      report('جاري مسح البيانات القديمة...', 5);
      const collectionsToClear = ['rooms', 'specialties', 'levels', 'modules', 'cycles', 'pedagogicalCalendar', 'settings', 'users', 'examSessions', 'scheduleSessions', 'students', 'projectDrafts', 'projects'];
      for (const coll of collectionsToClear) {
        const snap = await getDocs(collection(db, coll));
        if (snap.empty) continue;
        
        let batch = writeBatch(db);
        let count = 0;
        for (const d of snap.docs) {
          batch.delete(d.ref);
          count++;
          if (count === 100) { // Smaller batches for reliability
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }
    }

    // 0. Cycles
    report('جاري إضافة الدورات الدراسية...', 15);
    const cycleRefs: any = {};
    let cycleBatch = writeBatch(db);
    for (const c of cyclesData) {
      const newDoc = doc(collection(db, 'cycles'));
      cycleBatch.set(newDoc, c);
      cycleRefs[c.name] = newDoc.id;
    }

    // Seed academic years
    const yearsToSeed = ['2023/2024', '2024/2025', '2025/2026'];
    for (const year of yearsToSeed) {
      const yearDoc = doc(collection(db, 'academicYears'), year.replace('/', '-'));
      cycleBatch.set(yearDoc, { year, createdAt: new Date().toISOString() });
    }

    await cycleBatch.commit();

    // 1. Rooms
    report('جاري إضافة القاعات والمخابر...', 25);
    let roomBatch = writeBatch(db);
    let rCount = 0;
    for (const r of roomsData) {
      roomBatch.set(doc(collection(db, 'rooms')), r);
      rCount++;
      if (rCount === 100) {
        await roomBatch.commit();
        roomBatch = writeBatch(db);
        rCount = 0;
      }
    }
    if (rCount > 0) await roomBatch.commit();

    // 2. Levels
    report('جاري إضافة المستويات...', 35);
    const levelRefs: any = {};
    let levelBatch = writeBatch(db);
    for (const l of levelsData) {
      const cycleId = cycleRefs[l.cycleName];
      const newDoc = doc(collection(db, 'levels'));
      levelBatch.set(newDoc, { name: l.name, cycleId });
      levelRefs[`${l.cycleName}_${l.name}`] = newDoc.id;
    }
    await levelBatch.commit();

    // 3. Specialties
    report('جاري إضافة التخصصات...', 45);
    const specialtyRefs: any = {};
    let specBatch = writeBatch(db);
    for (const s of specialtiesData) {
      const levelId = levelRefs[s.levelKey];
      if (!levelId) continue;
      const newDoc = doc(collection(db, 'specialties'));
      specBatch.set(newDoc, { name: s.name, levelId, field: s.field });
      specialtyRefs[`${s.name}_${s.levelKey}`] = newDoc.id;
    }
    await specBatch.commit();

    // 4. Modules (The big one)
    report('جاري إضافة المقاييس (هذا قد يستغرق وقتاً)...', 60);
    let modBatch = writeBatch(db);
    let mCount = 0;
    const totalModules = modulesData.length;
    
    for (let i = 0; i < totalModules; i++) {
      const m = modulesData[i];
      const specialtyId = specialtyRefs[m.specialtyKey];
      if (!specialtyId) continue;
      
      modBatch.set(doc(collection(db, 'modules')), { 
        name: m.name, 
        specialtyId, 
        semester: m.semester,
        credits: 4,
        coefficient: 2,
        academicYear: '2025/2026'
      });
      
      mCount++;
      if (mCount === 50) { // Very small batches for the massive module list
        await modBatch.commit();
        modBatch = writeBatch(db);
        mCount = 0;
        const progress = 60 + Math.floor((i / totalModules) * 20);
        report(`جاري إضافة المقاييس (${i}/${totalModules})...`, progress);
      }
    }
    if (mCount > 0) await modBatch.commit();

    // 5. Settings & Calendar
    report('جاري ضبط الإعدادات...', 85);
    let settingsBatch = writeBatch(db);
    settingsBatch.set(doc(collection(db, 'settings'), 'general'), {
      departmentName: 'قسم الهندسة الميكانيكية',
      universityName: 'جامعة عمار ثليجي - الأغواط',
      academicYear: '2023/2024'
    });
    settingsBatch.set(doc(collection(db, 'pedagogicalCalendar'), 'current'), {
      semester1: { start: '2023-09-17', end: '2024-01-18' },
      semester2: { start: '2024-02-04', end: '2024-06-13' },
      excludedDays: ['2023-11-01', '2024-01-01', '2024-05-01']
    });
    await settingsBatch.commit();

    // 6. Teachers
    report('جاري إضافة الأساتذة...', 95);
    let teacherBatch = writeBatch(db);
    let tCount = 0;
    for (const t of teachersData) {
      const username = t.email.split('@')[0].toLowerCase();
      const teacherDoc = {
        ...t,
        displayName: t.name, // Map name to displayName
        username,
      };
      teacherBatch.set(doc(collection(db, 'users'), t.email), teacherDoc);
      teacherBatch.set(doc(collection(db, 'usernames'), username), { email: t.email });
      tCount++;
      if (tCount === 100) {
        await teacherBatch.commit();
        teacherBatch = writeBatch(db);
        tCount = 0;
      }
    }
    if (tCount > 0) await teacherBatch.commit();

    report('اكتملت العملية بنجاح!', 100);
    return true;
  } catch (error) {
    console.error('Error seeding data:', error);
    throw error;
  }
}
