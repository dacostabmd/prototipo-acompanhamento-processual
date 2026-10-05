'use client';

import { Badge, Divider, Group, Modal, Stack, Text } from '@mantine/core';
import { Building2, CalendarDays, Gavel, Scale } from 'lucide-react';
import { TAG_META } from '@/lib/mockProcesses';
import { ESFERA_LABEL, STATUS_ENRIQUECIMENTO_LABEL, type CrmItem, type CrmPipelineCampo, type CrmTipoCampo } from '@/lib/crm';

interface Props {
  opened: boolean;
  onClose: () => void;
  item: CrmItem | null;
  campos: CrmPipelineCampo[];
  tipos: CrmTipoCampo[];
}

const fmtData = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

function formatarValorCampo(valor: unknown, campo: CrmPipelineCampo): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (campo.opcoes) return campo.opcoes.find(o => o.value === valor)?.label ?? String(valor);
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  return String(valor);
}

export default function ModalDetalheItem({ opened, onClose, item, campos, tipos }: Props) {
  if (!item) return null;
  const dados = item.dadosEnriquecidos;
  const semDados = !dados.fonte;
  const camposAtivos = campos.filter(c => c.ativo);

  return (
    <Modal opened={opened} onClose={onClose} size="xl" radius="lg" padding="lg" title={<Text fw={600}>{item.titulo}</Text>}>
      <Stack gap="md">
        <Group gap="xs">
          <Badge color="gray" variant="light">
            {item.numeroCnjFormatado ?? 'Sem número de processo'}
          </Badge>
          {item.tribunalLabel && (
            <Badge color="blue" variant="light" leftSection={<Gavel size={12} />}>
              {item.tribunalLabel}
            </Badge>
          )}
          {item.esfera && (
            <Badge color="teal" variant="light">
              {ESFERA_LABEL[item.esfera]}
            </Badge>
          )}
          <Badge color={item.statusEnriquecimento === 'enriquecido' ? 'green' : item.statusEnriquecimento === 'erro' ? 'red' : 'gray'} variant="light">
            {STATUS_ENRIQUECIMENTO_LABEL[item.statusEnriquecimento]}
          </Badge>
        </Group>

        {camposAtivos.length > 0 && (
          <>
            <Divider label="Campos do pipeline" labelPosition="left" />
            <Group grow align="flex-start">
              {camposAtivos.map(campo => (
                <div key={campo.id}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    {campo.nome}
                  </Text>
                  <Text size="sm">{formatarValorCampo(item.camposCustomizados[campo.slug], campo)}</Text>
                </div>
              ))}
            </Group>
          </>
        )}

        <Divider label="Enriquecimento jurídico" labelPosition="left" />

        {semDados ? (
          <Text size="sm" c="dimmed">
            {item.statusEnriquecimento === 'pendente'
              ? 'Ainda não enriquecido. Use o botão "Enriquecer" na tabela para consultar DataJud/Infosimples.'
              : item.statusEnriquecimento === 'sem_dado'
              ? 'Nenhum dado encontrado no DataJud/Infosimples para este número de processo.'
              : 'Sem dados de enriquecimento.'}
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
                  Valor da causa
                </Text>
                <Text size="sm">{dados.valorCausa ?? '—'}</Text>
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

        {item.statusEnriquecimento === 'erro' && (
          <Group gap={6}>
            <Scale size={14} />
            <Text size="sm" c="red">
              {item.erroMensagem ?? 'Falha ao enriquecer este item.'}
            </Text>
          </Group>
        )}

        {!item.numeroCnj && (
          <Group gap={6}>
            <Building2 size={14} />
            <Text size="sm" c="dimmed">
              Nenhum número de processo informado para este item.
            </Text>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
