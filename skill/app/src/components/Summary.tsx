import * as Separator from '@radix-ui/react-separator';
import * as Progress from '@radix-ui/react-progress';
import { tokens } from '../lib/styles';
import type { ContextSnapshot, SuggestionsData } from '../lib/api';
import type { ZoNode } from '../lib/nodes';

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface SummaryProps {
  context: ContextSnapshot | null;
  suggestions: SuggestionsData | null;
  nodes: ZoNode[];
}

export function Summary({ context, suggestions, nodes }: SummaryProps) {
  if (!context) {
    return (
      <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, fontFamily: tokens.font.body }}>
        Loading...
      </div>
    );
  }

  const { sections } = context;
  const jobs = sections.jobs?.summary;
  const commits = sections.activity?.git_commits || [];
  const allSuggestions = suggestions?.suggestions || [];
  const highPriority = allSuggestions.filter(s => s.priority === 'high');

  const topNodes = nodes.slice(0, 3);
  const totalDone = nodes.reduce((n, nd) => n + nd.items.filter(i => i.status === 'done').length, 0);
  const totalAll = nodes.reduce((n, nd) => n + nd.items.length, 0);
  const overallPct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;

  const statusParts: string[] = [];
  if (jobs?.failed) statusParts.push(`${jobs.failed} failed`);
  if (highPriority.length) statusParts.push(`${highPriority.length} action${highPriority.length > 1 ? 's' : ''}`);
  if (!statusParts.length) statusParts.push('clear');

  return (
    <div>
      {/* Status line */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 14,
      }}>
        <div style={{
          width: 5, height: 5, borderRadius: '50%',
          background: jobs?.failed || highPriority.length ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)',
        }} />
        <span style={{
          fontFamily: tokens.font.body, fontSize: 13,
          color: 'rgba(255,255,255,0.5)', fontWeight: 300,
        }}>
          {statusParts.join(' · ')}
        </span>
        <span style={{
          marginLeft: 'auto', fontFamily: tokens.font.body,
          fontSize: 11, color: 'rgba(255,255,255,0.2)',
        }}>
          {timeAgo(context.collected_at)}
        </span>
      </div>

      {/* Progress bar */}
      <Progress.Root style={{
        height: 1, background: 'rgba(255,255,255,0.06)',
        borderRadius: 1, overflow: 'hidden',
        marginBottom: 16,
      }}>
        <Progress.Indicator style={{
          height: '100%', width: `${overallPct}%`,
          background: 'rgba(255,255,255,0.3)',
          transition: 'width 0.5s ease',
        }} />
      </Progress.Root>

      {/* Right now */}
      <div style={{
        display: 'flex', gap: 32, alignItems: 'baseline',
      }}>
        <span style={{
          fontFamily: tokens.font.body, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '1px',
          color: 'rgba(255,255,255,0.2)',
        }}>
          right now
        </span>
        {topNodes.map(node => (
          <span key={node.id} style={{
            fontFamily: tokens.font.body, fontSize: 13,
            color: 'rgba(255,255,255,0.6)', fontWeight: 300,
          }}>
            {node.label}
          </span>
        ))}
      </div>

      {commits.length > 0 && (
        <div style={{
          marginTop: 12, fontFamily: tokens.font.mono,
          fontSize: 11, color: 'rgba(255,255,255,0.2)',
        }}>
          {commits[0].hash} {commits[0].message}
        </div>
      )}
    </div>
  );
}
