// dist/hitcount.full.min.js: every plugin, pick with data-plugins.
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
import { funnels } from '../plugins/funnels';
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

boot({
  pageviews, engagement, clicks, forms, traffic, device, channels, rageclicks, heatmap, errors, vitals,
  media, embeds, turnstile, cloudflare, search,
  sections, deadclicks,
  fingerprint,
  funnels,
  redact,
});
