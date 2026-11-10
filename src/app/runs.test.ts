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
    expect(runs.active().map((x) => x.subject_id)).toContain('s1');
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
});
