import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { api } from '../lib/api.js';
import ImportPanel from '../components/ImportPanel.jsx';
import AskWorkspace from '../components/AskWorkspace.jsx';
import DecisionsView from '../components/DecisionsView.jsx';
import Overview from '../components/Overview.jsx';
import App from '../App.jsx';
import { ExtLink } from '../components/ui.jsx';
import { answerOk, answerInsufficient, decisions } from './fixtures.js';

beforeEach(() => vi.useRealTimers());
afterEach(cleanup);

describe('E. UI', () => {
  test('repository connection flow shows progress and fetched/processed/skipped counts', async () => {
    vi.spyOn(api, 'startImport').mockResolvedValue({ job: { id: 'j1', status: 'running', stage: 'commits', detail: 'Listing commits', repo: 'o/r' } });
    vi.spyOn(api, 'job').mockResolvedValue({
      job: { id: 'j1', status: 'done', stage: 'done', detail: 'Imported o/r', repo: 'o/r', result: { fetched: { commits: 10, pulls: 2, issues: 3, comments: 4 }, processed: { commits: 10, pulls: 2, issues: 3, evidence: 20, decisions: 4, relationships: 99 }, skipped: { count: 1, byType: { pr_comments: 1 } } } },
    });
    const onImported = vi.fn();
    render(<ImportPanel githubToken onImported={onImported} />);
    fireEvent.change(screen.getByPlaceholderText(/github.com\/owner\/repo/), { target: { value: 'https://github.com/o/r' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Listing commits')).toBeTruthy();
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('o/r'), { timeout: 3000 });
    expect(screen.getByText('fetched')).toBeTruthy();
    expect(screen.getByText('skipped')).toBeTruthy();
    expect(screen.getByText('1 pr comments')).toBeTruthy();
  });

  test('ingestion failure is shown with its error code', async () => {
    vi.spyOn(api, 'startImport').mockResolvedValue({ job: { id: 'j2', status: 'running', stage: 'fetching', detail: '' } });
    vi.spyOn(api, 'job').mockResolvedValue({ job: { id: 'j2', status: 'failed', stage: 'failed', detail: '', error: { code: 'GITHUB_NOT_FOUND', message: 'Repository not found' } } });
    render(<ImportPanel githubToken onImported={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/github.com\/owner\/repo/), { target: { value: 'o/missing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/Repository not found/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/GITHUB_NOT_FOUND/)).toBeTruthy();
  });

  test('asking a question renders cited claims, fact/inference labels, chain and evidence links', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue(answerOk);
    render(<AskWorkspace repo="o/r" onOpenGraph={() => {}} />);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Why is MAX_RETRIES 3?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trace' }));
    expect(await screen.findByText(/Best-supported decision/)).toBeTruthy();
    expect(screen.getByText('fact')).toBeTruthy();
    expect(screen.getByText('inference')).toBeTruthy();
    expect(screen.getByLabelText(/Reasoning chain/)).toBeTruthy();
    const card = document.getElementById('ev-E1');
    const link = within(card).getByRole('link', { name: /open/ });
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/8');
    expect(link.getAttribute('rel')).toContain('noopener');
    // unavailable link + injection flag are visible, not hidden
    const card2 = document.getElementById('ev-E2');
    expect(within(card2).getByText('link unavailable')).toBeTruthy();
    expect(within(card2).getByText(/addressed to an AI system/)).toBeTruthy();
  });

  test('insufficient-evidence answer is explicit', async () => {
    vi.spyOn(api, 'ask').mockResolvedValue(answerInsufficient);
    render(<AskWorkspace repo="o/r" onOpenGraph={() => {}} />);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Why was legacy not migrated?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trace' }));
    expect(await screen.findByText('No established reason')).toBeTruthy();
    expect(screen.getByText(/does not establish the reason/)).toBeTruthy();
    expect(screen.getByText('insufficient')).toBeTruthy();
  });

  test('loading and error states while asking', async () => {
    let reject;
    vi.spyOn(api, 'ask').mockImplementation(() => new Promise((_, r) => (reject = r)));
    render(<AskWorkspace repo="o/r" onOpenGraph={() => {}} />);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Why is X?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trace' }));
    expect(await screen.findByText(/walking the graph/)).toBeTruthy();
    reject(new Error('Cannot reach the TraceWhy backend.'));
    expect(await screen.findByText(/Cannot reach the TraceWhy backend/)).toBeTruthy();
  });

  test('viewing a superseded decision shows what replaced it', async () => {
    vi.spyOn(api, 'decisions').mockResolvedValue({ decisions });
    render(<DecisionsView repo="o/r" refreshKey={0} onOpenGraph={() => {}} />);
    await screen.findAllByText(/Set SESSION_TTL_MINUTES to 15/);
    fireEvent.click(screen.getByRole('button', { name: /^superseded/ }));
    expect(screen.queryByText('“Increase SESSION_TTL_MINUTES to 30”')).toBeNull();
    expect(screen.getByText(/superseded by “Increase SESSION_TTL_MINUTES to 30”/)).toBeTruthy();
    expect(screen.getByText(/Author not established/)).toBeTruthy();
  });

  test('empty states: no decisions, empty repository overview', async () => {
    vi.spyOn(api, 'decisions').mockResolvedValue({ decisions: [] });
    render(<DecisionsView repo="o/r" refreshKey={0} onOpenGraph={() => {}} />);
    expect(await screen.findByText(/No decision language/)).toBeTruthy();
    cleanup();
    vi.spyOn(api, 'stats').mockResolvedValue({ stats: { labels: {}, origins: {}, relTypes: {}, decisionStatus: {} } });
    vi.spyOn(api, 'timeline').mockResolvedValue({ events: [] });
    render(<Overview repo="o/r" refreshKey={0} onOpenGraph={() => {}} onAsk={() => {}} />);
    expect(await screen.findByText(/no imported history yet/)).toBeTruthy();
  });

  test('app shows backend-unreachable error and first-run empty state', async () => {
    vi.spyOn(api, 'health').mockRejectedValue(new Error('Cannot reach the TraceWhy backend. Is it running on port 4000?'));
    vi.spyOn(api, 'repos').mockResolvedValue({ repos: [] });
    render(<App />);
    expect(await screen.findByText(/Backend unreachable/)).toBeTruthy();
    expect(screen.getByText(/Reconstruct why the code is like this/)).toBeTruthy();
  });

  test('demo mode and synthetic data are clearly labelled', async () => {
    vi.spyOn(api, 'health').mockResolvedValue({ credentials: { demoMode: true, neo4j: false, github: false, llm: false }, config: { errors: [], warnings: [] }, graph: { ok: true, backend: 'memory' } });
    vi.spyOn(api, 'repos').mockResolvedValue({ repos: [{ id: 'repo:demo/synthetic-checkout', name: 'demo/synthetic-checkout', synthetic: true }] });
    vi.spyOn(api, 'stats').mockResolvedValue({ repo: { name: 'demo/synthetic-checkout' }, stats: { labels: { Decision: 1 }, origins: {}, relTypes: {}, decisionStatus: {} } });
    vi.spyOn(api, 'decisions').mockResolvedValue({ decisions: [] });
    vi.spyOn(api, 'timeline').mockResolvedValue({ events: [] });
    render(<App />);
    expect(await screen.findByText(/Local demo mode/)).toBeTruthy();
    expect(await screen.findByText(/Synthetic demonstration data/)).toBeTruthy();
    expect(screen.getByText(/Neo4j AuraDB, GitHub token, LLM \(Sarvam AI \/ OpenAI\)/)).toBeTruthy();
  });

  test('only GitHub and synthetic-viewer links are rendered as links', () => {
    render(
      <div>
        <ExtLink href="javascript:alert(1)">bad</ExtLink>
        <ExtLink href="https://github.com.evil.io/x">evil</ExtLink>
        <ExtLink href="/api/demo/records/pull/9">ok</ExtLink>
      </div>,
    );
    expect(screen.getAllByText('link unavailable')).toHaveLength(2);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/api/demo/records/pull/9');
  });
});
