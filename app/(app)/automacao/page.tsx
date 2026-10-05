'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionIcon, Tabs, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Plus, Settings2 } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useSharedProfile } from '@/components/ProfileProvider';
import type { AutomacaoRegra } from '@/lib/automacao';
import AutomacaoTabela from '@/components/automacao/AutomacaoTabela';
import ModalConfigurarRegra from '@/components/automacao/ModalConfigurarRegra';

export default function AutomacaoPage() {
  const router = useRouter();
  const { profile, loading: carregandoPerfil } = useSharedProfile();
  const [regras, setRegras] = useState<AutomacaoRegra[] | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<string | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  useEffect(() => {
    if (!carregandoPerfil && profile.role === 'cliente') {
      router.replace('/painel');
    }
  }, [carregandoPerfil, profile.role, router]);

  useEffect(() => {
    let unmounted = false;

    async function carregar() {
      try {
        const res = await authFetch('/api/automacao/regras');
        if (!res.ok) {
          if (!unmounted) setRegras([]);
          return;
        }
        const data = await res.json().catch(() => ({}));
        const lista: AutomacaoRegra[] = data.regras ?? [];
        if (lista.length > 0) {
          if (!unmounted) {
            setRegras(lista);
            setAbaAtiva(prev => prev ?? lista[0].id);
          }
          return;
        }

        const res2 = await authFetch('/api/automacao/regras/sincronizar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (!res2.ok) {
          if (!unmounted) setRegras([]);
          return;
        }
        const data2 = await res2.json().catch(() => ({}));
        const lista2: AutomacaoRegra[] = data2.regras ?? [];
        if (!unmounted) {
          setRegras(lista2);
          if (lista2.length > 0) setAbaAtiva(prev => prev ?? lista2[0].id);
        }
      } catch (err) {
        console.warn('[AutomacaoPage] erro ao carregar regras:', err);
        if (!unmounted) setRegras([]);
      }
    }

    carregar();
    return () => {
      unmounted = true;
    };
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

  const regraAtiva = regras?.find(r => r.id === abaAtiva) ?? null;

  if (profile.role === 'cliente') return null;

  return (
    <div className="mx-auto max-w-6xl p-6 sm:p-10">
      <h1 className="text-3xl font-bold tracking-tight text-white">Automação de funis</h1>
      <p className="mt-2 text-white/60">Enriquecimento de leads por número de processo (InfoSimples + DataJud), a partir dos funis &quot;IA*&quot; do Bitrix24.</p>

      <div className="mt-8 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm backdrop-blur-md">
        {regras === null && <p className="text-sm text-white/60">Buscando funis no Bitrix…</p>}

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
              <div className="flex items-center gap-1.5">
                <Tooltip label="Nova regra / funil">
                  <ActionIcon variant="subtle" onClick={openModal} aria-label="Adicionar regra" className="bf-neon-btn">
                    <Plus size={18} strokeWidth={2.4} />
                  </ActionIcon>
                </Tooltip>
                {regraAtiva && (
                  <Tooltip label="Configurar esta aba (etapa, filtros, tamanho do lote)">
                    <ActionIcon variant="subtle" onClick={openModal} aria-label="Configurar aba" className="bf-neon-btn">
                      <Settings2 size={18} strokeWidth={2.4} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </div>
            </div>

            {regras.length === 0 && (
              <p className="mt-6 text-sm text-white/60">
                Nenhum funil &quot;IA*&quot; encontrado no Bitrix com o campo de número de processo configurado. Verifique o nome dos funis (devem começar com &quot;IA&quot;) e o campo customizado na conta.
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

      <ModalConfigurarRegra opened={modalOpened} onClose={closeModal} onSalvo={onRegraSalva} regraExistente={regraAtiva} />
    </div>
  );
}
