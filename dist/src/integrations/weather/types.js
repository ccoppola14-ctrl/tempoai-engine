"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weatherCodeToCondition = weatherCodeToCondition;
exports.isRainy = isRainy;
exports.isSnowy = isSnowy;
exports.isClear = isClear;
/** WMO Weather interpretation codes → human-readable conditions */
function weatherCodeToCondition(code) {
    if (code === 0)
        return 'clear';
    if (code <= 3)
        return 'partly_cloudy';
    if (code <= 49)
        return 'foggy';
    if (code <= 59)
        return 'drizzle';
    if (code <= 69)
        return 'rain';
    if (code <= 79)
        return 'snow';
    if (code <= 84)
        return 'rain'; // rain showers
    if (code <= 89)
        return 'snow'; // snow showers
    if (code <= 99)
        return 'thunderstorm';
    return 'unknown';
}
function isRainy(conditions) {
    return ['drizzle', 'rain', 'thunderstorm'].includes(conditions);
}
function isSnowy(conditions) {
    return conditions === 'snow';
}
function isClear(conditions) {
    return conditions === 'clear';
}
//# sourceMappingURL=types.js.map