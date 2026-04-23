import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, X, Plus, Info } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { GoogleGenAI, Type } from "@google/genai";
import { db } from '../lib/firebase';
import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { Module, User, Room, Specialty, ScheduleSession, ExamSession } from '../types';

interface PDFScheduleImporterProps {
  onClose: () => void;
  academicYear: string;
  modules: Module[];
  teachers: User[];
  rooms: Room[];
  specialties: Specialty[];
  type: 'semester' | 'exams';
  selectedLevelId?: string;
  selectedLevelName?: string;
}

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PDFScheduleImporter({ 
  onClose, academicYear, modules, teachers, rooms, specialties, type, selectedLevelId, selectedLevelName
}: PDFScheduleImporterProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'upload' | 'parsing' | 'review'>('upload');
  const [parsedData, setParsedData] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractTextFromPDF = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }
    
    return fullText;
  };

  const matchEntity = (name: string, entities: any[], field: string = 'name', preferredLevelId?: string) => {
    if (!name) return null;
    
    // Filter entities if we have a preferred level
    let candidates = entities;
    if (preferredLevelId && (field === 'name' || field === 'title')) {
      const levelMatches = entities.filter(e => e.levelId === preferredLevelId);
      if (levelMatches.length > 0) {
        candidates = levelMatches;
      }
    }

    return candidates.find(e => isFuzzyMatch(e[field], name));
  };

  const normalizeString = (str: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .trim()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي') // Normalize alif maqsura
      // Remove common titles and prefixes
      .replace(/الاستاذة?\s+/g, '')
      .replace(/البروفيسور\s+/g, '')
      .replace(/الدكتوره?\s+/g, '')
      .replace(/^ال/g, '') // Remove prefix 'Al' if at start
      .replace(/\s+ال/g, ' ') // Remove prefix 'Al' after space
      .replace(/د\.\s+/g, '')
      .replace(/أ\.\s+/g, '')
      // Keep dots as they are used in initials
      .replace(/[^\u0621-\u064A0-9a-z\s.]/g, ' ') 
      .replace(/\s+/g, ' ')
      .trim();
  };

  const isFuzzyMatch = (name1: string, name2: string) => {
    const n1 = normalizeString(name1);
    const n2 = normalizeString(name2);
    
    if (!n1 || !n2) return false;
    if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) return true;

    // Handle initials pattern like "A.ALI" matching "Ahmed Ali"
    const checkInitials = (full: string, abbrev: string) => {
      const cleanAbbrev = abbrev.replace(/\./g, ' ').split(' ').filter(Boolean);
      const cleanFull = full.split(' ').filter(Boolean);
      
      if (cleanAbbrev.length === 2 && cleanFull.length >= 2) {
        const init = cleanAbbrev[0];
        const last = cleanAbbrev[1];
        
        // Pattern: I. Lastname
        if (init.length === 1 && cleanFull[0].startsWith(init) && cleanFull[cleanFull.length - 1] === last) {
          return true;
        }
      }
      return false;
    };

    if (checkInitials(n1, n2) || checkInitials(n2, n1)) return true;

    // Check words overlap (handles reordering like "Mansouri Tarek" vs "Tarek Mansouri")
    const words1 = n1.replace(/\./g, ' ').split(' ').filter(w => w.length >= 2);
    const words2 = n2.replace(/\./g, ' ').split(' ').filter(w => w.length >= 2);
    
    if (words1.length === 0 || words2.length === 0) return false;
    
    // If one name is a subset of words of the other
    const allWords1In2 = words1.every(w => words2.some(w2 => w2 === w || w2.includes(w) || w.includes(w2)));
    const allWords2In1 = words2.every(w => words1.some(w1 => w1 === w || w1.includes(w) || w.includes(w1)));

    return allWords1In2 || allWords2In1;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);
    setStep('parsing');
    setLoading(true);

    try {
      const text = await extractTextFromPDF(uploadedFile);
      const pages = text.split('--- Page').filter(p => p.trim().length > 0).map(p => '--- Page' + p);
      
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
       const systemInstruction = type === 'semester' 
        ? `You are an expert in parsing academic university schedules from text. 
           Extract schedule sessions for mechanical engineering department.
           Return a JSON array of session objects.
           Each session should have: moduleName, teacherName, roomName, specialtyName, levelName, day (Sunday-Thursday), period (H1-H6), sessionType (Cours, TD, TP), semester (S1, S2).
           The day must be one of: Sunday, Monday, Tuesday, Wednesday, Thursday.
           The period must be one of: H1, H2, H3, H4, H5, H6.
           The sessionType must be: Cours, TD, or TP.
           ${selectedLevelName ? `IMPORTANT: Only extract sessions for the level: ${selectedLevelName}. Ignore all other levels completely to save space.` : ''}
           Context info:
           - Days: الأحد (Sunday), الاثنين (Monday), الثلاثاء (Tuesday), الأربعاء (Wednesday), الخميس (Thursday).
           - Periods: H1 (08:10), H2 (09:40), H3 (11:10), H4 (12:35), H5 (14:10), H6 (15:40).`
        : `You are an expert in parsing academic exam schedules from text.
           Extract exam sessions including precise invigilator names and room names.
           Return a JSON array of exam objects.
           Each exam should have: moduleName, specialtyName, levelName, date (YYYY-MM-DD), time, type (Regular, Resit), semester (S1, S2), roomNames (array), invigilatorNames (array).
           ${selectedLevelName ? `IMPORTANT: Only extract exams for the level: ${selectedLevelName}. Ignore all other levels completely to save space.` : ''}
           Note: Look for names of teachers/invigilators. They are often listed after the module or in dedicated columns. 
           In Arabic, look for headings like "الأساتذة الحراس" or "المراقبون". 
           Identify the full names of the teachers correctly.
           For levels that split exams (e.g., 2nd Year / Second Year / ثانية ليسانس), try to capture specific assignments in 'roomAssignments' if room-specific invigilators are listed.`;

      const responseSchema = type === 'semester' 
        ? {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                moduleName: { type: Type.STRING },
                teacherName: { type: Type.STRING },
                roomName: { type: Type.STRING },
                specialtyName: { type: Type.STRING },
                levelName: { type: Type.STRING },
                day: { type: Type.STRING },
                period: { type: Type.STRING },
                sessionType: { type: Type.STRING },
                semester: { type: Type.STRING }
              },
              required: ["moduleName", "day", "period", "sessionType"]
            }
          }
        : {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                moduleName: { type: Type.STRING },
                specialtyName: { type: Type.STRING },
                levelName: { type: Type.STRING },
                date: { type: Type.STRING },
                time: { type: Type.STRING },
                type: { type: Type.STRING },
                semester: { type: Type.STRING },
                roomNames: { type: Type.ARRAY, items: { type: Type.STRING } },
                invigilatorNames: { type: Type.ARRAY, items: { type: Type.STRING } },
                roomAssignments: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      roomName: { type: Type.STRING },
                      invigilatorNames: { type: Type.ARRAY, items: { type: Type.STRING } },
                      groups: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["roomName"]
                  }
                }
              },
              required: ["moduleName", "date", "time"]
            }
          };

      let items: any[] = [];
      const CHUNK_SIZE = 1; // Process 1 page at a time to stay safe with output limits
      
      for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
        const chunkText = pages.slice(i, i + CHUNK_SIZE).join('\n\n');
        try {
          const aiResponse = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview", // Use Pro for higher output token limits (32k) and better reasoning
            contents: `Here is a part of the extracted text from a ${type === 'semester' ? 'semester schedule' : 'exam schedule'} PDF. 
                       Identify the sessions and extract them accurately into the required JSON format.
                       Text content:
                       ${chunkText}`,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema
            }
          });

          if (aiResponse.text) {
             let cleanText = aiResponse.text.trim();
             // Remove markdown code blocks if present (though responseMimeType: 'application/json' should handle this)
             if (cleanText.startsWith('```')) {
               cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
             }
             const chunkItems = JSON.parse(cleanText);
             if (Array.isArray(chunkItems)) {
               items = [...items, ...chunkItems];
             }
          }
        } catch (err) {
          console.error(`Error parsing chunk ${i}:`, err);
          // Continue to next chunk or handle as needed
        }
      }

      console.log(`AI analyzed total ${items.length} items from ${pages.length} pages. Starting matching...`);

      
      // Build lookup maps for faster matching
      const modulesMap = new Map<string, Module[]>();
      modules.forEach(m => {
        const key = m.name.toLowerCase().trim();
        if (!modulesMap.has(key)) modulesMap.set(key, []);
        modulesMap.get(key)!.push(m);
      });

      const specialtiesMap = new Map<string, Specialty[]>();
      specialties.forEach(s => {
        const key = s.name.toLowerCase().trim();
        if (!specialtiesMap.has(key)) specialtiesMap.set(key, []);
        specialtiesMap.get(key)!.push(s);
      });

      const teachersMap = new Map<string, User>();
      teachers.forEach(t => {
        teachersMap.set(t.displayName.toLowerCase().trim(), t);
      });

      const roomsMap = new Map<string, Room>();
      rooms.forEach(r => {
        roomsMap.set(r.name.toLowerCase().trim(), r);
      });

      const fastMatch = (name: string, map: Map<string, any>, preferredLevelId?: string) => {
        if (!name) return null;
        const key = name.toLowerCase().trim();
        const matches = map.get(key);
        if (!matches) return null;
        if (Array.isArray(matches)) {
          if (preferredLevelId) {
            const levelMatch = matches.find(m => m.levelId === preferredLevelId);
            if (levelMatch) return levelMatch;
          }
          return matches[0];
        }
        return matches;
      };
      
      // Post-process to match with DB IDs
      const processed = items.map((item: any) => {
        const mod = fastMatch(item.moduleName, modulesMap, selectedLevelId);
        const spec = fastMatch(item.specialtyName, specialtiesMap, selectedLevelId);
        
        // If we have a selected level, and the parsed item doesn't match a specialty in that level,
        // it might be a 'fake' or irrelevant item from a multi-level PDF.
        if (selectedLevelId && spec && spec.levelId !== selectedLevelId) {
          // Keep it but mark it as suspicious if needed, or just let the filter handle it.
        }

        if (type === 'semester') {
          const teacher = teachers.find(t => 
            t.displayName.toLowerCase().trim() === item.teacherName?.toLowerCase().trim() ||
            item.teacherName?.toLowerCase().trim().includes(t.displayName.toLowerCase().trim())
          );
          const room = rooms.find(r => 
            r.name.toLowerCase().trim() === item.roomName?.toLowerCase().trim() ||
            item.roomName?.toLowerCase().trim().includes(r.name.toLowerCase().trim())
          );
          return {
            ...item,
            moduleId: mod?.id || '',
            teacherId: teacher?.uid || '',
            roomId: room?.id || '',
            specialtyId: spec?.id || '',
            matched: !!(mod && spec)
          };
        } else {
          const rawRoomNames = Array.isArray(item.roomNames) ? item.roomNames : (item.roomNames ? [item.roomNames] : []);
          const flatRoomNames = rawRoomNames.flatMap((r: string) => r.split(/[,،/\\+]+/).map(s => s.trim()).filter(Boolean));
          
          const matchedRooms = flatRoomNames
            .map((rn: string) => {
              const r = rooms.find(room => isFuzzyMatch(room.name, rn));
              return r?.id;
            })
            .filter(Boolean);

          const rawInvigilatorNames = Array.isArray(item.invigilatorNames) ? item.invigilatorNames : (item.invigilatorNames ? [item.invigilatorNames] : []);
          const flatInvigilatorNames = rawInvigilatorNames.flatMap((inm: string) => inm.split(/[,،/\\+]+/).map(s => s.trim()).filter(Boolean));

          const matchedInvigilators = flatInvigilatorNames
            .map((inm: string) => {
              const t = teachers.find(teach => isFuzzyMatch(teach.displayName, inm));
              return t?.uid;
            })
            .filter(Boolean);

          // Map roomAssignments if present
          let mappedAssignments: any[] = [];
          if (Array.isArray(item.roomAssignments)) {
            mappedAssignments = item.roomAssignments.map((ra: any) => {
              const r = rooms.find(room => isFuzzyMatch(room.name, ra.roomName));
              const raInvigs = Array.isArray(ra.invigilatorNames) 
                ? ra.invigilatorNames.map((inm: string) => teachers.find(t => isFuzzyMatch(t.displayName, inm))?.uid).filter(Boolean)
                : [];
              
              return {
                roomId: r?.id || '',
                invigilators: raInvigs,
                groups: ra.groups || [],
                studentCount: 0
              };
            }).filter((ra: any) => ra.roomId || (ra.invigilators && ra.invigilators.length > 0));
          }

          return {
            ...item,
            invigilatorNames: flatInvigilatorNames, // Update with flattened names for UI feedback
            roomNames: flatRoomNames,
            moduleId: mod?.id || '',
            specialtyId: spec?.id || '',
            roomIds: [...new Set(matchedRooms)],
            invigilators: [...new Set(matchedInvigilators)],
            roomAssignments: mappedAssignments,
            matched: !!(mod && spec)
          };
        }
      });

      setParsedData(processed);
      setStep('review');
    } catch (err) {
      console.error('PDF Import error:', err);
      toast.error('فشل معالجة الملف. تأكد من أن الملف نصي وقابل للقراءة.');
      setStep('upload');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    setLoading(true);
    const collectionName = type === 'semester' ? 'scheduleSessions' : 'examSessions';
    const validItems = parsedData.filter(item => item.moduleId && item.specialtyId);
    const normalizedAcademicYear = academicYear.replace('-', '/');
    
    try {
      let count = 0;
      const CHUNK_SIZE = 100;
      
      for (let i = 0; i < validItems.length; i += CHUNK_SIZE) {
        const chunk = validItems.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        
        for (const item of chunk) {
          const newDocRef = doc(collection(db, collectionName));
          
          const hasDetailedAssignments = Array.isArray(item.roomAssignments) && item.roomAssignments.length > 0;
          // Use detailed mode if assignments exist, regardless of level
          const mode = hasDetailedAssignments ? 'Detailed' : 'Simple';

          // Extract unique roomIds and invigilators from assignments if empty in simple fields
          let finalRoomIds = [...(item.roomIds || [])];
          let finalInvigilators = [...(item.invigilators || [])];

          if (hasDetailedAssignments) {
            item.roomAssignments.forEach((ra: any) => {
              if (ra.roomId && !finalRoomIds.includes(ra.roomId)) {
                finalRoomIds.push(ra.roomId);
              }
              if (Array.isArray(ra.invigilators)) {
                ra.invigilators.forEach((vid: string) => {
                  if (vid && !finalInvigilators.includes(vid)) {
                    finalInvigilators.push(vid);
                  }
                });
              }
            });
          }

          const data = type === 'semester' ? {
            moduleId: item.moduleId,
            teacherId: item.teacherId || '',
            roomId: item.roomId || '',
            specialtyId: item.specialtyId,
            semester: item.semester || 'S1',
            day: item.day,
            period: item.period,
            type: item.sessionType,
            academicYear: normalizedAcademicYear
          } : {
            moduleId: item.moduleId,
            specialtyId: item.specialtyId,
            semester: item.semester || 'S1',
            date: item.date,
            time: item.time,
            type: item.type || 'Regular',
            roomIds: finalRoomIds,
            invigilators: finalInvigilators,
            roomAssignments: mode === 'Detailed' ? item.roomAssignments : [],
            mode,
            academicYear: normalizedAcademicYear
          };
          
          batch.set(newDocRef, data);
          count++;
        }
        
        await batch.commit();
      }
      
      toast.success(`تم استيراد ${count} سجل بنجاح`);
      onClose();
    } catch (err) {
      console.error('Save imported data error:', err);
      toast.error('فشل حفظ البيانات المستوردة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[32px] w-full max-w-4xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden border border-white/20">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">
                {type === 'semester' ? 'استيراد جدول سداسي من PDF' : 'استيراد جدول امتحانات من PDF'}
              </h3>
              <p className="text-sm text-slate-500">تحويل ملفات PDF إلى جداول زمنية رقمية تلقائياً</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-600 transition-all">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center h-full space-y-8 py-12">
              <div 
                className="w-full max-w-md aspect-video border-2 border-dashed border-slate-200 rounded-[32px] flex flex-col items-center justify-center gap-4 hover:border-blue-500 hover:bg-blue-50/30 transition-all cursor-pointer group"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-slate-900">انقر أو اسحب ملف PDF هنا</p>
                  <p className="text-sm text-slate-400 mt-1">يدعم ملفات PDF النصية فقط</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept="application/pdf" 
                  onChange={handleFileUpload} 
                  className="hidden" 
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
                {[
                  { icon: CheckCircle2, title: 'سهولة الاستخدام', desc: 'ارفع الملف وسيقوم النظام بالباقي' },
                  { icon: Loader2, title: 'ذكاء اصطناعي', desc: 'تحليل دقيق للبيانات الأكاديمية' },
                  { icon: Info, title: 'مراجعة دقيقة', desc: 'إمكانية مراجعة البيانات قبل الحفظ' }
                ].map((feature, i) => (
                  <div key={i} className="bg-slate-50 p-4 rounded-2xl flex flex-col items-center text-center gap-2">
                    <feature.icon className="w-5 h-5 text-blue-600" />
                    <h4 className="font-bold text-slate-900 text-sm">{feature.title}</h4>
                    <p className="text-xs text-slate-500">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'parsing' && (
            <div className="flex flex-col items-center justify-center h-full space-y-6 py-20">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-blue-100 rounded-full border-t-blue-600 animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-blue-600 animate-pulse" />
                </div>
              </div>
              <div className="text-center animate-bounce">
                <h3 className="text-xl font-bold text-slate-900">جاري قراءة وتحليل الملف...</h3>
                <p className="text-slate-500 mt-2">نستخدم الذكاء الاصطناعي لفهم محتوى الجدول بدقة</p>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl border border-emerald-100">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-bold">تم العثور على {parsedData.length} سجل</span>
                </div>
                <button 
                   onClick={() => setStep('upload')}
                   className="text-xs font-bold text-blue-600 hover:underline"
                >
                  إعادة رفع ملف آخر
                </button>
              </div>

              <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-right">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3 text-sm font-bold text-slate-700 text-right">المقياس</th>
                      <th className="px-4 py-3 text-sm font-bold text-slate-700 text-right">التخصص</th>
                      <th className="px-4 py-3 text-sm font-bold text-slate-700 text-right">
                        {type === 'semester' ? 'اليوم / الفترة' : 'التاريخ / الوقت'}
                      </th>
                      <th className="px-4 py-3 text-sm font-bold text-slate-700 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {parsedData.map((item, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-all">
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-900 text-sm">{item.moduleName}</p>
                          {!item.moduleId && <span className="text-[10px] text-red-500 font-bold uppercase">لم يتم التعرف على المقياس</span>}
                          
                          {type === 'exams' && (
                            <div className="mt-1 space-y-1">
                              {item.roomAssignments && item.roomAssignments.length > 0 ? (
                                <div className="flex flex-col gap-1">
                                  <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full w-fit">توزيع تفصيلي ({item.roomAssignments.length} قاعات)</span>
                                  <div className="space-y-0.5">
                                    {item.roomAssignments.slice(0, 3).map((ra: any, idx: number) => (
                                      <div key={idx} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                        <span className="font-bold text-slate-700">{ra.roomName || '؟'}:</span>
                                        <span className="truncate max-w-[200px]">
                                          {Array.isArray(ra.invigilatorNames) ? ra.invigilatorNames.join('، ') : '---'}
                                        </span>
                                      </div>
                                    ))}
                                    {item.roomAssignments.length > 3 && (
                                      <p className="text-[9px] text-slate-400 italic">...و {item.roomAssignments.length - 3} قاعات أخرى</p>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                item.invigilatorNames && item.invigilatorNames.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {item.invigilatorNames.map((name: string, idx: number) => {
                                      const isMatched = item.invigilators?.some((id: string) => {
                                        const t = teachers.find(teach => teach.uid === id);
                                        return t && isFuzzyMatch(t.displayName, name);
                                      });
                                      return (
                                        <span key={idx} className={cn(
                                          "text-[9px] px-1 rounded border",
                                          isMatched ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-red-50 border-red-100 text-red-600"
                                        )}>
                                          {name}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-slate-600 text-sm">{item.specialtyName}</p>
                          {!item.specialtyId && <span className="text-[10px] text-red-500 font-bold uppercase">تخصص غير مطابق</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {type === 'semester' ? `${item.day} - ${item.period}` : `${item.date} (${item.time})`}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {item.matched ? (
                            <div className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg text-xs font-bold">
                              <CheckCircle2 className="w-3 h-3" /> مطابق
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1 bg-red-50 text-red-600 px-2 py-1 rounded-lg text-xs font-bold">
                              <AlertCircle className="w-3 h-3" /> يحتاج مراجعة
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 rounded-b-[32px]">
          <button 
            onClick={onClose}
            className="px-6 py-3 bg-white text-slate-600 rounded-2xl font-bold border border-slate-200 hover:bg-slate-50 transition-all shadow-sm"
          >
            إلغاء
          </button>
          {step === 'review' && (
            <button 
              onClick={handleConfirmImport}
              disabled={loading || parsedData.filter(d => d.matched).length === 0}
              className="px-8 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              تأكيد الاستيراد ({parsedData.filter(d => d.id || d.matched).length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
