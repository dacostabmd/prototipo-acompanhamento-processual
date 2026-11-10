import { AgendaPrazos } from '@/components/agenda/AgendaPrazos';

export default function Agenda() {
  return (
    <div className="bf-page [--bf-page-max:72rem]">
      <header className="bf-page-titulo mb-8">
        <h1 className="m-0 text-3xl font-bold tracking-tight text-white">Agenda de prazos</h1>
        <p className="mb-0 mt-2 text-white/60">Prazos, tarefas e audiências com lembretes por WhatsApp e e-mail.</p>
      </header>

      <AgendaPrazos />
    </div>
  );
}
