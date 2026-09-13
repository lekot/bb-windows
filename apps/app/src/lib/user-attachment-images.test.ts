import { describe, expect, it } from 'vitest';
import { toUserAttachmentImageSrc } from './user-attachment-images';

describe('user attachment image routing', () => {
  it.each(['C:/Users/example/Temp/image #1.png', 'C:\\Users\\example\\Temp\\image.png', '/tmp/image.png', '\\\\host\\share\\image.png'])(
    'routes absolute host paths through the thread: %s', path => {
      const url = new URL(toUserAttachmentImageSrc(path, 'project', 'thread'), 'http://localhost');
      expect(url.pathname).toBe('/api/v1/threads/thread/host-files/content');
      expect(url.searchParams.get('path')).toBe(path);
    },
  );
  it('keeps uploaded relative paths in project attachment storage', () => {
    const url = new URL(toUserAttachmentImageSrc('attachments/picture.png', 'project', 'thread'), 'http://localhost');
    expect(url.pathname).toBe('/api/v1/projects/project/attachments/content');
    expect(url.searchParams.get('path')).toBe('attachments/picture.png');
  });
  it.each(['https://example.com/image.png', 'data:image/png;base64,AAAA', 'blob:http://localhost/image'])(
    'preserves browser image URLs: %s', url => expect(toUserAttachmentImageSrc(url, 'project', 'thread')).toBe(url),
  );
});
