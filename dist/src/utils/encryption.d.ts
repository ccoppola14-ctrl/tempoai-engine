/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns format: iv:authTag:ciphertext (all hex-encoded).
 * If ENCRYPTION_KEY is not set, returns plaintext as-is with a warning.
 */
export declare function encrypt(plaintext: string): string;
/**
 * Decrypt a string in the format iv:authTag:ciphertext (all hex-encoded).
 * If ENCRYPTION_KEY is not set, returns the input as-is.
 * If the input doesn't look encrypted (no colons), returns as-is.
 */
export declare function decrypt(encrypted: string): string;
/**
 * Check if a string looks like an encrypted token (iv:authTag:ciphertext format).
 */
export declare function isEncrypted(value: string): boolean;
//# sourceMappingURL=encryption.d.ts.map