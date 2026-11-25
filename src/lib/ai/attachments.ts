import type { ChatAttachment } from './catalog';
export const IMAGE_LIMIT = 2 * 1024 * 1024;
export function validAttachment(file: ChatAttachment): boolean {
  if (!file || typeof file.name !== 'string' || file.name.length > 200 || /(^|[\\/])(\.env.*|config\.json)$/i.test(file.name) || typeof file.content !== 'string') return false;
  if (!file.mediaType) return Buffer.byteLength(file.content) <= 64000;
  if (!['image/png','image/jpeg','image/webp'].includes(file.mediaType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.content) || file.content.length > Math.ceil(IMAGE_LIMIT / 3) * 4) return false;
  const bytes=Buffer.from(file.content,'base64');
  return bytes.length <= IMAGE_LIMIT && (file.mediaType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : file.mediaType === 'image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP');
}
