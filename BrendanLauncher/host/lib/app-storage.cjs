'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const MAX_TRANSFER = 65536;
const MAX_FILES = 256;
const MAX_DIRECTORIES = 256;
const MAX_STORAGE_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 8;
const STATUS = Object.freeze({
  OK: 0,
  NOT_FOUND: 1,
  INVALID_PATH: 2,
  BUFFER: 3,
  TOO_LARGE: 4,
  NOT_FILE: 5,
  NOT_DIRECTORY: 6,
  QUOTA: 7,
  IO: 8
});
const APP_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

class StorageError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
  }
}

function validatePath(value, allowRoot = false) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') >= 96 ||
      value.includes('\\') || /[\u0000-\u001f\u007f<>:"|?*]/.test(value) ||
      path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new StorageError('invalid storage path', STATUS.INVALID_PATH);
  }
  if (!value) {
    if (allowRoot) return [];
    throw new StorageError('storage path is empty', STATUS.INVALID_PATH);
  }
  const parts = value.split('/');
  if (parts.length > MAX_DEPTH || parts.some(part =>
    !part || part === '.' || part === '..' || /[. ]$/.test(part) || RESERVED_NAME.test(part))) {
    throw new StorageError('invalid storage path component', STATUS.INVALID_PATH);
  }
  return parts;
}

async function lstatOrNull(target) {
  try { return await fs.lstat(target); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

class AppStorage {
  constructor(baseDir, appId) {
    if (!APP_ID.test(appId || '')) throw new TypeError('invalid app id for storage');
    this.baseDir = path.resolve(baseDir);
    this.appId = appId;
    this.root = null;
  }

  async appRoot() {
    if (this.root) return this.root;
    await fs.mkdir(this.baseDir, {recursive: true, mode: 0o700});
    const base = await fs.realpath(this.baseDir);
    const root = path.join(base, this.appId);
    const existing = await lstatOrNull(root);
    if (!existing) await fs.mkdir(root, {mode: 0o700});
    else if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new StorageError('app storage root is not a directory', STATUS.INVALID_PATH);
    this.root = root;
    return root;
  }

  async resolve(value, {allowRoot = false, createParents = false,
                        allowMissingLeaf = false} = {}) {
    const parts = validatePath(value, allowRoot);
    let current = await this.appRoot();
    for (let index = 0; index < parts.length; index++) {
      const next = path.join(current, parts[index]);
      const info = await lstatOrNull(next);
      const last = index === parts.length - 1;
      if (!info) {
        if (last && allowMissingLeaf) {
          current = next;
          continue;
        }
        if (last || !createParents)
          throw new StorageError('storage path not found', STATUS.NOT_FOUND);
        const usage = await this.quota();
        if (usage.directories >= MAX_DIRECTORIES)
          throw new StorageError('app storage directory quota exceeded', STATUS.QUOTA);
        await fs.mkdir(next, {mode: 0o700});
      } else if (info.isSymbolicLink()) {
        throw new StorageError('symbolic links are not allowed in app storage', STATUS.INVALID_PATH);
      } else if (!last && !info.isDirectory()) {
        throw new StorageError('storage parent is not a directory', STATUS.NOT_DIRECTORY);
      }
      current = next;
    }
    return {path: current, info: parts.length ? await lstatOrNull(current) : null};
  }

  async quota() {
    const root = await this.appRoot();
    let bytes = 0, files = 0, directories = 0;
    const walk = async (directory, depth) => {
      if (depth > MAX_DEPTH)
        throw new StorageError('storage directory depth limit exceeded', STATUS.QUOTA);
      for (const name of await fs.readdir(directory)) {
        const info = await fs.lstat(path.join(directory, name));
        if (info.isSymbolicLink())
          throw new StorageError('symbolic links are not allowed in app storage', STATUS.INVALID_PATH);
        if (info.isDirectory()) {
          directories++;
          if (directories > MAX_DIRECTORIES)
            throw new StorageError('app storage directory quota exceeded', STATUS.QUOTA);
          await walk(path.join(directory, name), depth + 1);
        }
        else if (info.isFile()) {
          files++;
          bytes += info.size;
          if (files > MAX_FILES || bytes > MAX_STORAGE_BYTES)
            throw new StorageError('app storage quota is already exceeded', STATUS.QUOTA);
        } else {
          throw new StorageError('unsupported file in app storage', STATUS.INVALID_PATH);
        }
      }
    };
    await walk(root, 0);
    return {bytes, files, directories};
  }

  async read(value, capacity) {
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > MAX_TRANSFER)
      throw new StorageError('invalid read capacity', STATUS.TOO_LARGE);
    const resolved = await this.resolve(value);
    if (!resolved.info.isFile())
      throw new StorageError('storage path is not a file', STATUS.NOT_FILE);
    const file = await fs.open(resolved.path, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new StorageError('storage path is not a file', STATUS.NOT_FILE);
      if (info.size > MAX_TRANSFER) throw new StorageError('file exceeds transfer limit', STATUS.TOO_LARGE);
      if (info.size > capacity) throw new StorageError('read buffer is too small', STATUS.BUFFER);
      const data = await file.readFile();
      if (data.length > capacity || data.length > MAX_TRANSFER)
        throw new StorageError('file changed beyond read capacity', STATUS.BUFFER);
      return data;
    } finally { await file.close(); }
  }

  async write(value, data) {
    if (!Buffer.isBuffer(data) || data.length > MAX_TRANSFER)
      throw new StorageError('write exceeds transfer limit', STATUS.TOO_LARGE);
    const resolved = await this.resolve(value,
      {createParents: true, allowMissingLeaf: true});
    if (resolved.info && !resolved.info.isFile())
      throw new StorageError('storage path is not a file', STATUS.NOT_FILE);
    const usage = await this.quota();
    const previousBytes = resolved.info ? resolved.info.size : 0;
    const newFile = !resolved.info;
    if (usage.bytes - previousBytes + data.length > MAX_STORAGE_BYTES ||
        (newFile && usage.files >= MAX_FILES))
      throw new StorageError('app storage quota exceeded', STATUS.QUOTA);

    const temporary = path.join(path.dirname(resolved.path), `.hbl-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.close();
      await fs.rename(temporary, resolved.path);
    } catch (error) {
      try { await handle.close(); } catch (closeError) { error.closeError = closeError; }
      try { await fs.unlink(temporary); }
      catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError;
      }
      throw error;
    }
    return data.length;
  }

  async list(value, capacity) {
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > MAX_TRANSFER)
      throw new StorageError('invalid list capacity', STATUS.TOO_LARGE);
    const resolved = await this.resolve(value, {allowRoot: true});
    const info = resolved.info || await fs.lstat(resolved.path);
    if (!info.isDirectory())
      throw new StorageError('storage path is not a directory', STATUS.NOT_DIRECTORY);
    const entries = [];
    for (const name of (await fs.readdir(resolved.path)).sort()) {
      const child = await fs.lstat(path.join(resolved.path, name));
      if (child.isSymbolicLink()) continue;
      if (!child.isFile() && !child.isDirectory()) continue;
      try { validatePath(name); }
      catch (error) {
        if (error instanceof StorageError && error.status === STATUS.INVALID_PATH) continue;
        throw error;
      }
      entries.push(name + (child.isDirectory() ? '/' : '') + '\n');
    }
    const data = Buffer.from(entries.join(), 'utf8');
    if (data.length > MAX_TRANSFER) throw new StorageError('directory listing is too large', STATUS.TOO_LARGE);
    if (data.length > capacity) throw new StorageError('list buffer is too small', STATUS.BUFFER);
    return data;
  }

  async remove(value) {
    const resolved = await this.resolve(value);
    if (!resolved.info.isFile())
      throw new StorageError('only regular files can be removed', STATUS.NOT_FILE);
    await fs.unlink(resolved.path);
  }
}

async function handleStorageRequest(storage, operation, value, input, capacity) {
  try {
    if (operation === 1) return {status: STATUS.OK, data: await storage.read(value, capacity)};
    if (operation === 2) {
      await storage.write(value, input);
      return {status: STATUS.OK, data: Buffer.alloc(0)};
    }
    if (operation === 3) return {status: STATUS.OK, data: await storage.list(value, capacity)};
    if (operation === 4) {
      await storage.remove(value);
      return {status: STATUS.OK, data: Buffer.alloc(0)};
    }
    return {status: STATUS.INVALID_PATH, data: Buffer.alloc(0)};
  } catch (error) {
    if (error instanceof StorageError) return {status: error.status, data: Buffer.alloc(0)};
    if (error.code === 'ENOENT') return {status: STATUS.NOT_FOUND, data: Buffer.alloc(0)};
    if (error.code === 'EISDIR' || error.code === 'ENOTDIR')
      return {status: STATUS.NOT_FILE, data: Buffer.alloc(0)};
    throw error;
  }
}

module.exports = {
  AppStorage, StorageError, STATUS, MAX_TRANSFER, MAX_FILES, MAX_DIRECTORIES,
  MAX_STORAGE_BYTES, handleStorageRequest
};
