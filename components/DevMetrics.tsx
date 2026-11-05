'use client';

import { ActionIcon, Badge, Group, Modal, Text, Tooltip } from '@mantine/core';
import AbasDeslizantes, { ConteudoDeslizante, useDirecaoAba } from './AbasDeslizantes';
import { useDisclosure } from '@mantine/hooks';
import { Gauge, CheckCircle2 } from 'lucide-react';
import { setDevPagante, useDevPagante } from '@/lib/devPagante';
import { setDevVisaoAdvogado, useDevVisaoAdvogado } from '@/lib/devVisao';
import { DockSlot } from '@/lib/devDock';

const CONTAS = [
  { label: 'Usuário comum', value: 'comum' as const },
  { label: 'Advogado', value: 'advogado' as const }
];
const ASSINATURAS = [
  { label: 'Não pagante', value: 'nao-pagante' as const },
  { label: 'Pagante', value: 'pagante' as const }
];

/** Controle flutuante para simular, no protótipo, usuário comum / advogado (e, no advogado, pagante / não pagante). */
export default function DevMetrics() {
  const [opened, { open, close }] = useDisclosure(false);
  const advogado = useDevVisaoAdvogado();
  const pagante = useDevPagante();

  const rotuloConta = advogado ? 'Advogado' : 'Usuário comum';
  const conta = advogado ? 'advogado' : 'comum';
  const assinatura = pagante ? 'pagante' : 'nao-pagante';
  const direcaoConta = useDirecaoAba(conta, ['comum', 'advogado']);
  const direcaoAssinatura = useDirecaoAba(assinatura, ['nao-pagante', 'pagante']);

  return (
    <>
      <DockSlot ordem={2}>
      <Tooltip label={`Simular conta (${rotuloConta})`} position="left" withArrow>
        <ActionIcon
          onClick={open}
          size={44}
          radius="xl"
          variant="filled"
          color={advogado ? 'teal' : 'brand'}
          aria-label="Alternar simulação de conta: usuário comum / advogado"
          style={{ boxShadow: '0 10px 24px -8px rgba(23,52,122,.6)' }}
        >
          <Gauge size={20} strokeWidth={1.8} />
          {advogado && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#12b886',
                border: '2px solid rgb(var(--bf-ink-rgb) / 0.9)'
              }}
            />
          )}
        </ActionIcon>
      </Tooltip>
      </DockSlot>

      <Modal
        opened={opened}
        onClose={close}
        size="md"
        radius="lg"
        padding="lg"
        title={<Text fw={600}>Simular conta</Text>}
      >
        <div>
          <Group justify="space-between" align="center" mb={6}>
            <Text size="sm" fw={600}>
              Tipo de conta no protótipo
            </Text>
            <Badge size="sm" color={advogado ? 'teal' : 'gray'} variant="light">
              {rotuloConta}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mb="md">
            Controla localmente (neste navegador) o que a conta enxerga: o usuário comum busca só por número do processo; o advogado também busca por pessoa ou empresa.
          </Text>

          <AbasDeslizantes
            fullWidth
            ariaLabel="Tipo de conta"
            value={conta}
            onChange={v => setDevVisaoAdvogado(v === 'advogado')}
            data={CONTAS}
          />

          <ConteudoDeslizante chave={conta} direcao={direcaoConta}>
          {advogado && (
            <div style={{ marginTop: 18 }}>
              <Group justify="space-between" align="center" mb={6}>
                <Text size="sm" fw={600}>
                  Assinatura
                </Text>
                <Badge size="sm" color={pagante ? 'teal' : 'gray'} variant="light">
                  {pagante ? 'Pagante' : 'Não pagante'}
                </Badge>
              </Group>
              <AbasDeslizantes
                fullWidth
                ariaLabel="Assinatura"
                value={assinatura}
                onChange={v => setDevPagante(v === 'pagante')}
                data={ASSINATURAS}
              />

              <ConteudoDeslizante chave={assinatura} direcao={direcaoAssinatura}>
              {pagante && (
                <Group gap={6} mt="sm" c="teal" wrap="nowrap">
                  <CheckCircle2 size={14} />
                  <Text size="xs" fw={500}>
                    Recursos para assinantes desbloqueados (ex: busca por nome da parte).
                  </Text>
                </Group>
              )}
              </ConteudoDeslizante>
            </div>
          )}
          </ConteudoDeslizante>
        </div>
      </Modal>
    </>
  );
}
