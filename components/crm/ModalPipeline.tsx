'use client';

import { useState } from 'react';
import { Modal, TextInput, Textarea, Button, Text } from '@mantine/core';
import { authFetch } from '@/lib/authFetch';
import type { CrmPipeline } from '@/lib/crm';

interface Props {
  opened: boolean;
  onClose: () => void;
  onSalvo: (pipeline: CrmPipeline) => void;
}

export default function ModalPipeline({ opened, onClose, onSalvo }: Props) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const salvar = async () => {
    setErro('');
    if (!nome.trim()) {
      setErro('Informe o nome do pipeline.');
      return;
    }
    setSalvando(true);
    try {
      const res = await authFetch('/api/crm/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, descricao })
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error || 'Falha ao criar pipeline.');
        return;
      }
      onSalvo(data.pipeline);
      setNome('');
      setDescricao('');
      onClose();
    } catch {
      setErro('Falha ao criar pipeline.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} size="md" radius="lg" padding="lg" title={<Text fw={600}>Novo pipeline</Text>}>
      <TextInput label="Nome" placeholder="ex: Precatórios SP" value={nome} onChange={e => setNome(e.currentTarget.value)} mb="sm" />
      <Textarea
        label="Descrição (opcional)"
        placeholder="O que entra neste funil..."
        value={descricao}
        onChange={e => setDescricao(e.currentTarget.value)}
        minRows={2}
        autosize
        mb="sm"
      />
      {erro && (
        <Text size="xs" c="red" mb="sm">
          {erro}
        </Text>
      )}
      <Button onClick={salvar} loading={salvando} fullWidth>
        Criar pipeline
      </Button>
    </Modal>
  );
}
