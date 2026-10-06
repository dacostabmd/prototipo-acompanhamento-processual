'use client';

import { useEffect, useState } from 'react';
import { ActionIcon, Badge, Group, Modal, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Gauge, CheckCircle2 } from 'lucide-react';
import { getDevPagante, setDevPagante } from '@/lib/devPagante';

/** Controle flutuante para alternar modo pagante / não pagante no protótipo. */
export default function DevMetrics() {
  const [opened, { open, close }] = useDisclosure(false);
  const [pagante, setPagante] = useState(false);

  useEffect(() => {
    setPagante(getDevPagante());
    const onChange = () => setPagante(getDevPagante());
    window.addEventListener('devPagante:change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('devPagante:change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const handleToggle = (value: string) => {
    const next = value === 'pagante';
    setPagante(next);
    setDevPagante(next);
  };

  return (
    <>
      <Tooltip label={`Simular conta (${pagante ? 'Pagante' : 'Não pagante'})`} position="left" withArrow>
        <ActionIcon
          onClick={open}
          size={44}
          radius="xl"
          variant="filled"
          color={pagante ? 'teal' : 'brand'}
          aria-label="Alternar simulação de conta pagante / não pagante"
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 400,
            boxShadow: '0 10px 24px -8px rgba(23,52,122,.6)'
          }}
        >
          <Gauge size={20} strokeWidth={1.8} />
          {pagante && (
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
                border: '2px solid rgba(20,20,20,0.9)'
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
              Modo da conta no protótipo
            </Text>
            <Badge size="sm" color={pagante ? 'teal' : 'gray'} variant="light">
              {pagante ? 'Pagante' : 'Não pagante'}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mb="md">
            Controla localmente (neste navegador) a visualização de recursos para assinantes no protótipo, como a busca por nome da parte.
          </Text>

          <SegmentedControl
            fullWidth
            size="sm"
            value={pagante ? 'pagante' : 'nao-pagante'}
            onChange={handleToggle}
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
      </Modal>
    </>
  );
}


