import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Separator from '@radix-ui/react-separator';
import * as Dialog from '@radix-ui/react-dialog';
import * as Collapsible from '@radix-ui/react-collapsible';
import { useState, useEffect, useRef } from 'react';
import { askZo } from '../lib/api';
import type { Suggestion } from '../lib/api';
import type { ZoNode } from '../lib/nodes';
import { tokens } from '../lib/styles';
import { GrowthViz } from './GrowthViz';
import { ProjectList } from './ProjectList';

type ViewMode = 'graph' | 'list' | 'custom';

interface Props {
  nodes: ZoNode[];
  suggestions?: Suggestion[];
}

function NodeDetail({ node, nodes, suggestions }: {
  node: ZoNode;
  nodes: ZoNode[];
  suggestions: Suggestion[];
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastId = useRef<string | null>(null);

  // Fetch LLM summary when node changes
  useEffect(() => {
    if (node.id === lastId.current) return;
    lastId.current = node.id;
    setSummary(null);
    setLoading(true);

    const connectedLabels = node.connections
      .map(cid => nodes.find(n => n.id === cid)?.label)
      .filter(Boolean);

    const prompt = `Summarize what "${node.label}" is in 2-3 sentences. It's a ${node.type} in a Zo workspace. Details: ${node.detail}. It has ${node.items.length} items (${node.items.filter(i => i.status === 'done').length} done). Connected to: ${connectedLabels.join(', ') || 'nothing'}. Be concise and specific.`;

    askZo(prompt)
      .then(r => setSummary(r))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [node.id]);

  const connectedNodes = node.connections
    .map(cid => nodes.find(n => n.id === cid))
    .filter((n): n is ZoNode => !!n);

  // Filter suggestions related to this node
  const nodeTokens = node.label.toLowerCase().split(/[-_\s]+/).filter(t => t.length > 2);
  const relatedSuggestions = suggestions.filter(s => {
    const text = `${s.title} ${s.description}`.toLowerCase();
    return nodeTokens.some(t => text.includes(t));
  });

  return (
    <ScrollArea.Root style={{ flex: 1, overflow: 'hidden', maxHeight: 500 }}>
      <ScrollArea.Viewport style={{ width: '100%', height: '100%' }}>
        {/* LLM Summary */}
        <div style={{ marginBottom: 16 }}>
          {loading ? (
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.2)',
              fontFamily: tokens.font.body, fontStyle: 'italic',
            }}>
              thinking...
            </div>
          ) : summary ? (
            <div style={{
              fontSize: 12, lineHeight: 1.7, color: 'rgba(255,255,255,0.5)',
              fontFamily: tokens.font.body, fontWeight: 300,
            }}>
              {summary}
            </div>
          ) : null}
        </div>

        {/* Connected nodes */}
        {connectedNodes.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 10, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '1px',
              color: 'rgba(255,255,255,0.25)',
              fontFamily: tokens.font.body,
              marginBottom: 8,
            }}>
              connected
            </div>
            {connectedNodes.map(cn => (
              <div key={cn.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: cn.health === 'needs-attention'
                    ? 'rgba(255,255,255,0.6)'
                    : 'rgba(255,255,255,0.3)',
                }} />
                <span style={{
                  fontSize: 13, color: 'rgba(255,255,255,0.6)',
                  fontFamily: tokens.font.body, fontWeight: 300,
                }}>
                  {cn.label}
                </span>
                <span style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.2)',
                  fontFamily: tokens.font.body, marginLeft: 'auto',
                }}>
                  {cn.type}
                </span>
              </div>
            ))}
          </div>
        )}

        <Separator.Root style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginBottom: 16 }} />

        {/* Related suggestions */}
        {relatedSuggestions.length > 0 ? (
          <div>
            <div style={{
              fontSize: 10, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '1px',
              color: 'rgba(255,255,255,0.25)',
              fontFamily: tokens.font.body,
              marginBottom: 8,
            }}>
              suggestions
            </div>
            {relatedSuggestions.map((s, i) => (
              <Collapsible.Root key={i}>
                <Collapsible.Trigger asChild>
                  <button style={{
                    width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    padding: '8px 0', cursor: 'pointer', color: '#fff',
                    fontFamily: tokens.font.body,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 9, textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        color: s.priority === 'high' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
                        flexShrink: 0,
                      }}>
                        {s.category}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 300, flex: 1 }}>
                        {s.title}
                      </span>
                    </div>
                  </button>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <div style={{
                    padding: '4px 0 12px 0',
                    fontSize: 11, lineHeight: 1.7,
                    fontFamily: tokens.font.body,
                    color: 'rgba(255,255,255,0.35)',
                  }}>
                    {s.description}
                    {s.action && (
                      <div style={{
                        fontFamily: tokens.font.mono,
                        fontSize: 10, color: 'rgba(255,255,255,0.25)',
                        padding: '4px 8px', marginTop: 6,
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: 4,
                      }}>
                        {s.action}
                      </div>
                    )}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            ))}
          </div>
        ) : (
          <div style={{
            fontSize: 12, color: 'rgba(255,255,255,0.15)',
            fontFamily: tokens.font.body, fontStyle: 'italic',
          }}>
            no suggestions for this node
          </div>
        )}

        {/* Items */}
        {node.items.length > 0 && (
          <>
            <Separator.Root style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '16px 0' }} />
            <div style={{
              fontSize: 10, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '1px',
              color: 'rgba(255,255,255,0.25)',
              fontFamily: tokens.font.body,
              marginBottom: 8,
            }}>
              items
            </div>
            {node.items.map((item, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '3px 0', fontSize: 12,
                fontFamily: tokens.font.body,
              }}>
                <span style={{
                  fontFamily: tokens.font.mono, fontSize: 10,
                  color: 'rgba(255,255,255,0.2)', flexShrink: 0,
                }}>
                  {item.status === 'done' ? '✓' : item.status === 'todo' ? '○' : '?'}
                </span>
                <span style={{
                  color: item.status === 'done' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)',
                  textDecoration: item.status === 'done' ? 'line-through' : 'none',
                  fontWeight: 300,
                }}>
                  {item.label}
                </span>
              </div>
            ))}
          </>
        )}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}>
        <ScrollArea.Thumb style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 20 }} />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

export function ZoView({ nodes, suggestions = [] }: Props) {
  const [mode, setMode] = useState<ViewMode>('graph');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customViz, setCustomViz] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [prompting, setPrompting] = useState(false);

  const selectedNode = nodes.find(n => n.id === selectedId) || null;
  const types = ['all', ...new Set(nodes.map(n => n.type))];

  async function handleImagine() {
    if (!prompt.trim() || prompting) return;
    setPrompting(true);

    const nodesSummary = nodes.map(n =>
      `${n.label} (${n.type}, ${n.health}, ${n.items.filter(i => i.status === 'done').length}/${n.items.length} done)`
    ).join('\n');

    const fullPrompt = `The user wants to see their Zo dashboard data visualized as: "${prompt.trim()}"

Here are their nodes:
${nodesSummary}

Generate a creative text/unicode visualization that represents this data in the style they described. Use only monospace-safe characters. Be creative and make it feel alive. Output ONLY the visualization, no explanation.`;

    try {
      const result = await askZo(fullPrompt);
      setCustomViz(result);
      setMode('custom');
      setPromptOpen(false);
    } catch {
      setCustomViz('(visualization failed)');
    }
    setPrompting(false);
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: selectedNode ? '1fr 300px' : '1fr',
      gap: 20,
    }}>
      {/* Main panel */}
      <div style={{
        background: '#000',
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Controls bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexWrap: 'wrap',
        }}>
          {/* View mode */}
          <ToggleGroup.Root
            type="single"
            value={mode}
            onValueChange={v => v && setMode(v as ViewMode)}
            style={{ display: 'flex', gap: 2 }}
          >
            {['graph', 'list'].map(m => (
              <ToggleGroup.Item key={m} value={m} style={{
                fontSize: 11,
                padding: '4px 12px',
                border: '1px solid',
                borderColor: mode === m ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)',
                borderRadius: 20,
                background: mode === m ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: mode === m ? '#fff' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                fontFamily: '"Diatype", "Inter", sans-serif',
                textTransform: 'lowercase',
                letterSpacing: '0.5px',
              }}>
                {m}
              </ToggleGroup.Item>
            ))}
            {customViz && (
              <ToggleGroup.Item value="custom" style={{
                fontSize: 11, padding: '4px 12px',
                border: '1px solid',
                borderColor: mode === 'custom' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)',
                borderRadius: 20,
                background: mode === 'custom' ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: mode === 'custom' ? '#fff' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                fontFamily: '"Diatype", "Inter", sans-serif',
              }}>
                custom
              </ToggleGroup.Item>
            )}
          </ToggleGroup.Root>

          {/* Separator */}
          <Separator.Root orientation="vertical" style={{
            width: 1, height: 16, background: 'rgba(255,255,255,0.08)',
          }} />

          {/* Type filter */}
          <ToggleGroup.Root
            type="single"
            value={filter}
            onValueChange={v => v && setFilter(v)}
            style={{ display: 'flex', gap: 2 }}
          >
            {types.map(t => (
              <ToggleGroup.Item key={t} value={t} style={{
                fontSize: 11,
                padding: '4px 10px',
                border: 'none',
                borderRadius: 20,
                background: filter === t ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: filter === t ? '#fff' : 'rgba(255,255,255,0.3)',
                cursor: 'pointer',
                fontFamily: '"Diatype", "Inter", sans-serif',
                textTransform: 'lowercase',
              }}>
                {t === 'all' ? 'all' : t + 's'}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>

          {/* Imagine button */}
          <button
            onClick={() => setPromptOpen(true)}
            style={{
              marginLeft: 'auto',
              fontSize: 11, padding: '4px 12px',
              border: '1px dashed rgba(255,255,255,0.15)',
              borderRadius: 20,
              background: 'transparent',
              color: 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              fontFamily: '"Diatype", "Inter", sans-serif',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
          >
            + imagine
          </button>
        </div>

        {/* View content */}
        <div style={{ flex: 1, minHeight: 420 }}>
          {mode === 'graph' && (
            <GrowthViz
              nodes={nodes}
              selectedId={selectedId}
              onSelect={id => setSelectedId(id === selectedId ? null : id)}
              filter={filter}
            />
          )}

          {mode === 'list' && (
            <ScrollArea.Root style={{ height: 420, overflow: 'hidden' }}>
              <ScrollArea.Viewport style={{ width: '100%', height: '100%', padding: 16 }}>
                <ProjectList
                  nodes={filter === 'all' ? nodes : nodes.filter(n => n.type === filter)}
                  selectedId={selectedId}
                  onSelect={id => setSelectedId(id === selectedId ? null : id)}
                />
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}>
                <ScrollArea.Thumb style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 20 }} />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          )}

          {mode === 'custom' && customViz && (
            <ScrollArea.Root style={{ height: 420, overflow: 'hidden' }}>
              <ScrollArea.Viewport style={{ width: '100%', height: '100%', padding: 16 }}>
                <pre style={{
                  fontFamily: '"Diatype", "SF Mono", monospace',
                  fontSize: 12, lineHeight: 1.6,
                  color: 'rgba(255,255,255,0.6)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {customViz}
                </pre>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}>
                <ScrollArea.Thumb style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 20 }} />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          )}
        </div>
      </div>

      {/* Detail sidebar */}
      {selectedNode && (
        <div style={{
          background: '#000',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontFamily: tokens.font.display,
              fontSize: 16, fontWeight: 400, color: '#fff',
            }}>
              {selectedNode.label}
            </span>
            <button
              onClick={() => setSelectedId(null)}
              style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.3)', cursor: 'pointer',
                fontSize: 14, fontFamily: tokens.font.body,
              }}
            >x</button>
          </div>

          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.25)',
            fontFamily: tokens.font.body,
            marginBottom: 14,
          }}>
            {selectedNode.type} · {selectedNode.health} · {selectedNode.detail}
          </div>

          <Separator.Root style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginBottom: 14 }} />

          <NodeDetail node={selectedNode} nodes={nodes} suggestions={suggestions} />
        </div>
      )}

      {/* Imagine dialog */}
      <Dialog.Root open={promptOpen} onOpenChange={setPromptOpen}>
        <Dialog.Portal>
          <Dialog.Overlay style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
          }} />
          <Dialog.Content style={{
            position: 'fixed', top: '20%', left: '50%',
            transform: 'translateX(-50%)',
            width: '90%', maxWidth: 460,
            background: '#0a0a0a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 14,
            padding: 24,
            zIndex: 101,
          }}>
            <Dialog.Title style={{
              fontFamily: '"Cardinal", Georgia, serif',
              fontSize: 18, fontWeight: 400, color: '#fff',
              marginBottom: 6,
            }}>
              Imagine a visualization
            </Dialog.Title>
            <Dialog.Description style={{
              fontSize: 13,
              fontFamily: '"Diatype", "Inter", sans-serif',
              color: 'rgba(255,255,255,0.4)',
              marginBottom: 16,
            }}>
              Describe how you want to see your Zo
            </Dialog.Description>

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleImagine()}
                placeholder="a constellation map..."
                style={{
                  flex: 1, fontFamily: '"Diatype", "Inter", sans-serif',
                  fontSize: 14, padding: '10px 14px',
                  background: '#000', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, color: '#fff', outline: 'none',
                }}
              />
              <button
                onClick={handleImagine}
                disabled={prompting || !prompt.trim()}
                style={{
                  fontFamily: '"Diatype", sans-serif',
                  fontSize: 13, padding: '10px 18px',
                  background: '#fff', border: 'none',
                  borderRadius: 8, color: '#000',
                  cursor: prompting ? 'wait' : 'pointer',
                  fontWeight: 500, opacity: prompting ? 0.5 : 1,
                }}
              >
                {prompting ? '...' : 'go'}
              </button>
            </div>

            <Dialog.Close asChild>
              <button style={{
                position: 'absolute', top: 14, right: 14,
                background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.3)', fontSize: 16,
                cursor: 'pointer',
              }}>x</button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
