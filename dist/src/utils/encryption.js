"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.isEncrypted = isEncrypted;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("./logger");
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
function getKey() {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex) {
        return null;
    }
    return Buffer.from(keyHex, 'hex');
}
/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns format: iv:authTag:ciphertext (all hex-encoded).
 * Throws if ENCRYPTION_KEY is not set.
 */
function encrypt(plaintext) {
    const key = getKey();
    if (!key) {
        throw new Error('ENCRYPTION_KEY environment variable is required for token encryption');
    }
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
/**
 * Decrypt a string in the format iv:authTag:ciphertext (all hex-encoded).
 * If ENCRYPTION_KEY is not set, returns the input as-is.
 * If the input doesn't look encrypted (no colons), returns as-is.
 */
function decrypt(encrypted) {
    const key = getKey();
    if (!key) {
        logger_1.logger.warn('Encryption', 'ENCRYPTION_KEY not set — returning token as-is');
        return encrypted;
    }
    // Detect plaintext tokens (not in iv:authTag:ciphertext format)
    if (!isEncrypted(encrypted)) {
        return encrypted;
    }
    const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}
/**
 * Check if a string looks like an encrypted token (iv:authTag:ciphertext format).
 */
function isEncrypted(value) {
    const parts = value.split(':');
    if (parts.length !== 3)
        return false;
    // iv = 12 bytes = 24 hex chars, authTag = 16 bytes = 32 hex chars
    return parts[0].length === 24 && parts[1].length === 32 && /^[0-9a-f]+$/.test(parts.join(''));
}
//# sourceMappingURL=encryption.js.map