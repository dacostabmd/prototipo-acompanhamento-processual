'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSharedProfile } from '@/components/ProfileProvider';
import CrmPipelineTabs from '@/components/crm/CrmPipelineTabs';

export default function CrmPage() {
  const router = useRouter();
  const { profile, loading: carregandoPerfil } = useSharedProfile();

  useEffect(() => {
    if (!carregandoPerfil && profile.role === 'cliente') {
      router.replace('/painel');
    }
  }, [carregandoPerfil, profile.role, router]);

  if (profile.role === 'cliente') return null;

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-white">CRM</h1>
      <p className="mt-2 text-white/60">Pipelines de venda configuráveis, com campos personalizados e enriquecimento jurídico por processo (DataJud + Infosimples).</p>

      <div className="mt-8 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md">
        <CrmPipelineTabs />
      </div>
    </div>
  );
}
