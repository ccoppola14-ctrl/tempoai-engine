export type Daypart = 'early_morning' | 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late_night';

export interface DaypartDefinition {
  name: Daypart;
  label: string;
  startHour: number;
  endHour: number;
}

export const DAYPARTS: DaypartDefinition[] = [
  { name: 'early_morning', label: 'Early Morning', startHour: 5, endHour: 7 },
  { name: 'breakfast', label: 'Breakfast', startHour: 7, endHour: 11 },
  { name: 'lunch', label: 'Lunch', startHour: 11, endHour: 14 },
  { name: 'afternoon', label: 'Afternoon', startHour: 14, endHour: 17 },
  { name: 'dinner', label: 'Dinner', startHour: 17, endHour: 21 },
  { name: 'late_night', label: 'Late Night', startHour: 21, endHour: 5 },
];

export function getDaypart(hour: number): Daypart {
  if (hour >= 21 || hour < 5) return 'late_night';
  if (hour >= 5 && hour < 7) return 'early_morning';
  if (hour >= 7 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 14) return 'lunch';
  if (hour >= 14 && hour < 17) return 'afternoon';
  return 'dinner';
}

export function getDaypartLabel(daypart: Daypart): string {
  return DAYPARTS.find(d => d.name === daypart)?.label ?? daypart;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? 'Unknown';
}
