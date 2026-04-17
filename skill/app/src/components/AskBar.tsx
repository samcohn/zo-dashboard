import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { tokens } from '../lib/styles';
import { askZo } from '../lib/api';

export function AskBar() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAsk() {
    if (!question.trim() || loading) return;
    setLoading(true);
    setAnswer('');
    try {
      const result = await askZo(question.trim());
      setAnswer(result);
    } catch (e) {
      setAnswer(`Error: ${e}`);
    }
    setLoading(false);
  }

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 0',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          cursor: 'text',
        }}
      >
        <span style={{
          fontFamily: tokens.font.display,
          fontSize: 14, color: 'rgba(255,255,255,0.3)',
        }}>
          zo
        </span>
        <span style={{
          fontFamily: tokens.font.body,
          fontSize: 13, color: 'rgba(255,255,255,0.15)',
          fontWeight: 300,
        }}>
          ask about your dashboard...
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10,
          color: 'rgba(255,255,255,0.15)',
          fontFamily: tokens.font.mono,
          border: '1px solid rgba(255,255,255,0.08)',
          padding: '1px 5px', borderRadius: 4,
        }}>
          /
        </span>
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
          }} />
          <Dialog.Content style={{
            position: 'fixed', top: '15%', left: '50%',
            transform: 'translateX(-50%)',
            width: '90%', maxWidth: 560,
            background: '#0a0a0a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 14, padding: 24,
            zIndex: 101, maxHeight: '70vh', overflow: 'auto',
          }}>
            <Dialog.Title style={{
              fontFamily: tokens.font.display,
              fontSize: 18, fontWeight: 400,
              marginBottom: 16, color: '#fff',
            }}>
              zo
            </Dialog.Title>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                autoFocus
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAsk()}
                placeholder="what should I focus on today?"
                style={{
                  flex: 1, fontFamily: tokens.font.body,
                  fontSize: 14, padding: '10px 14px',
                  background: '#000',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, color: '#fff', outline: 'none',
                  fontWeight: 300,
                }}
              />
              <button
                onClick={handleAsk}
                disabled={loading || !question.trim()}
                style={{
                  fontFamily: tokens.font.body,
                  fontSize: 13, padding: '10px 18px',
                  background: '#fff', border: 'none',
                  borderRadius: 8, color: '#000',
                  cursor: loading ? 'wait' : 'pointer',
                  fontWeight: 500, opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? '...' : 'ask'}
              </button>
            </div>

            {answer && (
              <div style={{
                padding: 14, background: 'rgba(255,255,255,0.03)',
                borderRadius: 8, fontSize: 13, lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                fontFamily: tokens.font.body, fontWeight: 300,
                color: 'rgba(255,255,255,0.6)',
              }}>
                {answer}
              </div>
            )}

            <Dialog.Close asChild>
              <button style={{
                position: 'absolute', top: 14, right: 14,
                background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.2)', fontSize: 16,
                cursor: 'pointer',
              }}>x</button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
