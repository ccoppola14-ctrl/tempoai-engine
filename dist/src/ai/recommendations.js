"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRecommendations = generateRecommendations;
exports.generateComboRecommendations = generateComboRecommendations;
const uuid_1 = require("uuid");
const patterns_1 = require("./patterns");
function patternTypeToTriggerType(patternType) {
    switch (patternType) {
        case 'temperature':
            return 'temperature';
        case 'weather':
            return 'weather';
        case 'daypart':
            return 'daypart';
        case 'day_of_week':
            return 'day_of_week';
        case 'trend':
            return 'trend';
        default:
            return 'weather';
    }
}
function determineRecommendationType(pattern) {
    if (pattern.liftPercent > 0) {
        if (pattern.patternType === 'daypart')
            return 'timing';
        return 'promote';
    }
    return 'demote';
}
function determineChannels(pattern) {
    const channels = [];
    if (pattern.liftPercent > 30) {
        channels.push('menu_board', 'drive_thru', 'cashier');
    }
    else if (pattern.liftPercent > 0) {
        channels.push('menu_board', 'cashier');
    }
    else {
        channels.push('menu_board');
    }
    if (pattern.patternType === 'daypart' || pattern.patternType === 'day_of_week') {
        channels.push('audio');
    }
    return [...new Set(channels)];
}
function generateDetailedMessage(pattern) {
    const absLift = Math.abs(pattern.liftPercent);
    switch (pattern.patternType) {
        case 'temperature': {
            const action = pattern.liftPercent > 0 ? 'Promote' : 'De-emphasize';
            return `${action} ${pattern.menuItemName} — historically ${pattern.liftPercent > 0 ? '+' : ''}${pattern.liftPercent}% sales when ${pattern.triggerCondition}`;
        }
        case 'weather': {
            const action = pattern.liftPercent > 0 ? 'Promote' : 'De-emphasize';
            return `${action} ${pattern.menuItemName} — ${pattern.liftPercent > 0 ? '+' : ''}${pattern.liftPercent}% sales during ${pattern.triggerCondition} weather`;
        }
        case 'daypart':
            return `${pattern.menuItemName} peaks during ${pattern.triggerCondition} — consider featuring in that daypart (+${absLift}%)`;
        case 'day_of_week':
            return `${pattern.menuItemName} ${pattern.liftPercent > 0 ? 'spikes' : 'dips'} on ${pattern.triggerCondition}s (${pattern.liftPercent > 0 ? '+' : ''}${pattern.liftPercent}%)`;
        case 'trend':
            return `${pattern.menuItemName} is ${pattern.triggerCondition === 'trending_up' ? 'gaining popularity' : 'losing traction'} — ${absLift}% change over 30 days`;
        default:
            return (0, patterns_1.generatePatternMessage)(pattern);
    }
}
function generateRecommendations(locationId, patterns, currentConditions) {
    const recommendations = [];
    // Sort patterns by magnitude (absolute lift) and confidence
    const sorted = [...patterns].sort((a, b) => Math.abs(b.liftPercent) * b.confidence - Math.abs(a.liftPercent) * a.confidence);
    for (const pattern of sorted) {
        const isCurrentlyActive = checkIfActive(pattern, currentConditions);
        const rec = {
            id: (0, uuid_1.v4)(),
            locationId,
            type: determineRecommendationType(pattern),
            itemId: pattern.menuItemId,
            itemName: pattern.menuItemName,
            trigger: {
                type: patternTypeToTriggerType(pattern.patternType),
                condition: pattern.triggerCondition,
                currentlyActive: isCurrentlyActive,
            },
            impact: {
                expectedLift: pattern.liftPercent,
                confidence: pattern.confidence,
                historicalDataPoints: pattern.dataPoints,
            },
            message: generateDetailedMessage(pattern),
            channels: determineChannels(pattern),
            createdAt: new Date(),
        };
        recommendations.push(rec);
    }
    return recommendations;
}
function generateComboRecommendations(locationId, combos) {
    return combos.slice(0, 10).map((combo) => ({
        id: (0, uuid_1.v4)(),
        locationId,
        type: 'upsell',
        itemId: combo.itemA,
        itemName: combo.itemAName,
        trigger: {
            type: 'daypart',
            condition: `ordered_with_${combo.itemBName.toLowerCase().replace(/\s+/g, '_')}`,
            currentlyActive: true,
        },
        impact: {
            expectedLift: combo.confidenceAtoB,
            confidence: Math.min(combo.coOccurrenceCount / 50, 1),
            historicalDataPoints: combo.coOccurrenceCount,
        },
        message: `Upsell ${combo.itemBName} when customer orders ${combo.itemAName} — ${combo.confidenceAtoB}% co-purchase rate`,
        channels: ['cashier', 'drive_thru'],
        createdAt: new Date(),
    }));
}
function checkIfActive(pattern, conditions) {
    if (!conditions)
        return false;
    switch (pattern.patternType) {
        case 'temperature': {
            if (conditions.temperature === undefined)
                return false;
            const cond = pattern.triggerCondition;
            if (cond === 'temp < 60')
                return conditions.temperature < 60;
            if (cond === 'temp 60-75')
                return conditions.temperature >= 60 && conditions.temperature < 75;
            if (cond === 'temp 75-85')
                return conditions.temperature >= 75 && conditions.temperature < 85;
            if (cond === 'temp > 85')
                return conditions.temperature >= 85;
            return false;
        }
        case 'weather':
            return conditions.weather === pattern.triggerCondition;
        case 'daypart':
            return conditions.daypart === pattern.triggerCondition;
        case 'day_of_week': {
            if (conditions.dayOfWeek === undefined)
                return false;
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return dayNames[conditions.dayOfWeek] === pattern.triggerCondition;
        }
        case 'trend':
            return true; // Trends are always "active"
        default:
            return false;
    }
}
//# sourceMappingURL=recommendations.js.map