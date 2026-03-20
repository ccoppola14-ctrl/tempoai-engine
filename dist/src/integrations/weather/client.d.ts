import type { WeatherData } from './types';
export declare function fetchWeather(lat: number, lng: number): Promise<WeatherData>;
export declare function snapshotWeather(locationId: string): Promise<void>;
export declare function snapshotAllLocations(): Promise<void>;
export declare function startWeatherSchedule(): void;
//# sourceMappingURL=client.d.ts.map