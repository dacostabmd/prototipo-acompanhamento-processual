'use client';

import { useEffect, useState } from 'react';
import { Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { authFetch } from '@/lib/authFetch';
import type { AutomacaoRegra } from '@/lib/automacao';

interface BitrixStage {
  STATUS_ID: string;
  NAME: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  onSalvo: (regra: AutomacaoRegra) => void;
  regraExistente?: AutomacaoRegra | null;
}

const ESFERA_OPTIONS = [
  { value: 'estadual', label: 'Estadual' },
  { value: 'federal', label: 'Federal' },
  { value: 'municipal', label: 'Municipal' }
];

/** Edita etapa/filtros de uma aba já descoberta automaticamente a partir de um funil "IA*" do Bitrix (o funil em si não é editável aqui). */
export default function ModalConfigurarRegra({ opened, onClose, onSalvo, regraExistente }: Props) {
  const [etapas, setEtapas] = useState<BitrixStage[]>([]);
  const [stageId, setStageId] = useState<string | null>(null);
  const [tamanhoLote, setTamanhoLote] = useState<number>(10);
  const [filtroEsfera, setFiltroEsfera] = useState<string | null>(null);
  const [filtroValorMin, setFiltroValorMin] = useState<number | ''>('');
  const [filtroValorMax, setFiltroValorMax] = useState<number | ''>('');
  const [campoEsfera, setCampoEsfera] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!opened || !regraExistente) return;
    setStageId(regraExistente.stageId || null);
    setTamanhoLote(regraExistente.tamanhoLote);
    setFiltroEsfera(regraExistente.filtroEsfera);
    setFiltroValorMin(regraExistente.filtroValorMin ?? '');
    setFiltroValorMax(regraExistente.filtroValorMax ?? '');
    setCampoEsfera(regraExistente.campoEsfera ?? '');

    authFetch(`/api/automacao/bitrix/etapas?categoriaId=${regraExistente.categoriaId}`)
      .then(res => res.json())
      .then(data => setEtapas(data.stages ?? []))
      .catch(() => setEtapas([]));
  }, [opened, regraExistente]);

  const salvar = async () => {
    if (!regraExistente) return;
    setSalvando(true);
    try {
      const etapaSelecionada = etapas.find(e => e.STATUS_ID === stageId);
      const payload = {
        stageId: stageId ?? '',
        stageNome: etapaSelecionada?.NAME ?? null,
        tamanhoLote,
        filtroEsfera: filtroEsfera || null,
        filtroValorMin: filtroValorMin === '' ? null : filtroValorMin,
        filtroValorMax: filtroValorMax === '' ? null : filtroValorMax,
        campoEsfera: campoEsfera.trim() || null
      };

      const res = await authFetch(`/api/automacao/regras/${regraExistente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.regra) {
        onSalvo(data.regra);
        onClose();
      }
    } finally {
      setSalvando(false);
    }
  };

  if (!regraExistente) return null;

  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" padding="lg" title={<Text fw={600}>Configurar &quot;{regraExistente.nome}&quot;</Text>}>
      <Stack gap="sm">
        <Select
          label="Etapa"
          description="Deixe em branco para varrer todas as etapas do funil"
          placeholder="Todas as etapas"
          data={etapas.map(e => ({ value: e.STATUS_ID, label: e.NAME }))}
          value={stageId}
          onChange={setStageId}
          clearable
        />

        <NumberInput label="Tamanho do lote" description="Quantos deals buscar por clique" min={1} max={50} value={tamanhoLote} onChange={v => setTamanhoLote(Number(v) || 10)} />

        <Group grow>
          <Select label="Esfera (filtro padrão)" placeholder="Todas" data={ESFERA_OPTIONS} value={filtroEsfera} onChange={setFiltroEsfera} clearable />
          <TextInput label="Campo de esfera manual" placeholder="Ex: UF_CRM_ESFERA" value={campoEsfera} onChange={e => setCampoEsfera(e.currentTarget.value)} />
        </Group>

        <Group grow>
          <NumberInput label="Valor mínimo (R$)" value={filtroValorMin} onChange={v => setFiltroValorMin(v === '' ? '' : Number(v))} decimalScale={2} />
          <NumberInput label="Valor máximo (R$)" value={filtroValorMax} onChange={v => setFiltroValorMax(v === '' ? '' : Number(v))} decimalScale={2} />
        </Group>

        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando}>
            Salvar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
