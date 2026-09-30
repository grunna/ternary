(function (global) {
  'use strict';

  class ProjectStorage {
    constructor(dbName = 'ternary-lab', storeName = 'projects') {
      this.dbName = dbName;
      this.storeName = storeName;
      this.metaStoreName = 'meta';
      this.dbPromise = null;
    }

    open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(this.metaStoreName)) {
            db.createObjectStore(this.metaStoreName, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
      });
      return this.dbPromise;
    }

    async save(id, project) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put({ id, savedAt: new Date().toISOString(), project });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Could not save project.'));
      });
    }

    async load(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const request = tx.objectStore(this.storeName).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('Could not load project.'));
      });
    }

    async list() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const request = tx.objectStore(this.storeName).getAll();
        request.onsuccess = () => resolve((request.result || []).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))));
        request.onerror = () => reject(request.error || new Error('Could not list projects.'));
      });
    }

    async remove(id) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Could not delete project.'));
      });
    }

    async setMeta(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.metaStoreName, 'readwrite');
        tx.objectStore(this.metaStoreName).put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Could not save app metadata.'));
      });
    }

    async getMeta(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.metaStoreName, 'readonly');
        const request = tx.objectStore(this.metaStoreName).get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => reject(request.error || new Error('Could not load app metadata.'));
      });
    }
  }

  global.TernaryStorage = { ProjectStorage };
})(window);
