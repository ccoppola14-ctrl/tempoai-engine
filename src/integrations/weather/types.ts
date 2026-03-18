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
export function weatherCodeToCondition(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly_cloudy';
  if (code <= 49) return 'foggy';
  if (code <= 59) return 'drizzle';
  if (code <= 69) return 'rain';
  if (code <= 79) return 'snow';
  if (code <= 84) return 'rain'; // rain showers
  if (code <= 89) return 'snow'; // snow showers
  if (code <= 99) return 'thunderstorm';
  return 'unknown';
}

export function isRainy(conditions: string): boolean {
  return ['drizzle', 'rain', 'thunderstorm'].includes(conditions);
}

export function isSnowy(conditions: string): boolean {
  return conditions === 'snow';
}

export function isClear(conditions: string): boolean {
  return conditions === 'clear';
}
