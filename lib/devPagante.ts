'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'bf:devPagante';
const CHANGE_EVENT = 'devPagante:change';

export function getDevPagante(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDevPagante(value: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Reflete o estado da simulação de conta pagante/não pagante do protótipo (sincronizado via localStorage). */
export function useDevPagante(): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    setValue(getDevPagante());
    const onChange = () => setValue(getDevPagante());
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return value;
}

