'use client';

import { useEffect, useState } from 'react';
import { Modal, TextInput, Select, Checkbox, Button, Text, ActionIcon, Group } from '@mantine/core';
import { Plus, X } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import type { CrmPipelineCampo, CrmTipoCampo } from '@/lib/crm';

interface Props {
  opened: boolean;
  onClose: () => void;
  pipelineId: string;
  onSalvo: (campo: CrmPipelineCampo) => void;
}

export default function ModalCampoCustomizado({ opened, onClose, pipelineId, onSalvo }: Props) {
  const [tipos, setTipos] = useState<CrmTipoCampo[]>([]);
  const [nome, setNome] = useState('');
  const [tipoCampoId, setTipoCampoId] = useState<string | null>(null);
  const [obrigatorio, setObrigatorio] = useState(false);
  const [opcoes, setOpcoes] = useState<string[]>(['']);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!opened) return;
    authFetch('/api/crm/tipos-campo')
      .then(res => res.json())
      .then(data => setTipos(data.tipos ?? []))
      .catch(() => setTipos([]));
  }, [opened]);

  const tipoSelecionado = tipos.find(t => t.id === tipoCampoId);

  const salvar = async () => {
    setErro('');
    if (!nome.trim() || !tipoCampoId) {
      setErro('Informe o nome e o tipo do campo.');
      return;
    }
    const opcoesLimpas = opcoes.map(o => o.trim()).filter(Boolean);
    if (tipoSelecionado?.requerOpcoes && opcoesLimpas.length === 0) {
      setErro('Informe ao menos uma opção.');
      return;
    }

    setSalvando(true);
    try {
      const res = await authFetch(`/api/crm/pipelines/${pipelineId}/campos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          tipoCampoId,
          obrigatorio,
          opcoes: tipoSelecionado?.requerOpcoes ? opcoesLimpas.map(v => ({ value: v, label: v })) : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || 'Falha ao criar campo.');
        return;
      }
      onSalvo(data.campo);
      setNome('');
      setTipoCampoId(null);
      setObrigatorio(false);
      setOpcoes(['']);
      onClose();
    } catch {
      setErro('Falha ao criar campo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} size="md" radius="lg" padding="lg" title={<Text fw={600}>Novo campo personalizado</Text>}>
      <TextInput label="Nome do campo" placeholder="ex: Valor do precatório" value={nome} onChange={e => setNome(e.currentTarget.value)} mb="sm" />
      <Select
        label="Tipo"
        placeholder="Selecione o tipo do campo"
        data={tipos.map(t => ({ value: t.id, label: t.label }))}
        value={tipoCampoId}
        onChange={setTipoCampoId}
        mb="sm"
      />
      <Checkbox label="Obrigatório" checked={obrigatorio} onChange={e => setObrigatorio(e.currentTarget.checked)} mb="sm" />

      {tipoSelecionado?.requerOpcoes && (
        <div style={{ marginBottom: 12 }}>
          <Text size="sm" fw={500} mb={6}>
            Opções
          </Text>
          {opcoes.map((op, i) => (
            <Group key={i} gap={6} mb={6} wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                placeholder={`Opção ${i + 1}`}
                value={op}
                onChange={e => setOpcoes(prev => prev.map((v, idx) => (idx === i ? e.currentTarget.value : v)))}
              />
              {opcoes.length > 1 && (
                <ActionIcon variant="subtle" color="red" onClick={() => setOpcoes(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={14} />
                </ActionIcon>
              )}
            </Group>
          ))}
          <Button variant="subtle" size="xs" leftSection={<Plus size={14} />} onClick={() => setOpcoes(prev => [...prev, ''])}>
            Adicionar opção
          </Button>
        </div>
      )}

      {erro && (
        <Text size="xs" c="red" mb="sm">
          {erro}
        </Text>
      )}
      <Button onClick={salvar} loading={salvando} fullWidth>
        Criar campo
      </Button>
    </Modal>
  );
}
