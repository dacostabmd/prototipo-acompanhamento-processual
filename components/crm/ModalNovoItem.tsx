'use client';

import { useState } from 'react';
import { Modal, TextInput, Select, Checkbox, Button, Text, NumberInput } from '@mantine/core';
import { authFetch } from '@/lib/authFetch';
import { formatProcessNumber, parseCnj } from '@/lib/cnj';
import { cleanDigits } from '@/lib/format';
import type { CrmEtapa, CrmItem, CrmPipelineCampo, CrmTipoCampo } from '@/lib/crm';

interface Props {
  opened: boolean;
  onClose: () => void;
  pipelineId: string;
  etapas: CrmEtapa[];
  campos: CrmPipelineCampo[];
  tipos: CrmTipoCampo[];
  onSalvo: (item: CrmItem) => void;
}

export default function ModalNovoItem({ opened, onClose, pipelineId, etapas, campos, tipos, onSalvo }: Props) {
  const [titulo, setTitulo] = useState('');
  const [etapaId, setEtapaId] = useState<string | null>(etapas[0]?.id ?? null);
  const [numeroCnj, setNumeroCnj] = useState('');
  const [valores, setValores] = useState<Record<string, string | number | boolean | null>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const cnjDigits = cleanDigits(numeroCnj);
  const cnjInfo = cnjDigits.length === 20 ? parseCnj(cnjDigits) : null;

  const tipoById = (id: string) => tipos.find(t => t.id === id);

  const salvar = async () => {
    setErro('');
    if (!titulo.trim() || !etapaId) {
      setErro('Informe o título e a etapa.');
      return;
    }
    const faltando = campos.filter(c => c.ativo && c.obrigatorio && !valores[c.slug]);
    if (faltando.length > 0) {
      setErro(`Preencha o campo obrigatório: ${faltando[0].nome}`);
      return;
    }

    setSalvando(true);
    try {
      const res = await authFetch('/api/crm/itens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId, etapaId, titulo, numeroCnj, camposCustomizados: valores })
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || 'Falha ao criar item.');
        return;
      }
      onSalvo(data.item);
      setTitulo('');
      setNumeroCnj('');
      setValores({});
      onClose();
    } catch {
      setErro('Falha ao criar item.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} size="md" radius="lg" padding="lg" title={<Text fw={600}>Novo item</Text>}>
      <TextInput label="Título" placeholder="ex: João da Silva" value={titulo} onChange={e => setTitulo(e.currentTarget.value)} mb="sm" />
      <Select
        label="Etapa"
        data={etapas.map(e => ({ value: e.id, label: e.nome }))}
        value={etapaId}
        onChange={setEtapaId}
        mb="sm"
      />
      <TextInput
        label="Número do processo (CNJ, opcional)"
        placeholder="0000000-00.0000.0.00.0000"
        value={numeroCnj}
        onChange={e => setNumeroCnj(formatProcessNumber(e.currentTarget.value))}
        description={cnjInfo?.valido ? `Tribunal detectado: ${cnjInfo.tribunalLabel}` : undefined}
        mb="sm"
      />

      {campos
        .filter(c => c.ativo)
        .map(campo => {
          const tipo = tipoById(campo.tipoCampoId);
          const label = campo.obrigatorio ? `${campo.nome} *` : campo.nome;
          if (!tipo) return null;

          if (tipo.requerOpcoes) {
            return (
              <Select
                key={campo.id}
                label={label}
                data={(campo.opcoes ?? []).map(o => ({ value: o.value, label: o.label }))}
                value={(valores[campo.slug] as string) ?? null}
                onChange={v => setValores(prev => ({ ...prev, [campo.slug]: v }))}
                mb="sm"
              />
            );
          }
          if (tipo.storageKind === 'number') {
            return (
              <NumberInput
                key={campo.id}
                label={label}
                value={(valores[campo.slug] as number) ?? undefined}
                onChange={v => setValores(prev => ({ ...prev, [campo.slug]: typeof v === 'number' ? v : null }))}
                mb="sm"
              />
            );
          }
          if (tipo.storageKind === 'boolean') {
            return (
              <Checkbox
                key={campo.id}
                label={label}
                checked={!!valores[campo.slug]}
                onChange={e => setValores(prev => ({ ...prev, [campo.slug]: e.currentTarget.checked }))}
                mb="sm"
              />
            );
          }
          if (tipo.storageKind === 'date') {
            return (
              <TextInput
                key={campo.id}
                type="date"
                label={label}
                value={(valores[campo.slug] as string) ?? ''}
                onChange={e => setValores(prev => ({ ...prev, [campo.slug]: e.currentTarget.value }))}
                mb="sm"
              />
            );
          }
          return (
            <TextInput
              key={campo.id}
              label={label}
              value={(valores[campo.slug] as string) ?? ''}
              onChange={e => setValores(prev => ({ ...prev, [campo.slug]: e.currentTarget.value }))}
              mb="sm"
            />
          );
        })}

      {erro && (
        <Text size="xs" c="red" mb="sm">
          {erro}
        </Text>
      )}
      <Button onClick={salvar} loading={salvando} fullWidth>
        Criar item
      </Button>
    </Modal>
  );
}
