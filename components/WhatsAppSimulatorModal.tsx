'use client';

import { useState } from 'react';
import { Modal, TextInput, Loader } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { MessageCircle, Send, Sparkles, CheckCheck, Bot, User, Smartphone } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';

interface Props {
  opened: boolean;
  onClose: () => void;
  processoIdPadrao?: string;
}

interface Mensagem {
  id: string;
  autor: 'copiloto' | 'usuario';
  texto: string;
  hora: string;
}

const SUGESTOES = [
  'Como estão meus processos monitorados?',
  "O que significa 'conclusos para despacho'?",
  'Tenho algum prazo urgente correndo?'
];

export function WhatsAppSimulatorModal({ opened, onClose, processoIdPadrao }: Props) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([
    {
      id: 'msg-0',
      autor: 'copiloto',
      texto:
        'Olá! Sou o Copiloto Jurídico do JusConsulta. Acompanho seus processos em todos os tribunais e explico andamentos, intimações e prazos em linguagem simples 24 horas por dia.\n\nComo posso ajudar você agora?',
      hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [entrada, setEntrada] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [enviandoReal, setEnviandoReal] = useState(false);

  const enviarMensagem = async (textoParaEnviar?: string) => {
    const texto = (textoParaEnviar || entrada).trim();
    if (!texto || carregando) return;

    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const msgUsuario: Mensagem = {
      id: `usr-${Date.now()}`,
      autor: 'usuario',
      texto,
      hora: agora
    };

    setMensagens(antigas => [...antigas, msgUsuario]);
    setEntrada('');
    setCarregando(true);

    try {
      const res = await authFetch('/api/whatsapp/simular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'texto', mensagem: texto })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Falha ao obter resposta do Copiloto.');
      }

      const msgCopiloto: Mensagem = {
        id: `bot-${Date.now()}`,
        autor: 'copiloto',
        texto: data.respostaWhatsApp || 'Desculpe, não consegui processar a resposta neste momento.',
        hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };

      setMensagens(antigas => [...antigas, msgCopiloto]);
    } catch (err: unknown) {
      notifications.show({
        title: 'Erro na simulação',
        message: err instanceof Error ? err.message : 'Não foi possível se comunicar com o Copiloto.',
        color: 'red'
      });
    } finally {
      setCarregando(false);
    }
  };

  const dispararTesteReal = async () => {
    if (!processoIdPadrao) {
      notifications.show({
        title: 'Nenhum processo selecionado',
        message: 'Você precisa ter ao menos um processo monitorado para disparar o teste real.',
        color: 'yellow'
      });
      return;
    }

    setEnviandoReal(true);
    try {
      const res = await authFetch('/api/whatsapp/testar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processoId: processoIdPadrao })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha no envio de teste');

      notifications.show({
        title: 'Notificação enviada',
        message: 'Resumo com IA gerado pelo Agente e enviado ao seu WhatsApp cadastrado.',
        color: 'green',
        autoClose: 5000
      });
    } catch (err: unknown) {
      notifications.show({
        title: 'Não foi possível enviar',
        message: err instanceof Error ? err.message : 'Verifique se o celular está cadastrado no seu perfil.',
        color: 'red',
        autoClose: 6000
      });
    } finally {
      setEnviandoReal(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      radius="xl"
      centered
      withCloseButton={false}
      padding={0}
      styles={{
        content: {
          backgroundColor: '#0d1117',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          overflow: 'hidden'
        }
      }}
    >
      {/* Header Estilo WhatsApp Corporativo */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#161b22] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25d366]/20 text-[#25d366]">
            <MessageCircle size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">Copiloto Jurídico JusConsulta</h3>
              <span className="rounded-full bg-[#25d366]/20 px-2 py-0.5 text-[10px] font-medium text-[#25d366]">
                Online 24h
              </span>
            </div>
            <p className="text-xs text-white/50">WhatsApp Integrado com LangChain + DataJud</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* Sugestões de Perguntas Rápidas */}
      <div className="border-b border-white/5 bg-[#12161f] px-5 py-2.5">
        <div className="flex items-center gap-1.5 text-xs text-white/40">
          <Sparkles size={12} className="text-[#e8d5b0]" />
          <span>Perguntas rápidas:</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SUGESTOES.map((sugestao, idx) => (
            <button
              key={idx}
              type="button"
              disabled={carregando}
              onClick={() => enviarMensagem(sugestao)}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 transition hover:border-[#25d366]/40 hover:bg-[#25d366]/10 hover:text-white disabled:opacity-50"
            >
              {sugestao}
            </button>
          ))}
        </div>
      </div>

      {/* Área de Conversa */}
      <div className="h-80 space-y-3 overflow-y-auto bg-[#0a0d14] p-4 text-sm">
        {mensagens.map(msg => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.autor === 'usuario' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm whitespace-pre-wrap leading-relaxed ${
                msg.autor === 'usuario'
                  ? 'rounded-br-none bg-[#005c4b] text-white'
                  : 'rounded-bl-none border border-white/10 bg-[#1f242d] text-white/90'
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium opacity-60">
                {msg.autor === 'usuario' ? (
                  <>
                    <User size={10} />
                    <span>Você</span>
                  </>
                ) : (
                  <>
                    <Bot size={10} />
                    <span>Copiloto JusConsulta</span>
                  </>
                )}
              </div>
              <p className="text-xs leading-relaxed">{msg.texto}</p>
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-white/40">
                <span>{msg.hora}</span>
                {msg.autor === 'usuario' && <CheckCheck size={12} className="text-[#53bdeb]" />}
              </div>
            </div>
          </div>
        ))}

        {carregando && (
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-none border border-white/10 bg-[#1f242d] px-4 py-3 text-xs text-white/60">
            <Loader size={14} color="teal" />
            <span>Copiloto consultando andamentos no tribunal...</span>
          </div>
        )}
      </div>

      {/* Barra de Envio e Ação Real */}
      <div className="border-t border-white/10 bg-[#161b22] p-4">
        <form
          onSubmit={e => {
            e.preventDefault();
            enviarMensagem();
          }}
          className="flex items-center gap-2"
        >
          <TextInput
            placeholder="Digite sua dúvida jurídica ou sobre seus processos..."
            value={entrada}
            onChange={e => setEntrada(e.currentTarget.value)}
            disabled={carregando}
            className="flex-1"
            styles={{
              input: {
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                color: '#fff'
              }
            }}
          />
          <button
            type="submit"
            disabled={!entrada.trim() || carregando}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#25d366] text-[#0d1117] transition hover:bg-[#20ba59] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={15} />
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2 text-[11px] text-white/40">
          <span>Respostas alimentadas pelo Agente ReAct com ferramentas DataJud.</span>
          {processoIdPadrao && (
            <button
              type="button"
              disabled={enviandoReal}
              onClick={dispararTesteReal}
              className="inline-flex cursor-pointer items-center gap-1 font-medium text-[#25d366] transition hover:underline disabled:opacity-50"
            >
              <Smartphone size={12} />
              <span>{enviandoReal ? 'Enviando ao seu WhatsApp...' : 'Enviar teste ao WhatsApp real'}</span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
