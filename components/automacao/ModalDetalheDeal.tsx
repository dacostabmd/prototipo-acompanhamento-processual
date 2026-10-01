'use client';

import { Badge, Divider, Group, Modal, Stack, Text } from '@mantine/core';
import { Building2, CalendarDays, Gavel, Scale } from 'lucide-react';
import { TAG_META } from '@/lib/mockProcesses';
import { ESFERA_LABEL, type AutomacaoDeal } from '@/lib/automacao';

interface Props {
  opened: boolean;
  onClose: () => void;
  deal: AutomacaoDeal | null;
}

const fmtValor = (v: number | null) => (v !== null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
const fmtData = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

export default function ModalDetalheDeal({ opened, onClose, deal }: Props) {
  if (!deal) return null;
  const dados = deal.dadosEnriquecidos;
  const semDados = !dados.fonte;

  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" padding="lg" title={<Text fw={600}>Processo {deal.numeroCnjFormatado ?? '—'}</Text>}>
      <Stack gap="md">
        <Group gap="xs">
          <Badge color="gray" variant="light">
            Deal #{deal.dealId}
          </Badge>
          {deal.tribunalLabel && (
            <Badge color="blue" variant="light" leftSection={<Gavel size={12} />}>
              {deal.tribunalLabel}
            </Badge>
          )}
          {deal.esfera && (
            <Badge color="teal" variant="light">
              {ESFERA_LABEL[deal.esfera]}
            </Badge>
          )}
        </Group>

        <Text size="sm" c="dimmed">
          {deal.dealTitulo ?? 'Sem título'}
        </Text>

        <Divider />

        {semDados ? (
          <Text size="sm" c="dimmed">
            Processo não localizado no DataJud (CNJ) no momento do processamento.
          </Text>
        ) : (
          <>
            <Group grow>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Classe
                </Text>
                <Text size="sm">{dados.classe ?? '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Grau
                </Text>
                <Text size="sm">{dados.grau ?? '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Valor do deal
                </Text>
                <Text size="sm">{fmtValor(deal.valorDeal)}</Text>
              </div>
            </Group>

            <Group grow align="flex-start">
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Órgão julgador
                </Text>
                <Text size="sm">{dados.orgaoJulgador ?? '—'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Distribuição
                </Text>
                <Text size="sm">{dados.dataAjuizamento ?? '—'}</Text>
              </div>
            </Group>

            {!!dados.assuntos?.length && (
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
                  Assuntos (CNJ)
                </Text>
                <Group gap={6}>
                  {dados.assuntos.map((a, i) => (
                    <Badge key={i} variant="outline" color="gray">
                      {a}
                    </Badge>
                  ))}
                </Group>
              </div>
            )}

            {dados.parteContraria && (
              <div>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Parte contrária
                </Text>
                <Text size="sm">{dados.parteContraria}</Text>
              </div>
            )}

            <Divider label="Movimentações" labelPosition="left" />

            <Stack gap="xs" mah={320} style={{ overflowY: 'auto' }}>
              {(dados.movimentos ?? []).length === 0 && (
                <Text size="sm" c="dimmed">
                  Nenhuma movimentação retornada.
                </Text>
              )}
              {(dados.movimentos ?? []).map((m, i) => (
                <div key={i} style={{ borderLeft: `2px solid ${TAG_META[m.tag].color}`, paddingLeft: 10 }}>
                  <Group gap={8}>
                    <CalendarDays size={14} />
                    <Text size="xs" c="dimmed">
                      {fmtData(m.data)}
                    </Text>
                    <Badge size="xs" color={TAG_META[m.tag].color} variant="light">
                      {TAG_META[m.tag].label}
                    </Badge>
                  </Group>
                  <Text size="sm" fw={600} mt={2}>
                    {m.titulo}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {m.descricao}
                  </Text>
                </div>
              ))}
            </Stack>
          </>
        )}

        {deal.status === 'erro' && (
          <Group gap={6}>
            <Scale size={14} />
            <Text size="sm" c="red">
              {deal.erroMensagem ?? 'Falha ao processar este deal.'}
            </Text>
          </Group>
        )}

        {deal.status === 'sem_processo' && (
          <Group gap={6}>
            <Building2 size={14} />
            <Text size="sm" c="dimmed">
              Nenhum número de processo válido encontrado no campo configurado deste deal.
            </Text>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
