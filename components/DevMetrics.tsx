'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionIcon, Badge, Group, Modal, SegmentedControl, SimpleGrid, Table, Tabs, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconGauge, IconRefresh } from '@tabler/icons-react';

/** Somente desenvolvimento: painel flutuante com métricas técnicas da página. */

interface Vitals {
  ttfb?: number;
  fcp?: number;
  lcp?: number;
  cls: number;
  domReady?: number;
  load?: number;
  navType?: string;
}

interface Req {
  name: string;
  type: string;
  duration: number;
  size: number;
  status?: number;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
const ms = (n?: number) => (n === undefined ? '—' : `${Math.round(n)} ms`);

function rate(v: number | undefined, good: number, poor: number) {
  if (v === undefined) return 'gray';
  return v <= good ? 'teal' : v <= poor ? 'yellow' : 'red';
}

function shortName(url: string) {
  try {
    const u = new URL(url);
    return u.origin === location.origin ? u.pathname + u.search : u.host + u.pathname;
  } catch {
    return url;
  }
}

function readRequests(): Req[] {
  return (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map(r => ({
    name: r.name,
    type: r.initiatorType || 'other',
    duration: r.duration,
    size: r.transferSize || r.encodedBodySize || 0,
    status: (r as PerformanceResourceTiming & { responseStatus?: number }).responseStatus
  }));
}

export default function DevMetrics() {
  const [opened, { open, close }] = useDisclosure(false);
  const [vitals, setVitals] = useState<Vitals>({ cls: 0 });
  const [reqs, setReqs] = useState<Req[]>([]);
  const [filter, setFilter] = useState('heavy');

  const refresh = useCallback(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    setVitals(v => ({
      ...v,
      ttfb: nav ? nav.responseStart - nav.startTime : undefined,
      domReady: nav?.domContentLoadedEventEnd,
      load: nav?.loadEventEnd || undefined,
      navType: nav?.type
    }));
    setReqs(readRequests());
  }, []);

  useEffect(() => {
    refresh();
    const observers: PerformanceObserver[] = [];
    const observe = (type: string, cb: (list: PerformanceObserverEntryList) => void) => {
      try {
        const po = new PerformanceObserver(cb);
        po.observe({ type, buffered: true });
        observers.push(po);
      } catch {}
    };
    observe('paint', l => {
      const fcp = l.getEntriesByName('first-contentful-paint')[0];
      if (fcp) setVitals(v => ({ ...v, fcp: fcp.startTime }));
    });
    observe('largest-contentful-paint', l => {
      const last = l.getEntries().at(-1);
      if (last) setVitals(v => ({ ...v, lcp: last.startTime }));
    });
    observe('layout-shift', l => {
      const add = (l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
        .filter(e => !e.hadRecentInput)
        .reduce((s, e) => s + e.value, 0);
      if (add) setVitals(v => ({ ...v, cls: v.cls + add }));
    });
    observe('resource', () => setReqs(readRequests()));
    return () => observers.forEach(o => o.disconnect());
  }, [refresh]);

  const sorted = useMemo(() => [...reqs].sort((a, b) => b.size - a.size), [reqs]);
  const rows = filter === 'heavy' ? sorted.slice(0, 10) : filter === 'slow' ? [...reqs].sort((a, b) => b.duration - a.duration).slice(0, 10) : sorted;
  const total = reqs.reduce((s, r) => s + r.size, 0);

  const metrics: { label: string; value: string; color: string; hint: string }[] = [
    { label: 'TTFB', value: ms(vitals.ttfb), color: rate(vitals.ttfb, 800, 1800), hint: 'Tempo até o primeiro byte (≤ 800 ms)' },
    { label: 'FCP', value: ms(vitals.fcp), color: rate(vitals.fcp, 1800, 3000), hint: 'First Contentful Paint (≤ 1,8 s)' },
    { label: 'LCP', value: ms(vitals.lcp), color: rate(vitals.lcp, 2500, 4000), hint: 'Largest Contentful Paint (≤ 2,5 s)' },
    { label: 'CLS', value: vitals.cls.toFixed(3), color: rate(vitals.cls, 0.1, 0.25), hint: 'Cumulative Layout Shift (≤ 0,1)' },
    { label: 'DOM pronto', value: ms(vitals.domReady), color: 'gray', hint: 'DOMContentLoaded' },
    { label: 'Load', value: ms(vitals.load), color: 'gray', hint: 'Evento load' }
  ];

  return (
    <>
      <Tooltip label="Métricas (dev)" position="left">
        <ActionIcon
          onClick={() => {
            refresh();
            open();
          }}
          size={44}
          radius="xl"
          variant="filled"
          color="brand"
          aria-label="Abrir métricas de desenvolvimento"
          style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 400, boxShadow: '0 10px 24px -8px rgba(23,52,122,.6)' }}
        >
          <IconGauge size={22} stroke={1.7} />
        </ActionIcon>
      </Tooltip>

      <Modal opened={opened} onClose={close} size="xl" radius="lg" padding="lg" title={<Text fw={600}>Métricas técnicas · dev</Text>}>
        <Tabs defaultValue="vitals" keepMounted={false}>
          <Tabs.List mb="md">
            <Tabs.Tab value="vitals">Visão geral</Tabs.Tab>
            <Tabs.Tab value="reqs" rightSection={<Badge size="xs" circle>{reqs.length}</Badge>}>
              Requisições
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="vitals">
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
              {metrics.map(m => (
                <Tooltip key={m.label} label={m.hint} withArrow>
                  <div style={{ border: '1px solid var(--mantine-color-gray-2)', borderRadius: 12, padding: 14 }}>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                      {m.label}
                    </Text>
                    <Group gap={8} mt={4} wrap="nowrap">
                      <Text fz={22} fw={700}>
                        {m.value}
                      </Text>
                      <Badge size="xs" color={m.color} variant="dot" />
                    </Group>
                  </div>
                </Tooltip>
              ))}
            </SimpleGrid>
            <Text size="xs" c="dimmed" mt="md">
              {reqs.length} requisições · {kb(total)} transferidos · navegação: {vitals.navType ?? '—'}. Em dev os números são maiores que em produção (sem minificação/cache).
            </Text>
          </Tabs.Panel>

          <Tabs.Panel value="reqs">
            <Group justify="space-between" mb="sm">
              <SegmentedControl
                size="xs"
                value={filter}
                onChange={setFilter}
                data={[
                  { label: 'Mais pesadas', value: 'heavy' },
                  { label: 'Mais lentas', value: 'slow' },
                  { label: 'Todas', value: 'all' }
                ]}
              />
              <ActionIcon variant="subtle" onClick={refresh} aria-label="Atualizar">
                <IconRefresh size={18} />
              </ActionIcon>
            </Group>
            <Table.ScrollContainer minWidth={520} mah={380}>
              <Table stickyHeader highlightOnHover verticalSpacing={6} fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Recurso</Table.Th>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th ta="right">Tamanho</Table.Th>
                    <Table.Th ta="right">Tempo</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r, i) => (
                    <Table.Tr key={r.name + i}>
                      <Table.Td maw={320} title={r.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {shortName(r.name)}
                      </Table.Td>
                      <Table.Td>{r.type}</Table.Td>
                      <Table.Td ta="right">{r.size ? kb(r.size) : '—'}</Table.Td>
                      <Table.Td ta="right">{ms(r.duration)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Tabs.Panel>
        </Tabs>
      </Modal>
    </>
  );
}
