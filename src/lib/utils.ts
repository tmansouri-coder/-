import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PedagogicalCalendar } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isDateExcluded(dateStr: string, calendar: PedagogicalCalendar | null) {
  if (!calendar) return false;
  
  // Check explicit excluded days
  if (calendar.excludedDays.includes(dateStr)) return true;
  
  // Check events (especially holidays)
  if (calendar.events) {
    const date = new Date(dateStr);
    return calendar.events.some(event => {
      const start = new Date(event.startDate);
      const end = new Date(event.endDate);
      // Normalize dates to midnight for comparison
      date.setHours(0, 0, 0, 0);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      
      return date >= start && date <= end;
    });
  }
  
  return false;
}

export function getDatesForDay(dayName: string, startDate: string, endDate: string) {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const dayMap: Record<string, number> = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6
  };
  
  const targetDay = dayMap[dayName];
  
  let current = new Date(start);
  while (current <= end) {
    if (current.getDay() === targetDay) {
      dates.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

export function mapLevelName(name: string, cycleName?: string) {
  const map: Record<string, string> = {
    'L1': "First Year Bachelor's",
    'L2': "Second Year Bachelor's",
    'L3': "Third Year Bachelor's",
    'M1': "First Year Master's",
    'M2': "Second Year Master's"
  };

  const isEngineering = cycleName && (cycleName.includes('مهندس') || cycleName.toLowerCase().includes('engineer'));
  
  if (isEngineering) {
    const lower = name.toLowerCase();
    if (lower.includes('first') || name.includes('1')) return "1st Year Engineering";
    if (lower.includes('second') || name.includes('2')) return "2nd Year Engineering";
    if (lower.includes('third') || name.includes('3')) return "3rd Year Engineering";
    if (lower.includes('fourth') || name.includes('4')) return "4th Year Engineering";
    if (lower.includes('fifth') || name.includes('5')) return "5th Year Engineering";
    
    const numMatch = name.match(/\d+/);
    if (numMatch) {
      const n = parseInt(numMatch[0]);
      const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
      return `${n}${suffix} Year Engineering`;
    }
  }

  return map[name] || name;
}
