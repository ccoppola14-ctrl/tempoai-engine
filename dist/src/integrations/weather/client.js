"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWeather = fetchWeather;
exports.snapshotWeather = snapshotWeather;
exports.snapshotAllLocations = snapshotAllLocations;
exports.startWeatherSchedule = startWeatherSchedule;
const client_1 = __importDefault(require("../../db/client"));
const logger_1 = require("../../utils/logger");
const node_cron_1 = __importDefault(require("node-cron"));
const types_1 = require("./types");
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
async function fetchWeather(lat, lng) {
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
    const data = (await response.json());
    return {
        current: {
            temperature: data.current_weather?.temperature ?? 0,
            windSpeed: data.current_weather?.windspeed ?? 0,
            weatherCode: data.current_weather?.weathercode ?? 0,
            conditions: (0, types_1.weatherCodeToCondition)(data.current_weather?.weathercode ?? 0),
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
async function snapshotWeather(locationId) {
    const location = await client_1.default.location.findUnique({ where: { id: locationId } });
    if (!location) {
        logger_1.logger.warn('Weather', `Location ${locationId} not found`);
        return;
    }
    try {
        const weather = await fetchWeather(location.lat, location.lng);
        await client_1.default.weatherSnapshot.create({
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
        logger_1.logger.info('Weather', `Snapshot saved for ${location.name}: ${weather.current.temperature}°F, ${weather.current.conditions}`);
    }
    catch (err) {
        logger_1.logger.error('Weather', `Failed to snapshot weather for ${locationId}`, err);
    }
}
async function snapshotAllLocations() {
    const locations = await client_1.default.location.findMany();
    for (const location of locations) {
        await snapshotWeather(location.id);
    }
}
function startWeatherSchedule() {
    if (process.env.DEMO_MODE === 'true') {
        logger_1.logger.info('Weather', 'Demo mode — skipping weather schedule');
        return;
    }
    // Every hour
    node_cron_1.default.schedule('0 * * * *', async () => {
        logger_1.logger.info('Weather', 'Running hourly weather snapshot...');
        await snapshotAllLocations();
    });
    logger_1.logger.info('Weather', 'Weather snapshot scheduled every hour');
}
//# sourceMappingURL=client.js.map