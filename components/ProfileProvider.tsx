'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useProfileQuery, type Profile } from '@/lib/useProfile';

interface ProfileContextValue {
  profile: Profile;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

/**
 * Busca o perfil (role/documento) uma única vez no nível do shell autenticado e o compartilha
 * via Context. Antes, cada page.tsx que chamava useProfile() disparava sua própria dupla de
 * chamadas ao Supabase (auth.getUser + select ap_perfis) de forma independente, duplicando
 * round-trips a cada navegação (ex: /automacao e /processos refaziam o que o AppShellLayout
 * já tinha acabado de buscar).
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const value = useProfileQuery();
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/** Lê o perfil do Context mais próximo (ProfileProvider, montado uma vez no AppShellLayout). */
export function useSharedProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useSharedProfile deve ser usado dentro de ProfileProvider');
  return ctx;
}
