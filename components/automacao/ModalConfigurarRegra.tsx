'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { Info } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import type { AutomacaoRegra } from '@/lib/automacao';

interface BitrixPipeline {
  ID: number;
  NAME: string;
}
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

export default function ModalConfigurarRegra({ opened, onClose, onSalvo, regraExistente }: Props) {
  const [nome, setNome] = useState('');
  const [funis, setFunis] = useState<BitrixPipeline[]>([]);
  const [etapas, setEtapas] = useState<BitrixStage[]>([]);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [campoProcesso, setCampoProcesso] = useState('UF_CRM_1740590606');
  const [tamanhoLote, setTamanhoLote] = useState<number>(10);
  const [filtroEsfera, setFiltroEsfera] = useState<string | null>(null);
  const [filtroValorMin, setFiltroValorMin] = useState<number | ''>('');
  const [filtroValorMax, setFiltroValorMax] = useState<number | ''>('');
  const [campoEsfera, setCampoEsfera] = useState('');
  const [simulado, setSimulado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!opened) return;
    authFetch('/api/automacao/bitrix/funis')
      .then(res => res.json())
      .then(data => {
        setFunis(data.pipelines ?? []);
        setSimulado(Boolean(data.simulated));
      })
      .catch(() => setFunis([]));

    if (regraExistente) {
      setNome(regraExistente.nome);
      setCategoriaId(String(regraExistente.categoriaId));
      setStageId(regraExistente.stageId);
      setCampoProcesso(regraExistente.campoProcesso);
      setTamanhoLote(regraExistente.tamanhoLote);
      setFiltroEsfera(regraExistente.filtroEsfera);
      setFiltroValorMin(regraExistente.filtroValorMin ?? '');
      setFiltroValorMax(regraExistente.filtroValorMax ?? '');
      setCampoEsfera(regraExistente.campoEsfera ?? '');
    } else {
      setNome('');
      setCategoriaId(null);
      setStageId(null);
      setCampoProcesso('UF_CRM_1740590606');
      setTamanhoLote(10);
      setFiltroEsfera(null);
      setFiltroValorMin('');
      setFiltroValorMax('');
      setCampoEsfera('');
    }
  }, [opened, regraExistente]);

  useEffect(() => {
    if (categoriaId === null) {
      setEtapas([]);
      return;
    }
    authFetch(`/api/automacao/bitrix/etapas?categoriaId=${categoriaId}`)
      .then(res => res.json())
      .then(data => setEtapas(data.stages ?? []))
      .catch(() => setEtapas([]));
  }, [categoriaId]);

  const salvar = async () => {
    if (!nome.trim() || categoriaId === null || !stageId) return;
    setSalvando(true);
    try {
      const funilSelecionado = funis.find(f => String(f.ID) === categoriaId);
      const etapaSelecionada = etapas.find(e => e.STATUS_ID === stageId);
      const payload = {
        nome: nome.trim(),
        categoriaId: Number(categoriaId),
        categoriaNome: funilSelecionado?.NAME ?? null,
        stageId,
        stageNome: etapaSelecionada?.NAME ?? null,
        campoProcesso: campoProcesso.trim() || 'UF_CRM_1740590606',
        tamanhoLote,
        filtroEsfera: filtroEsfera || null,
        filtroValorMin: filtroValorMin === '' ? null : filtroValorMin,
        filtroValorMax: filtroValorMax === '' ? null : filtroValorMax,
        campoEsfera: campoEsfera.trim() || null
      };

      const url = regraExistente ? `/api/automacao/regras/${regraExistente.id}` : '/api/automacao/regras';
      const method = regraExistente ? 'PATCH' : 'POST';
      const res = await authFetch(url, {
        method,
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

  return (
    <Modal opened={opened} onClose={onClose} size="lg" radius="lg" padding="lg" title={<Text fw={600}>{regraExistente ? 'Editar aba de automação' : 'Nova aba de automação'}</Text>}>
      <Stack gap="sm">
        {simulado && (
          <Alert icon={<Info size={16} />} color="yellow" variant="light">
            Bitrix em modo simulado — configure BITRIX_WEBHOOK_URL para listar funis e etapas reais.
          </Alert>
        )}

        <TextInput label="Nome da aba" placeholder="Ex: Funil Cobrança - Em negociação" value={nome} onChange={e => setNome(e.currentTarget.value)} required />

        <Select
          label="Funil"
          placeholder="Selecione o funil"
          data={funis.map(f => ({ value: String(f.ID), label: f.NAME }))}
          value={categoriaId}
          onChange={v => {
            setCategoriaId(v);
            setStageId(null);
          }}
          required
        />

        <Select
          label="Etapa"
          placeholder="Selecione a etapa"
          data={etapas.map(e => ({ value: e.STATUS_ID, label: e.NAME }))}
          value={stageId}
          onChange={setStageId}
          disabled={categoriaId === null}
          required
        />

        <TextInput
          label="Campo do número de processo"
          description="Código do campo customizado do Bitrix (UF_CRM_...)"
          value={campoProcesso}
          onChange={e => setCampoProcesso(e.currentTarget.value)}
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
          <Button onClick={salvar} loading={salvando} disabled={!nome.trim() || categoriaId === null || !stageId}>
            Salvar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
