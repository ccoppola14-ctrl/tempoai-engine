"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const LEVEL_PRIORITY = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const currentLevel = process.env.LOG_LEVEL || 'info';
function shouldLog(level) {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}
function formatMessage(level, context, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`;
}
exports.logger = {
    debug(context, message, data) {
        if (shouldLog('debug')) {
            console.debug(formatMessage('debug', context, message), data ?? '');
        }
    },
    info(context, message, data) {
        if (shouldLog('info')) {
            console.info(formatMessage('info', context, message), data ?? '');
        }
    },
    warn(context, message, data) {
        if (shouldLog('warn')) {
            console.warn(formatMessage('warn', context, message), data ?? '');
        }
    },
    error(context, message, data) {
        if (shouldLog('error')) {
            console.error(formatMessage('error', context, message), data ?? '');
        }
    },
};
//# sourceMappingURL=logger.js.map