import * as Collapsible from '@radix-ui/react-collapsible';
import * as Progress from '@radix-ui/react-progress';
import * as Separator from '@radix-ui/react-separator';
import { tokens } from '../lib/styles';
import type { ZoNode } from '../lib/nodes';

function NodeProject({ node, selected, onSelect }: {
  node: ZoNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const done = node.items.filter(i => i.status === 'done').length;
  const total = node.items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <Collapsible.Root open={selected} onOpenChange={() => onSelect()}>
      <Collapsible.Trigger asChild>
        <button style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          padding: '10px 0', cursor: 'pointer',
          color: '#fff', fontFamily: tokens.font.body,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 300, flex: 1 }}>
              {node.label}
            </span>
            {node.relevance > 0.4 && (
              <span style={{
                fontSize: 9, padding: '1px 6px',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, color: 'rgba(255,255,255,0.4)',
              }}>
                now
              </span>
            )}
            <span style={{
              fontSize: 11, color: 'rgba(255,255,255,0.2)',
              fontFamily: tokens.font.mono,
            }}>
              {done}/{total}
            </span>
            <span style={{
              fontSize: 12, color: 'rgba(255,255,255,0.15)',
              transform: selected ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}>›</span>
          </div>

          <Progress.Root style={{
            height: 1, background: 'rgba(255,255,255,0.04)',
            borderRadius: 1, overflow: 'hidden',
          }}>
            <Progress.Indicator style={{
              height: '100%', width: `${pct}%`,
              background: 'rgba(255,255,255,0.2)',
              transition: 'width 0.4s ease',
            }} />
          </Progress.Root>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div style={{ padding: '4px 0 16px 20px' }}>
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.2)',
            fontFamily: tokens.font.body, marginBottom: 10,
          }}>
            {node.detail}
          </div>

          {node.items.length === 0 ? (
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.15)',
              fontStyle: 'italic',
            }}>
              no items
            </div>
          ) : (
            node.items.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '3px 0', fontSize: 12,
                fontFamily: tokens.font.body,
              }}>
                <span style={{
                  fontFamily: tokens.font.mono, fontSize: 11,
                  color: 'rgba(255,255,255,0.2)', width: 24, flexShrink: 0,
                }}>
                  {item.status === 'done' ? '[x]' : item.status === 'todo' ? '[ ]' : '[?]'}
                </span>
                <span style={{
                  color: item.status === 'done' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)',
                  textDecoration: item.status === 'done' ? 'line-through' : 'none',
                  fontWeight: 300,
                }}>
                  {item.label}
                </span>
              </div>
            ))
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

interface Props {
  nodes: ZoNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ProjectList({ nodes, selectedId, onSelect }: Props) {
  const totalDone = nodes.reduce((n, nd) => n + nd.items.filter(i => i.status === 'done').length, 0);
  const totalTodo = nodes.reduce((n, nd) => n + nd.items.filter(i => i.status === 'todo').length, 0);
  const totalExplore = nodes.reduce((n, nd) => n + nd.items.filter(i => i.status === 'explore').length, 0);
  const totalAll = totalDone + totalTodo + totalExplore;
  const pct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 16,
        marginBottom: 12,
      }}>
        <span style={{
          fontFamily: tokens.font.mono, fontSize: 11,
          color: 'rgba(255,255,255,0.3)',
        }}>
          {pct}%
        </span>
        <span style={{
          fontSize: 11, color: 'rgba(255,255,255,0.15)',
          fontFamily: tokens.font.body,
        }}>
          {totalDone} done · {totalTodo} todo · {totalExplore} explore
        </span>
      </div>

      <Progress.Root style={{
        height: 1, background: 'rgba(255,255,255,0.04)',
        borderRadius: 1, overflow: 'hidden', marginBottom: 16,
      }}>
        <Progress.Indicator style={{
          height: '100%', width: `${pct}%`,
          background: 'rgba(255,255,255,0.25)',
          transition: 'width 0.5s ease',
        }} />
      </Progress.Root>

      <Separator.Root style={{
        height: 1, background: 'rgba(255,255,255,0.04)',
        marginBottom: 8,
      }} />

      {nodes.map(node => (
        <NodeProject
          key={node.id}
          node={node}
          selected={node.id === selectedId}
          onSelect={() => onSelect(node.id)}
        />
      ))}
    </div>
  );
}
