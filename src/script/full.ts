// dist/analy.full.min.js: every plugin, pick with data-plugins.
import { channels } from '../plugins/channels';
import { clicks } from '../plugins/clicks';
import { cloudflare } from '../plugins/cloudflare';
import { deadclicks } from '../plugins/deadclicks';
import { device } from '../plugins/device';
import { embeds } from '../plugins/embeds';
import { engagement } from '../plugins/engagement';
import { errors } from '../plugins/errors';
import { fingerprint } from '../plugins/fingerprint';
import { forms } from '../plugins/forms';
import { type FunnelsOptions, funnels } from '../plugins/funnels';
import { heatmap } from '../plugins/heatmap';
import { media } from '../plugins/media';
import { pageviews } from '../plugins/pageviews';
import { rageclicks } from '../plugins/rageclicks';
import { redact } from '../plugins/redact';
import { search } from '../plugins/search';
import { sections } from '../plugins/sections';
import { traffic } from '../plugins/traffic';
import { turnstile } from '../plugins/turnstile';
import { vitals } from '../plugins/vitals';
import { boot } from './boot';

// data-funnels holds the funnels plugin's JSON. It is read by the funnels factory, which boot calls
// while this tag is still document.currentScript, so no other factory is handed the tag's attributes.
function funnelsFromTag(): FunnelsOptions {
  const json = (document.currentScript as HTMLScriptElement | null)?.dataset.funnels;
  if (json === undefined) return {};
  try {
    return { funnels: JSON.parse(json) };
  } catch (error) {
    console.warn('[analy] data-funnels is not valid JSON, so no funnels are tracked', error);
    return {};
  }
}

boot({
  pageviews, engagement, clicks, forms, traffic, device, channels, rageclicks, heatmap, errors, vitals,
  media, embeds, turnstile, cloudflare, search,
  sections, deadclicks,
  fingerprint,
  funnels: () => funnels(funnelsFromTag()),
  redact,
});
