'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from './supabase';

export type ProfileRole = 'cliente' | 'advogado' | 'broker' | 'admin' | 'owner';

export interface Profile {
  role: ProfileRole;
  nome: string;
  documento: string;
  documentoTipo: 'cpf' | 'cnpj' | '';
}

const EMPTY_PROFILE: Profile = { role: 'advogado', nome: '', documento: '', documentoTipo: '' };

function readDemoProfile(): Profile {
  try {
    const demo = localStorage.getItem('bf-demo-user') ?? '';
    const role = (localStorage.getItem('bf-demo-role') as ProfileRole) || 'advogado';
    const documento = localStorage.getItem('bf-demo-documento') ?? '';
    const documentoTipo = (localStorage.getItem('bf-demo-documento-tipo') as 'cpf' | 'cnpj' | '') || '';
    return { role, nome: demo.includes('@') ? demo.split('@')[0] : '', documento, documentoTipo };
  } catch {
    return EMPTY_PROFILE;
  }
}

/**
 * Carrega o perfil (role + documento fixo do consultante) uma vez, com fallback ao modo demo sem
 * Supabase. Prefira useSharedProfile() (components/ProfileProvider.tsx) em componentes dentro do
 * shell autenticado — essa função aqui é a busca "crua", reaproveitada pelo Provider, mas chamá-la
 * direto em várias páginas duplica as chamadas ao Supabase a cada navegação.
 */
export function useProfileQuery(): { profile: Profile; loading: boolean; refresh: () => Promise<void> } {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setProfile(readDemoProfile());
      setLoading(false);
      return;
    }

    try {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (!u) {
        setLoading(false);
        return;
      }

      // Sincroniza role / documento pendente de login com Google se houver
      try {
        const pendingRole = localStorage.getItem('bf_pending_role');
        const pendingDoc = localStorage.getItem('bf_pending_documento');
        const pendingDocTipo = localStorage.getItem('bf_pending_documento_tipo');
        if (pendingRole) {
          await supabase.from('ap_perfis').update({
            role: pendingRole,
            ...(pendingDoc ? { documento: pendingDoc, documento_tipo: pendingDocTipo || (pendingDoc.length === 14 ? 'cnpj' : 'cpf') } : {})
          }).eq('id', u.id);
          localStorage.removeItem('bf_pending_role');
          localStorage.removeItem('bf_pending_documento');
          localStorage.removeItem('bf_pending_documento_tipo');
        }
      } catch {}

      const { data: perfil } = await supabase.from('ap_perfis').select('nome,role,documento,documento_tipo').eq('id', u.id).maybeSingle();
      setProfile({
        role: (perfil?.role as ProfileRole) || 'advogado',
        nome: perfil?.nome ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? '',
        documento: perfil?.documento ?? '',
        documentoTipo: (perfil?.documento_tipo as 'cpf' | 'cnpj' | '') || ''
      });
    } catch {
      setProfile(readDemoProfile());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProfile();
  }, []);

  return { profile, loading, refresh: fetchProfile };
}
