'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Tabs, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Plus } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useProfile } from '@/lib/useProfile';
import type { AutomacaoRegra } from '@/lib/automacao';
import AutomacaoTabela from '@/components/automacao/AutomacaoTabela';
import ModalConfigurarRegra from '@/components/automacao/ModalConfigurarRegra';

export default function AutomacaoPage() {
  const router = useRouter();
  const { profile, loading: carregandoPerfil } = useProfile();
  const [regras, setRegras] = useState<AutomacaoRegra[] | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<string | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  useEffect(() => {
    if (!carregandoPerfil && profile.role === 'cliente') {
      router.replace('/painel');
    }
  }, [carregandoPerfil, profile.role, router]);

  useEffect(() => {
    authFetch('/api/automacao/regras')
      .then(res => res.json())
      .then(data => {
        const lista: AutomacaoRegra[] = data.regras ?? [];
        setRegras(lista);
        if (lista.length > 0) setAbaAtiva(lista[0].id);
      })
      .catch(() => setRegras([]));
  }, []);

  const onRegraSalva = (regra: AutomacaoRegra) => {
    setRegras(prev => {
      const atual = prev ?? [];
      const existe = atual.some(r => r.id === regra.id);
      const proxima = existe ? atual.map(r => (r.id === regra.id ? regra : r)) : [...atual, regra];
      return proxima;
    });
    setAbaAtiva(regra.id);
  };

  if (profile.role === 'cliente') return null;

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-white">Automação de funis</h1>
      <p className="mt-2 text-white/60">Busque números de processo em deals do Bitrix24 e enriqueça automaticamente com InfoSimples e DataJud.</p>

      <div className="mt-8 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md">
        {regras === null && <p className="text-sm text-white/60">Carregando…</p>}

        {regras !== null && (
          <Tabs value={abaAtiva} onChange={setAbaAtiva} keepMounted={false}>
            <div className="flex items-start justify-between gap-3">
              <Tabs.List className="flex-1">
                {regras.map(regra => (
                  <Tabs.Tab key={regra.id} value={regra.id}>
                    {regra.nome}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              <Tooltip label="Nova aba de automação">
                <ActionIcon variant="subtle" color="gray" onClick={openModal} aria-label="Adicionar aba">
                  <Plus size={18} strokeWidth={1.8} />
                </ActionIcon>
              </Tooltip>
            </div>

            {regras.length === 0 && (
              <p className="mt-6 text-sm text-white/60">
                Nenhuma aba configurada ainda. Clique no ícone &quot;+&quot; para criar a primeira, escolhendo o funil, a etapa e o campo do número de processo no Bitrix.
              </p>
            )}

            {regras.map(regra => (
              <Tabs.Panel key={regra.id} value={regra.id} pt="md">
                <AutomacaoTabela regra={regra} />
              </Tabs.Panel>
            ))}
          </Tabs>
        )}
      </div>

      <ModalConfigurarRegra opened={modalOpened} onClose={closeModal} onSalvo={onRegraSalva} />
    </div>
  );
}
