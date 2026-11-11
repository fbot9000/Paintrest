import { describe, expect, it } from 'vitest';
import { runs } from './runs';

describe('kjøringer som overlever navigasjon', () => {
  it('samler hendelser og sider, og kan stoppes', async () => {
    let release!: () => void;
    runs.start('s1', 'images', async (onEvent, signal) => {
      onEvent({ type: 'open_done', url: 'https://a.example/p', title: 'A', image_count: 1, images: [{ url: 'https://a.example/1.jpg', alt: '', caption: null, context: null }] });
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('stopp'), { name: 'AbortError' })));
      });
    });
    const r = runs.get('s1', 'images')!;
    expect(r.status).toBe('running');
    expect(r.pages[0]!.images).toHaveLength(1);
    expect(runs.active().map((x) => x.id)).toContain('s1');
    // A second start while running is ignored.
    runs.start('s1', 'images', async () => {});
    runs.stop('s1', 'images');
    await new Promise((r2) => setTimeout(r2, 0));
    expect(runs.get('s1', 'images')!.status).toBe('stopped');
    void release;
  });

  it('melder feil', async () => {
    runs.start('s2', 'plan', async () => { throw new Error('UiB svarte ikke'); });
    await new Promise((r) => setTimeout(r, 0));
    expect(runs.get('s2', 'plan')).toMatchObject({ status: 'error', error: 'UiB svarte ikke' });
  });

  describe("research i biblioteket ('knowledge')", () => {
    const abortable = (signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('stopp'), { name: 'AbortError' })));
    });

    it('starter med oppgavens id, samler hendelser og blir ferdig', async () => {
      let release!: () => void;
      runs.start('task-1', 'knowledge', async (onEvent) => {
        onEvent({ type: 'open_done', url: 'https://b.example/artikkel', title: 'B', image_count: 0 });
        await new Promise<void>((resolve) => { release = resolve; });
      });
      const r = runs.get('task-1', 'knowledge')!;
      expect(r).toMatchObject({ id: 'task-1', kind: 'knowledge', status: 'running' });
      expect(r.events).toHaveLength(1);
      expect(runs.get('task-1', 'images')).toBeNull();
      release();
      await new Promise((r2) => setTimeout(r2, 0));
      // Events are kept after the run is done.
      expect(runs.get('task-1', 'knowledge')).toMatchObject({ status: 'done', error: null });
      expect(runs.get('task-1', 'knowledge')!.events).toHaveLength(1);
      expect(runs.get('task-1', 'knowledge')!.finished_at).not.toBeNull();
    });

    it('kan stoppes, og stoppet skilles fra ferdig', async () => {
      runs.start('task-2', 'knowledge', async (_onEvent, signal) => abortable(signal));
      runs.stop('task-2', 'knowledge');
      await new Promise((r) => setTimeout(r, 0));
      expect(runs.get('task-2', 'knowledge')).toMatchObject({ status: 'stopped', error: null });
    });

    it('melder feil, og feilen kan lukkes', async () => {
      runs.start('task-3', 'knowledge', async () => { throw new Error('Agenten svarte ikke'); });
      await new Promise((r) => setTimeout(r, 0));
      expect(runs.get('task-3', 'knowledge')).toMatchObject({ status: 'error', error: 'Agenten svarte ikke' });
      runs.dismiss('task-3', 'knowledge');
      expect(runs.get('task-3', 'knowledge')).toBeNull();
    });

    it('vises ikke som markør i galleriet', async () => {
      runs.start('task-4', 'knowledge', async (_onEvent, signal) => abortable(signal));
      runs.start('s4', 'plan', async (_onEvent, signal) => abortable(signal));
      expect(runs.active().map((x) => x.id)).toEqual(expect.arrayContaining(['task-4', 's4']));
      const gallery = runs.active('images', 'plan').map((x) => x.id);
      expect(gallery).toContain('s4');
      expect(gallery).not.toContain('task-4');
      // A running run cannot be dismissed.
      runs.dismiss('task-4', 'knowledge');
      expect(runs.get('task-4', 'knowledge')?.status).toBe('running');
      runs.stop('task-4', 'knowledge');
      runs.stop('s4', 'plan');
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("kjører prosjektpanelet ved siden av verkstedet, med etikett og lenke for den globale indikatoren", async () => {
    const abortable = (signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('stopp'), { name: 'AbortError' })));
    });
    runs.start('p1', 'project', async (_onEvent, signal) => abortable(signal), { label: 'Researchagent: Spillet', href: '/p/p1' });
    runs.start('s5', 'images', async (_onEvent, signal) => abortable(signal));
    // Different kinds do not block each other.
    expect(runs.get('p1', 'project')).toMatchObject({ status: 'running', label: 'Researchagent: Spillet', href: '/p/p1' });
    expect(runs.get('s5', 'images')).toMatchObject({ status: 'running', label: null, href: null });
    expect(runs.active('images', 'plan').map((x) => x.id)).not.toContain('p1');
    runs.stop('p1', 'project');
    await new Promise((r) => setTimeout(r, 0));
    expect(runs.get('p1', 'project')!.status).toBe('stopped');
    expect(runs.get('s5', 'images')!.status).toBe('running');
    runs.stop('s5', 'images');
    await new Promise((r) => setTimeout(r, 0));
  });

  it('husker om feilen allerede er vist i samtalen', async () => {
    runs.start('task-5', 'knowledge', async () => { throw Object.assign(new Error('UiB svarte ikke'), { reported: true }); });
    runs.start('task-6', 'knowledge', async () => { throw new Error('Oppgaven er lukket'); });
    await new Promise((r) => setTimeout(r, 0));
    expect(runs.get('task-5', 'knowledge')).toMatchObject({ status: 'error', error: 'UiB svarte ikke', error_reported: true });
    expect(runs.get('task-6', 'knowledge')).toMatchObject({ status: 'error', error: 'Oppgaven er lukket', error_reported: false });
  });
});
