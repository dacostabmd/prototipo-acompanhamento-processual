'use client';

import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Modal, Textarea, TextInput, Tooltip, Button, Divider, ScrollArea, Text } from '@mantine/core';
import { Sparkles, Plus } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import type { ChangelogEntry } from '@/app/api/changelog/route';

const SEEN_KEY = 'bf:changelog:lastSeenId';

/** Ícone flutuante de novidades (visível a todos) + modal de criação (visível só ao owner). */
export default function Changelog({ isOwner }: { isOwner: boolean }) {
  const [entradas, setEntradas] = useState<ChangelogEntry[]>([]);
  const [opened, setOpened] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);
  const [criarOpened, setCriarOpened] = useState(false);
  const [versao, setVersao] = useState('');
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const carregarEntradas = async () => {
    try {
      const res = await authFetch('/api/changelog');
      if (!res.ok) return;
      const data = await res.json();
      const lista: ChangelogEntry[] = data.entradas ?? [];
      setEntradas(lista);

      if (lista.length > 0) {
        let lastSeen = '';
        try {
          lastSeen = localStorage.getItem(SEEN_KEY) ?? '';
        } catch {}
        setHasUnseen(lastSeen !== lista[0].id);
      }
    } catch {}
  };

  useEffect(() => {
    void carregarEntradas();
  }, []);

  const marcarComoVisto = () => {
    if (entradas.length === 0) return;
    try {
      localStorage.setItem(SEEN_KEY, entradas[0].id);
    } catch {}
    setHasUnseen(false);
  };

  const abrirNovidades = () => {
    setOpened(true);
    marcarComoVisto();
  };

  const criarEntrada = async () => {
    setErro('');
    if (!versao.trim() || !titulo.trim() || !corpo.trim()) {
      setErro('Preencha versão, título e descrição.');
      return;
    }
    setSalvando(true);
    try {
      const res = await authFetch('/api/changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versao, titulo, corpo })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(data.error || 'Falha ao salvar.');
        return;
      }
      setVersao('');
      setTitulo('');
      setCorpo('');
      setCriarOpened(false);
      await carregarEntradas();
    } catch {
      setErro('Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const formatData = useMemo(
    () => (iso: string) =>
      new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
    []
  );

  return (
    <>
      <Tooltip label="Novidades" position="left">
        <ActionIcon
          onClick={abrirNovidades}
          size={44}
          radius="xl"
          variant="filled"
          color="brand"
          aria-label="Ver novidades do produto"
          style={{
            position: 'fixed',
            right: 20,
            bottom: isOwner ? 76 : 20,
            zIndex: 400,
            boxShadow: '0 10px 24px -8px rgba(23,52,122,.6)'
          }}
        >
          <Sparkles size={20} strokeWidth={1.8} />
          {hasUnseen && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#e0545f',
                border: '2px solid rgba(20,20,20,0.9)'
              }}
            />
          )}
        </ActionIcon>
      </Tooltip>

      {isOwner && (
        <Tooltip label="Nova entrada de changelog" position="left">
          <ActionIcon
            onClick={() => setCriarOpened(true)}
            size={44}
            radius="xl"
            variant="filled"
            color="gray"
            aria-label="Criar nova entrada de changelog"
            style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 400, boxShadow: '0 10px 24px -8px rgba(0,0,0,.5)' }}
          >
            <Plus size={20} strokeWidth={1.8} />
          </ActionIcon>
        </Tooltip>
      )}

      <Modal opened={opened} onClose={() => setOpened(false)} size="lg" radius="lg" padding="lg" title={<Text fw={600}>Novidades</Text>}>
        <ScrollArea.Autosize mah={480} type="auto">
          {entradas.length === 0 ? (
            <Text size="sm" c="dimmed">
              Nenhuma novidade publicada ainda.
            </Text>
          ) : (
            entradas.map((e, i) => (
              <div key={e.id}>
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                  {e.versao} · {formatData(e.created_at)}
                </Text>
                <Text size="sm" fw={700} mt={2} mb={6}>
                  {e.titulo}
                </Text>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }} mb="sm">
                  {e.corpo}
                </Text>
                {i < entradas.length - 1 && <Divider my="md" />}
              </div>
            ))
          )}
        </ScrollArea.Autosize>
      </Modal>

      {isOwner && (
        <Modal
          opened={criarOpened}
          onClose={() => setCriarOpened(false)}
          size="md"
          radius="lg"
          padding="lg"
          title={<Text fw={600}>Nova entrada de changelog</Text>}
        >
          <TextInput label="Versão" placeholder="ex: 1.4.0" value={versao} onChange={e => setVersao(e.currentTarget.value)} mb="sm" />
          <TextInput label="Título" placeholder="ex: Busca por número de processo mais completa" value={titulo} onChange={e => setTitulo(e.currentTarget.value)} mb="sm" />
          <Textarea
            label="Descrição"
            placeholder="O que mudou, por quê, o que o usuário deve esperar..."
            value={corpo}
            onChange={e => setCorpo(e.currentTarget.value)}
            minRows={5}
            autosize
            mb="sm"
          />
          {erro && (
            <Text size="xs" c="red" mb="sm">
              {erro}
            </Text>
          )}
          <Button onClick={criarEntrada} loading={salvando} fullWidth>
            Publicar
          </Button>
        </Modal>
      )}
    </>
  );
}
