'use client';

import { ActionIcon, Badge, Group, Modal, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Gauge, CheckCircle2 } from 'lucide-react';
import { setDevPagante, useDevPagante } from '@/lib/devPagante';
import { setDevVisaoAdvogado, useDevVisaoAdvogado } from '@/lib/devVisao';

/** Controle flutuante para simular, no protótipo, usuário comum / advogado (e, no advogado, pagante / não pagante). */
export default function DevMetrics() {
  const [opened, { open, close }] = useDisclosure(false);
  const advogado = useDevVisaoAdvogado();
  const pagante = useDevPagante();

  const rotuloConta = advogado ? 'Advogado' : 'Usuário comum';

  return (
    <>
      <Tooltip label={`Simular conta (${rotuloConta})`} position="left" withArrow>
        <ActionIcon
          onClick={open}
          size={44}
          radius="xl"
          variant="filled"
          color={advogado ? 'teal' : 'brand'}
          aria-label="Alternar simulação de conta: usuário comum / advogado"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 400,
            boxShadow: '0 10px 24px -8px rgba(23,52,122,.6)'
          }}
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
                border: '2px solid rgba(21, 22, 26,0.9)'
              }}
            />
          )}
        </ActionIcon>
      </Tooltip>

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

          <SegmentedControl
            fullWidth
            size="sm"
            value={advogado ? 'advogado' : 'comum'}
            onChange={v => setDevVisaoAdvogado(v === 'advogado')}
            data={[
              { label: 'Usuário comum', value: 'comum' },
              { label: 'Advogado', value: 'advogado' }
            ]}
          />

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
              <SegmentedControl
                fullWidth
                size="sm"
                value={pagante ? 'pagante' : 'nao-pagante'}
                onChange={v => setDevPagante(v === 'pagante')}
                data={[
                  { label: 'Não pagante', value: 'nao-pagante' },
                  { label: 'Pagante', value: 'pagante' }
                ]}
              />

              {pagante && (
                <Group gap={6} mt="sm" c="teal" wrap="nowrap">
                  <CheckCircle2 size={14} />
                  <Text size="xs" fw={500}>
                    Recursos para assinantes desbloqueados (ex: busca por nome da parte).
                  </Text>
                </Group>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
