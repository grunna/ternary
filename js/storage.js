(function (global) {
  'use strict';

  class ProjectStorage {
    constructor(dbName = 'ternary-lab', storeName = 'projects') {
      this.dbName = dbName;
      this.storeName = storeName;
      this.dbPromise = null;
    }

    open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'id' });
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
  }

  global.TernaryStorage = { ProjectStorage };
})(window);
