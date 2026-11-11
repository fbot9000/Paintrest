import { describe, expect, it } from 'vitest';
import { parsePasted } from './pasteLinks';

describe('innlimte lenker fra Google Bilder', () => {
  it('leser Googles resultatlenker, bildelenker, sider og bildedata', () => {
    const imgres = 'https://www.google.com/imgres?q=dune%20imperium%20painted%20minis&imgurl=https%3A%2F%2Fi.redd.it%2F2wev7arjva591.jpg&imgrefurl=https%3A%2F%2Fwww.reddit.com%2Fr%2Fboardgames%2Fcomments%2Fvb1t8j%2Fpainted_dune_imperium_minis%2F&docid=x';
    const r = parsePasted(`${imgres}\nhttps://scontent-arn2-1.cdninstagram.com/v/t51.2885-15/123_n.jpg?stp=x\n https://boardgamegeek.com/image/123/dune  https://i.redd.it/abc\ndata:image/png;base64,iVBORw0KGgo=`);
    expect(r).toEqual([
      { kind: 'data', data_url: 'data:image/png;base64,iVBORw0KGgo=' },
      { kind: 'image', image_url: 'https://i.redd.it/2wev7arjva591.jpg', page_url: 'https://www.reddit.com/r/boardgames/comments/vb1t8j/painted_dune_imperium_minis/' },
      { kind: 'image', image_url: 'https://scontent-arn2-1.cdninstagram.com/v/t51.2885-15/123_n.jpg?stp=x', page_url: null },
      { kind: 'page', url: 'https://boardgamegeek.com/image/123/dune' },
      { kind: 'image', image_url: 'https://i.redd.it/abc', page_url: null },
    ]);
  });
  it('følger Googles videresendingslenker og hopper over tull', () => {
    expect(parsePasted('https://www.google.com/url?sa=i&url=https%3A%2F%2Fwww.etsy.com%2Flisting%2F1%2Fdune&psig=x')).toEqual([{ kind: 'page', url: 'https://www.etsy.com/listing/1/dune' }]);
    expect(parsePasted('ingen lenker her')).toEqual([]);
  });
});
