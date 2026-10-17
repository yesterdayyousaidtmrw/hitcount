import type { Plugin } from '../types';
import { ATTRIBUTE, attributeProps, closestInPath } from '../core/dom';

export interface ClicksOptions {
  /** Links to other hosts → `outbound`. Default true. */
  outbound?: boolean;
  /** File links → `download`. true = common extensions, or pass your own list. Default true. */
  downloads?: boolean | string[];
  /** mailto:/tel: links → `contact` with the address. Default true. */
  contact?: boolean;
}

const DOWNLOAD_EXTENSIONS = [
  'pdf', 'zip', 'rar', '7z', 'gz', 'dmg', 'exe', 'msi', 'pkg', 'apk', 'iso', 'csv', 'txt',
  'xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx', 'mp3', 'mp4', 'mov', 'wav',
];

/** data-hitcount="name" on any element, plus outbound, download and contact links. */
export function clicks({ outbound = true, downloads = true, contact = true }: ClicksOptions = {}): Plugin {
  const extensions = new Set(Array.isArray(downloads) ? downloads : downloads ? DOWNLOAD_EXTENSIONS : []);

  return {
    name: 'clicks',
    setup(hitcount) {
      const onClick = (event: MouseEvent) => {
        if (event.type === 'auxclick' && event.button !== 1) return;

        // Forms are tracked on submit by the forms plugin, not on every click inside them.
        const tagged = closestInPath(event, `[${ATTRIBUTE}]:not(form)`);
        if (tagged) {
          hitcount.track(tagged.getAttribute(ATTRIBUTE) || 'action', attributeProps(tagged));
          return;
        }

        const link = closestInPath<HTMLAnchorElement>(event, 'a[href]');
        if (!link) return;
        const url = new URL(link.href, location.href);
        if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
          const channel = url.protocol === 'mailto:' ? 'email' : 'phone';
          if (contact) hitcount.track('contact', { channel, address: decodeURIComponent(url.pathname) });
          return;
        }
        const file = url.pathname.split('/').pop() ?? '';
        const extension = file.includes('.') ? file.split('.').pop()!.toLowerCase() : '';
        if (link.hasAttribute('download') || extensions.has(extension)) {
          hitcount.track('download', { url: url.href, file });
          return;
        }
        if (outbound && url.host !== location.host && url.protocol.startsWith('http')) {
          hitcount.track('outbound', { url: url.href });
        }
      };

      document.addEventListener('click', onClick, true);
      document.addEventListener('auxclick', onClick, true);
      return () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('auxclick', onClick, true);
      };
    },
  };
}
