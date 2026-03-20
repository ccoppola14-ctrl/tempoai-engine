export type Daypart = 'early_morning' | 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late_night';
export interface DaypartDefinition {
    name: Daypart;
    label: string;
    startHour: number;
    endHour: number;
}
export declare const DAYPARTS: DaypartDefinition[];
export declare function getDaypart(hour: number): Daypart;
export declare function getDaypartLabel(daypart: Daypart): string;
export declare const DAY_NAMES: string[];
export declare function getDayName(dayOfWeek: number): string;
//# sourceMappingURL=dayparts.d.ts.map