export interface CurrentWeather {
    temperature: number;
    windSpeed: number;
    weatherCode: number;
    conditions: string;
}
export interface HourlyForecast {
    time: string[];
    temperature: number[];
    precipitation: number[];
    weatherCode: number[];
    humidity: number[];
    windSpeed: number[];
}
export interface WeatherData {
    current: CurrentWeather;
    hourly: HourlyForecast;
}
/** WMO Weather interpretation codes → human-readable conditions */
export declare function weatherCodeToCondition(code: number): string;
export declare function isRainy(conditions: string): boolean;
export declare function isSnowy(conditions: string): boolean;
export declare function isClear(conditions: string): boolean;
//# sourceMappingURL=types.d.ts.map