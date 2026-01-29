import { createDecipheriv, createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { getEnv } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

/**
 * Decrypts Wallet.encryptedKey using ENCRYPTION_KEY.
 * Expects ciphertext in format: salt (32) + iv (16) + tag (16) + encrypted data.
 */
export class WalletManager {
  static decrypt(encryptedKey: string): string {
    const buf = Buffer.from(encryptedKey, "hex");
    if (buf.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
      throw new Error("Invalid encrypted key format");
    }
    let offset = 0;
    const salt = buf.subarray(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;
    const iv = buf.subarray(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;
    const tag = buf.subarray(offset, offset + TAG_LENGTH);
    offset += TAG_LENGTH;
    const ciphertext = buf.subarray(offset);
    const derivedKey = scryptSync(getEnv().ENCRYPTION_KEY, salt, KEY_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
  }

  static encrypt(plaintext: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = scryptSync(getEnv().ENCRYPTION_KEY, salt, KEY_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([salt, iv, tag, encrypted]).toString("hex");
  }
}
