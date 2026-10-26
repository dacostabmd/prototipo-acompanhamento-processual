'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'bf:devVisaoAdvogado';
const CHANGE_EVENT = 'devVisao:change';

export function getDevVisaoAdvogado(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDevVisaoAdvogado(value: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Reflete a simulação "usuário comum / advogado" do protótipo (sincronizada via localStorage). */
export function useDevVisaoAdvogado(): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    setValue(getDevVisaoAdvogado());
    const onChange = () => setValue(getDevVisaoAdvogado());
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return value;
}
