import * as Tabs from '@radix-ui/react-tabs';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { tokens } from '../lib/styles';
import type { Commit, Automation, JobSummary } from '../lib/api';

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

interface ActivityProps {
  commits: Commit[];
  automations: Automation[];
  jobs: JobSummary;
}

export function ActivityPanel({ commits, automations, jobs }: ActivityProps) {
  return (
    <div>
      <Tabs.Root defaultValue="commits">
        <Tabs.List style={{
          display: 'flex', gap: 0,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          marginBottom: 16,
        }}>
          {['commits', 'automations', 'jobs'].map(tab => (
            <Tabs.Trigger key={tab} value={tab} style={{
              fontSize: 12, padding: '8px 16px',
              border: 'none', borderBottom: '1px solid transparent',
              background: 'transparent',
              color: 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              fontFamily: tokens.font.body,
              textTransform: 'lowercase',
              transition: 'all 0.15s',
            }}>
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="commits">
          <ScrollArea.Root style={{ maxHeight: 250, overflow: 'hidden' }}>
            <ScrollArea.Viewport style={{ width: '100%', height: '100%' }}>
              {commits.length === 0 ? (
                <div style={{
                  padding: 20, color: 'rgba(255,255,255,0.15)',
                  fontSize: 13, fontFamily: tokens.font.body,
                }}>
                  no recent commits
                </div>
              ) : (
                commits.slice(0, 12).map((c, i) => (
                  <div key={i} style={{
                    padding: '6px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    fontSize: 12, display: 'flex',
                    alignItems: 'baseline', gap: 10,
                    fontFamily: tokens.font.body,
                  }}>
                    <span style={{
                      fontFamily: tokens.font.mono,
                      fontSize: 11, color: 'rgba(255,255,255,0.25)',
                      flexShrink: 0,
                    }}>
                      {c.hash}
                    </span>
                    <span style={{
                      flex: 1, color: 'rgba(255,255,255,0.5)',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', fontWeight: 300,
                    }}>
                      {c.message}
                    </span>
                    <span style={{
                      fontFamily: tokens.font.mono,
                      fontSize: 10, color: 'rgba(255,255,255,0.15)',
                      flexShrink: 0,
                    }}>
                      {timeAgo(c.date)}
                    </span>
                  </div>
                ))
              )}
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}>
              <ScrollArea.Thumb style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 20 }} />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </Tabs.Content>

        <Tabs.Content value="automations">
          {automations.length === 0 ? (
            <div style={{
              padding: 20, color: 'rgba(255,255,255,0.15)',
              fontSize: 13, fontFamily: tokens.font.body,
            }}>
              no automations
            </div>
          ) : (
            automations.map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                <div style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.3)',
                }} />
                <span style={{
                  fontSize: 13, color: 'rgba(255,255,255,0.6)',
                  fontFamily: tokens.font.body, fontWeight: 300,
                }}>{a.skill}</span>
                <span style={{
                  fontSize: 11, color: 'rgba(255,255,255,0.2)',
                  fontFamily: tokens.font.body,
                }}>{a.type}</span>
              </div>
            ))
          )}
        </Tabs.Content>

        <Tabs.Content value="jobs">
          {[
            { label: 'total', value: jobs.total },
            { label: 'completed', value: jobs.completed },
            { label: 'pending', value: jobs.pending },
            { label: 'failed', value: jobs.failed },
          ].map(row => (
            <div key={row.label} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              fontFamily: tokens.font.body,
            }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontWeight: 300 }}>
                {row.label}
              </span>
              <span style={{
                fontSize: 13, color: row.value > 0 && row.label === 'failed' ? '#fff' : 'rgba(255,255,255,0.5)',
                fontFamily: tokens.font.mono,
              }}>
                {row.value}
              </span>
            </div>
          ))}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
