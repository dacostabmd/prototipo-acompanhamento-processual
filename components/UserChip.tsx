'use client';

import { useEffect, useState } from 'react';
import { Avatar, Text } from '@mantine/core';
import { Crown } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { useSharedProfile } from './ProfileProvider';

const formatFirstName = (raw: string) => {
  if (!raw) return 'Usuário';
  // Remove parênteses como "(CaioM)" e pontuações
  const cleaned = raw.replace(/\(.*?\)/g, '').replace(/[._-]+/g, ' ').trim();
  const first = cleaned.split(/\s+/)[0] || '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Usuário';
};

export default function UserChip() {
  const [fullName, setFullName] = useState('');
  const { profile } = useSharedProfile();

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      try {
        const demo = localStorage.getItem('bf-demo-user') ?? '';
        setFullName(demo.includes('@') ? demo.split('@')[0] : 'Usuário');
      } catch {}
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      const meta = u?.user_metadata;
      setFullName(meta?.full_name || meta?.name || (u?.email ? u.email.split('@')[0] : 'Usuário'));
    });
  }, []);

  const firstName = formatFirstName(fullName);

  return (
    <div
      className="bf-user"
      title={fullName || firstName}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
        padding: 0
      }}
    >
      <Avatar
        name={fullName || firstName}
        color="brand"
        variant="filled"
        radius="xl"
        size={36}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text
          className="bf-user-name"
          size="sm"
          fw={600}
          style={{
            color: '#ffffff',
            fontWeight: 600
          }}
        >
          {firstName}
        </Text>
        {profile.plano === 'pro' && (
          <span
            title="Assinante Pro"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              borderRadius: 9999,
              border: '1px solid rgba(30, 124, 242, 0.4)',
              background: 'rgba(30, 124, 242, 0.15)',
              padding: '1px 6px',
              fontSize: '10px',
              fontWeight: 700,
              color: '#C9D6EE'
            }}
          >
            <Crown size={10} style={{ color: '#1E7CF2' }} />
            PRO
          </span>
        )}
      </div>
    </div>
  );
}

