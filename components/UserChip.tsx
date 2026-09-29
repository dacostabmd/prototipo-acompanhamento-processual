'use client';

import { useEffect, useState } from 'react';
import { Avatar, Text } from '@mantine/core';
import { getSupabase } from '@/lib/supabase';

const pretty = (s: string) => s.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export default function UserChip() {
  const [name, setName] = useState('');

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      try {
        const demo = localStorage.getItem('bf-demo-user') ?? '';
        setName(demo.includes('@') ? pretty(demo.split('@')[0]) : 'Usuário');
      } catch {}
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      const meta = u?.user_metadata;
      setName(meta?.full_name || meta?.name || (u?.email ? pretty(u.email.split('@')[0]) : 'Usuário'));
    });
  }, []);

  return (
    <div className="bf-user" title={name}>
      <Text className="bf-user-name" size="sm" fw={600}>
        {name || ' '}
      </Text>
      <Avatar name={name || undefined} color="brand" variant="filled" radius="xl" size={38} />
    </div>
  );
}
