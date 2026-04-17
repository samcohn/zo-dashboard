import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import { tokens } from './lib/styles';
import { fetchContext, fetchSuggestions, refreshDashboard } from './lib/api';
import type { ContextSnapshot, SuggestionsData } from './lib/api';
import { deriveNodes } from './lib/nodes';
import { Summary } from './components/Summary';
import { ZoView } from './components/ZoView';
import { SuggestionList } from './components/SuggestionList';
import { ActivityPanel } from './components/ActivityPanel';
import { AskBar } from './components/AskBar';

const MIN_LOAD_MS = 4000;

function LoadingScreen() {
  const text = 'building your zo...';
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCharIndex(prev => {
        const next = prev + 1;
        if (next > text.length + 6) return 0;
        return next;
      });
    }, 90);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#000', zIndex: 1000,
    }}>
      <img
        src="/pegasus.gif"
        alt=""
        style={{
          width: 260, height: 'auto',
          opacity: 0.7,
          filter: 'grayscale(100%) brightness(1.2)',
        }}
      />
      <div style={{
        marginTop: 24,
        fontFamily: tokens.font.display,
        fontSize: 13,
        fontWeight: 400,
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: '0.5px',
        minHeight: 20,
      }}>
        {text.slice(0, charIndex)}
      </div>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  const [context, setContext] = useState<ContextSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ctx, sug] = await Promise.all([fetchContext(), fetchSuggestions()]);
      setContext(ctx);
      setSuggestions(sug);
      setError(null);
    } catch (e) {
      setError(`Failed to load: ${e}`);
    }
  }, []);

  useEffect(() => {
    const start = Date.now();
    load().then(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, MIN_LOAD_MS - elapsed);
      setTimeout(() => setReady(true), remaining);
    });
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  const nodes = useMemo(
    () => deriveNodes(context, suggestions?.suggestions),
    [context, suggestions],
  );

  async function handleReflect(focusText?: string) {
    setRefreshing(true);
    setPromptOpen(false);
    try {
      await refreshDashboard(focusText);
      await load();
    } catch (e) {
      setError(`Refresh failed: ${e}`);
    }
    setRefreshing(false);
    setFocus('');
  }

  const sections = context?.sections;

  if (!ready) return <LoadingScreen />;

  return (
    <Tooltip.Provider delayDuration={300}>
      <div style={{
        animation: 'fadeIn 0.8s ease-out',
        maxWidth: 1100,
        margin: '0 auto',
        padding: '20px 24px 80px',
        minHeight: '100vh',
      }}>
        {/* Header */}
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 0',
          marginBottom: tokens.space.xl,
        }}>
          <div style={{
            fontFamily: tokens.font.display,
            fontSize: 22,
            fontWeight: 400,
            letterSpacing: '-0.3px',
            color: '#fff',
          }}>
            sam's zo
          </div>

          <Popover.Root open={promptOpen} onOpenChange={setPromptOpen}>
            <Popover.Trigger asChild>
              <button
                disabled={refreshing}
                style={{
                  fontFamily: tokens.font.body,
                  fontSize: 12,
                  padding: '7px 20px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 20,
                  background: 'transparent',
                  color: refreshing ? 'rgba(255,255,255,0.3)' : '#fff',
                  cursor: refreshing ? 'wait' : 'pointer',
                  fontWeight: 400,
                  letterSpacing: '0.5px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { if (!refreshing) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {refreshing ? 'reflecting...' : 'reflect'}
              </button>
            </Popover.Trigger>

            <Popover.Portal>
              <Popover.Content
                side="bottom" align="end" sideOffset={8}
                style={{
                  background: '#0a0a0a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 14,
                  padding: 16,
                  width: 340,
                  zIndex: 50,
                  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                }}
                onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus(); }}
              >
                <div style={{
                  fontSize: 12, color: 'rgba(255,255,255,0.3)',
                  fontFamily: tokens.font.body,
                  marginBottom: 10,
                }}>
                  What do you want to understand?
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    ref={inputRef}
                    value={focus}
                    onChange={e => setFocus(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleReflect(focus || undefined); }}
                    placeholder="what should I ship next..."
                    style={{
                      flex: 1, fontFamily: tokens.font.body,
                      fontSize: 13, padding: '8px 12px',
                      background: '#000',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8, color: '#fff', outline: 'none',
                    }}
                  />
                  <button
                    onClick={() => handleReflect(focus || undefined)}
                    style={{
                      fontFamily: tokens.font.body,
                      fontSize: 12, padding: '8px 16px',
                      background: '#fff', border: 'none',
                      borderRadius: 8, color: '#000',
                      cursor: 'pointer', fontWeight: 500,
                    }}
                  >go</button>
                </div>

                <button
                  onClick={() => handleReflect()}
                  style={{
                    width: '100%', fontFamily: tokens.font.body,
                    fontSize: 11, padding: '8px',
                    background: 'transparent', border: 'none',
                    color: 'rgba(255,255,255,0.25)',
                    cursor: 'pointer', marginTop: 6,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; }}
                >
                  or just reflect
                </button>

                <Popover.Arrow style={{ fill: '#0a0a0a' }} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </header>

        {error && (
          <div style={{
            padding: '10px 14px',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 10, fontSize: 13,
            fontFamily: tokens.font.body,
            color: 'rgba(255,255,255,0.6)',
            marginBottom: tokens.space.lg,
          }}>
            {error}
          </div>
        )}

        <Summary context={context} suggestions={suggestions} nodes={nodes} />
        <div style={{ height: tokens.space.xl }} />

        <ZoView nodes={nodes} suggestions={suggestions?.suggestions} />
        <div style={{ height: tokens.space.xl }} />

        <AskBar />
        <div style={{ height: tokens.space.xl }} />

        <SuggestionList suggestions={suggestions?.suggestions || []} />
        <div style={{ height: tokens.space.xl }} />

        <ActivityPanel
          commits={sections?.activity?.git_commits || []}
          automations={sections?.automations?.discovered || []}
          jobs={sections?.jobs?.summary || { total: 0, pending: 0, completed: 0, failed: 0 }}
        />
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
      </div>
    </Tooltip.Provider>
  );
}
