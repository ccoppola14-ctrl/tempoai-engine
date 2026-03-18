import prisma from '../../db/client';
import { logger } from '../../utils/logger';
import cron from 'node-cron';
import { weatherCodeToCondition } from './types';
import type { WeatherData } from './types';

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    current_weather: 'true',
    hourly: 'temperature_2m,precipitation,weathercode,relativehumidity_2m,windspeed_10m',
    temperature_unit: 'fahrenheit',
    windspeed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
  });

  const response = await fetch(`${OPEN_METEO_BASE}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    current_weather?: { temperature?: number; windspeed?: number; weathercode?: number };
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      precipitation?: number[];
      weathercode?: number[];
      relativehumidity_2m?: number[];
      windspeed_10m?: number[];
    };
  };

  return {
    current: {
      temperature: data.current_weather?.temperature ?? 0,
      windSpeed: data.current_weather?.windspeed ?? 0,
      weatherCode: data.current_weather?.weathercode ?? 0,
      conditions: weatherCodeToCondition(data.current_weather?.weathercode ?? 0),
    },
    hourly: {
      time: data.hourly?.time ?? [],
      temperature: data.hourly?.temperature_2m ?? [],
      precipitation: data.hourly?.precipitation ?? [],
      weatherCode: data.hourly?.weathercode ?? [],
      humidity: data.hourly?.relativehumidity_2m ?? [],
      windSpeed: data.hourly?.windspeed_10m ?? [],
    },
  };
}

export async function snapshotWeather(locationId: string): Promise<void> {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    logger.warn('Weather', `Location ${locationId} not found`);
    return;
  }

  try {
    const weather = await fetchWeather(location.lat, location.lng);

    await prisma.weatherSnapshot.create({
      data: {
        locationId,
        timestamp: new Date(),
        temperature: weather.current.temperature,
        conditions: weather.current.conditions,
        precipitation: 0,
        humidity: 0,
        windSpeed: weather.current.windSpeed,
      },
    });

    logger.info('Weather', `Snapshot saved for ${location.name}: ${weather.current.temperature}°F, ${weather.current.conditions}`);
  } catch (err) {
    logger.error('Weather', `Failed to snapshot weather for ${locationId}`, err);
  }
}

export async function snapshotAllLocations(): Promise<void> {
  const locations = await prisma.location.findMany();
  for (const location of locations) {
    await snapshotWeather(location.id);
  }
}

export function startWeatherSchedule(): void {
  if (process.env.DEMO_MODE === 'true') {
    logger.info('Weather', 'Demo mode — skipping weather schedule');
    return;
  }

  // Every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Weather', 'Running hourly weather snapshot...');
    await snapshotAllLocations();
  });

  logger.info('Weather', 'Weather snapshot scheduled every hour');
}
