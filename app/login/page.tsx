import type { Metadata } from 'next';
import AuthGateway from '@/components/AuthGateway';
import NavbarPublica from '@/components/NavbarPublica';

export const metadata: Metadata = { title: 'Entrar' };

export default function Login() {
  return (
    <>
      <NavbarPublica />
      <AuthGateway variante="login" />
    </>
  );
}
