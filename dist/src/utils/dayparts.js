"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_NAMES = exports.DAYPARTS = void 0;
exports.getDaypart = getDaypart;
exports.getDaypartLabel = getDaypartLabel;
exports.getDayName = getDayName;
exports.DAYPARTS = [
    { name: 'early_morning', label: 'Early Morning', startHour: 5, endHour: 7 },
    { name: 'breakfast', label: 'Breakfast', startHour: 7, endHour: 11 },
    { name: 'lunch', label: 'Lunch', startHour: 11, endHour: 14 },
    { name: 'afternoon', label: 'Afternoon', startHour: 14, endHour: 17 },
    { name: 'dinner', label: 'Dinner', startHour: 17, endHour: 21 },
    { name: 'late_night', label: 'Late Night', startHour: 21, endHour: 5 },
];
function getDaypart(hour) {
    if (hour >= 21 || hour < 5)
        return 'late_night';
    if (hour >= 5 && hour < 7)
        return 'early_morning';
    if (hour >= 7 && hour < 11)
        return 'breakfast';
    if (hour >= 11 && hour < 14)
        return 'lunch';
    if (hour >= 14 && hour < 17)
        return 'afternoon';
    return 'dinner';
}
function getDaypartLabel(daypart) {
    return exports.DAYPARTS.find(d => d.name === daypart)?.label ?? daypart;
}
exports.DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function getDayName(dayOfWeek) {
    return exports.DAY_NAMES[dayOfWeek] ?? 'Unknown';
}
//# sourceMappingURL=dayparts.js.map