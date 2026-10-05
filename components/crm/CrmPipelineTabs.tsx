'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Tabs, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Plus, Settings2 } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import type { CrmEtapa, CrmPipeline, CrmPipelineCampo, CrmTipoCampo } from '@/lib/crm';
import ModalPipeline from './ModalPipeline';
import ModalCampoCustomizado from './ModalCampoCustomizado';
import CrmTabela from './CrmTabela';

export default function CrmPipelineTabs() {
  const [pipelines, setPipelines] = useState<CrmPipeline[] | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<string | null>(null);
  const [etapasPorPipeline, setEtapasPorPipeline] = useState<Record<string, CrmEtapa[]>>({});
  const [camposPorPipeline, setCamposPorPipeline] = useState<Record<string, CrmPipelineCampo[]>>({});
  const [tipos, setTipos] = useState<CrmTipoCampo[]>([]);
  const [modalPipelineOpened, { open: openModalPipeline, close: closeModalPipeline }] = useDisclosure(false);
  const [modalCampoOpened, { open: openModalCampo, close: closeModalCampo }] = useDisclosure(false);

  useEffect(() => {
    authFetch('/api/crm/pipelines')
      .then(res => res.json())
      .then(data => {
        const lista: CrmPipeline[] = data.pipelines ?? [];
        setPipelines(lista);
        setAbaAtiva(prev => prev ?? lista[0]?.id ?? null);
      })
      .catch(() => setPipelines([]));

    authFetch('/api/crm/tipos-campo')
      .then(res => res.json())
      .then(data => setTipos(data.tipos ?? []))
      .catch(() => setTipos([]));
  }, []);

  const carregarEtapasECampos = useCallback(async (pipelineId: string) => {
    const [resEtapas, resCampos] = await Promise.all([
      authFetch(`/api/crm/pipelines/${pipelineId}/etapas`),
      authFetch(`/api/crm/pipelines/${pipelineId}/campos`)
    ]);
    const dataEtapas = await resEtapas.json();
    const dataCampos = await resCampos.json();
    setEtapasPorPipeline(prev => ({ ...prev, [pipelineId]: dataEtapas.etapas ?? [] }));
    setCamposPorPipeline(prev => ({ ...prev, [pipelineId]: dataCampos.campos ?? [] }));
  }, []);

  useEffect(() => {
    if (abaAtiva && !etapasPorPipeline[abaAtiva]) {
      void carregarEtapasECampos(abaAtiva);
    }
  }, [abaAtiva, etapasPorPipeline, carregarEtapasECampos]);

  const onPipelineCriado = (pipeline: CrmPipeline) => {
    setPipelines(prev => [...(prev ?? []), pipeline]);
    setAbaAtiva(pipeline.id);
  };

  const onCampoCriado = (pipelineId: string) => {
    void carregarEtapasECampos(pipelineId);
  };

  const pipelineAtivo = pipelines?.find(p => p.id === abaAtiva) ?? null;

  return (
    <div>
      {pipelines === null && <p className="text-sm text-white/60">Carregando pipelines…</p>}

      {pipelines !== null && (
        <Tabs value={abaAtiva} onChange={setAbaAtiva} keepMounted={false}>
          <div className="flex items-start justify-between gap-3">
            <Tabs.List className="flex-1">
              {pipelines.map(p => (
                <Tabs.Tab key={p.id} value={p.id}>
                  {p.nome}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <div className="flex items-center gap-1.5">
              <Tooltip label="Novo pipeline">
                <ActionIcon variant="subtle" onClick={openModalPipeline} aria-label="Adicionar pipeline" className="bf-neon-btn">
                  <Plus size={18} strokeWidth={2.4} />
                </ActionIcon>
              </Tooltip>
              {pipelineAtivo && (
                <Tooltip label="Novo campo personalizado neste pipeline">
                  <ActionIcon variant="subtle" onClick={openModalCampo} aria-label="Configurar campos" className="bf-neon-btn">
                    <Settings2 size={18} strokeWidth={2.4} />
                  </ActionIcon>
                </Tooltip>
              )}
            </div>
          </div>

          {pipelines.length === 0 && (
            <p className="mt-6 text-sm text-white/60">Nenhum pipeline criado ainda. Clique no + para criar o primeiro.</p>
          )}

          {pipelines.map(pipeline => (
            <Tabs.Panel key={pipeline.id} value={pipeline.id} pt="md">
              <CrmTabela
                pipeline={pipeline}
                etapas={etapasPorPipeline[pipeline.id] ?? []}
                campos={camposPorPipeline[pipeline.id] ?? []}
                tipos={tipos}
              />
            </Tabs.Panel>
          ))}
        </Tabs>
      )}

      <ModalPipeline opened={modalPipelineOpened} onClose={closeModalPipeline} onSalvo={onPipelineCriado} />
      {pipelineAtivo && (
        <ModalCampoCustomizado
          opened={modalCampoOpened}
          onClose={closeModalCampo}
          pipelineId={pipelineAtivo.id}
          onSalvo={() => onCampoCriado(pipelineAtivo.id)}
        />
      )}
    </div>
  );
}
