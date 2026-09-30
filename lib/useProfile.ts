'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from './supabase';

export type ProfileRole = 'cliente' | 'advogado' | 'admin';

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

/** Carrega o perfil (role + documento fixo do consultante) uma vez, com fallback ao modo demo sem Supabase. */
export function useProfile(): { profile: Profile; loading: boolean } {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setProfile(readDemoProfile());
      setLoading(false);
      return;
    }
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (!u) {
        setLoading(false);
        return;
      }
      const { data: perfil } = await supabase.from('ap_perfis').select('nome,role,documento,documento_tipo').eq('id', u.id).maybeSingle();
      setProfile({
        role: (perfil?.role as ProfileRole) || 'advogado',
        nome: perfil?.nome ?? u.user_metadata?.full_name ?? u.user_metadata?.name ?? '',
        documento: perfil?.documento ?? '',
        documentoTipo: (perfil?.documento_tipo as 'cpf' | 'cnpj' | '') || ''
      });
      setLoading(false);
    })();
  }, []);

  return { profile, loading };
}
