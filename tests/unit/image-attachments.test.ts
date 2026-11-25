import {expect,it} from 'vitest';
import {validAttachment} from '@/lib/ai/attachments';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
it('accepts a clipboard PNG and rejects disguised or oversized binary payloads',()=>{
 expect(validAttachment({name:'clipboard.png',mediaType:'image/png',content:png})).toBe(true);
 expect(validAttachment({name:'fake.png',mediaType:'image/png',content:Buffer.from('not an image').toString('base64')})).toBe(false);
 expect(validAttachment({name:'fake.png',mediaType:'image/png',content:'A'.repeat(3000000)})).toBe(false);
 expect(validAttachment({name:'.env',content:'x'})).toBe(false);
 expect(validAttachment({name:'image.svg',mediaType:'image/svg+xml',content:'PHN2Zz4='})).toBe(false);
});
