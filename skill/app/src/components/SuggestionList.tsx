import * as Collapsible from '@radix-ui/react-collapsible';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useState } from 'react';
import { tokens } from '../lib/styles';
import type { Suggestion } from '../lib/api';

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger asChild>
        <button style={{
          width: '100%', textAlign: 'left',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          padding: '12px 0',
          cursor: 'pointer',
          color: '#fff',
          fontFamily: tokens.font.body,
          transition: 'opacity 0.15s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 9, textTransform: 'uppercase',
              letterSpacing: '1px',
              color: 'rgba(255,255,255,0.25)',
              width: 60, flexShrink: 0,
            }}>
              {suggestion.category}
            </span>
            <span style={{ fontSize: 13, fontWeight: 300, flex: 1 }}>
              {suggestion.title}
            </span>
            {suggestion.source === 'ai' && (
              <span style={{
                fontSize: 9, color: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '1px 6px', borderRadius: 10,
              }}>ai</span>
            )}
            <span style={{
              fontSize: 12, color: 'rgba(255,255,255,0.15)',
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}>
              ›
            </span>
          </div>
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div style={{
          padding: '4px 0 16px 70px',
          fontSize: 12, lineHeight: 1.7,
          fontFamily: tokens.font.body,
        }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
            {suggestion.description}
          </div>
          {suggestion.action && (
            <div style={{
              fontFamily: tokens.font.mono,
              fontSize: 11,
              color: 'rgba(255,255,255,0.3)',
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 6,
            }}>
              {suggestion.action}
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function SuggestionList({ suggestions }: { suggestions: Suggestion[] }) {
  const [filter, setFilter] = useState('all');
  const categories = ['all', ...new Set(suggestions.map(s => s.category))];
  const filtered = filter === 'all' ? suggestions : suggestions.filter(s => s.category === filter);

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 16,
      }}>
        <span style={{
          fontFamily: tokens.font.display,
          fontSize: 16, fontWeight: 400,
          color: '#fff',
        }}>
          suggestions
        </span>
        <span style={{
          fontSize: 11, color: 'rgba(255,255,255,0.2)',
          fontFamily: tokens.font.body,
        }}>
          {suggestions.length}
        </span>

        <ToggleGroup.Root
          type="single" value={filter}
          onValueChange={v => v && setFilter(v)}
          style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}
        >
          {categories.map(cat => (
            <ToggleGroup.Item key={cat} value={cat} style={{
              fontSize: 11, padding: '3px 10px',
              border: 'none', borderRadius: 20,
              background: filter === cat ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: filter === cat ? '#fff' : 'rgba(255,255,255,0.25)',
              cursor: 'pointer',
              fontFamily: tokens.font.body,
              textTransform: 'lowercase',
            }}>
              {cat}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: 24, textAlign: 'center',
          color: 'rgba(255,255,255,0.15)',
          fontSize: 13, fontFamily: tokens.font.body,
        }}>
          nothing here
        </div>
      ) : (
        filtered.map((s, i) => <SuggestionCard key={i} suggestion={s} />)
      )}
    </div>
  );
}
