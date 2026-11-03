import { safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SecretVault } from "@easily/core";

/**
 * API keys and MCP secrets live ONLY here (CLAUDE.md, P-001). Each value is encrypted with the
 * OS keychain via Electron safeStorage; the file holds base64 ciphertext keyed by reference.
 * If the OS cannot encrypt, storing is refused — there is no plaintext fallback.
 */
export class SafeStorageVault implements SecretVault {
  private entries: Record<string, string> = {};

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      try {
        this.entries = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      } catch {
        this.entries = {}; // corrupt file: start empty rather than crash
      }
    }
  }

  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  get(ref: string): string | undefined {
    const blob = this.entries[ref];
    if (!blob) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(blob, "base64"));
    } catch {
      return undefined; // e.g. profile copied to another machine/user
    }
  }

  set(ref: string, value: string): void {
    if (!this.available()) throw new Error("이 컴퓨터에서는 OS 보안 저장소를 사용할 수 없어 키를 저장할 수 없습니다.");
    this.entries[ref] = safeStorage.encryptString(value).toString("base64");
    this.persist();
  }

  delete(ref: string): void {
    if (ref in this.entries) {
      delete this.entries[ref];
      this.persist();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.entries), "utf8");
    renameSync(`${this.file}.tmp`, this.file);
  }
}
