export { createAnaly } from './core/tracker';

export { http, type HttpSinkOptions } from './sinks/http';
export { supabase, type SupabaseSinkOptions } from './sinks/supabase';
export { callback } from './sinks/callback';
export { toRow, type EventRow } from './sinks/row';

export { pageviews, type PageviewsOptions } from './plugins/pageviews';
export { engagement, type EngagementOptions } from './plugins/engagement';
export { clicks, type ClicksOptions } from './plugins/clicks';
export { forms } from './plugins/forms';
export { rageclicks, type RageClickOptions } from './plugins/rageclicks';
export { deadclicks, type DeadClickOptions } from './plugins/deadclicks';
export { heatmap } from './plugins/heatmap';
export { sections, type SectionsOptions } from './plugins/sections';
export { errors, type ErrorsOptions } from './plugins/errors';
export { vitals } from './plugins/vitals';
export { traffic, type TrafficOptions } from './plugins/traffic';
export { device, parseUserAgent } from './plugins/device';
export { channels, classifySource } from './plugins/channels';
export { media, type MediaOptions } from './plugins/media';
export { embeds, type EmbedsOptions } from './plugins/embeds';
export { turnstile, type TurnstileOptions } from './plugins/turnstile';
export { cloudflare, parseTrace, type CloudflareOptions } from './plugins/cloudflare';
export { search, type SearchOptions } from './plugins/search';
export { redact, createRedactor, redactText, type RedactOptions } from './plugins/redact';

export type * from './types';
