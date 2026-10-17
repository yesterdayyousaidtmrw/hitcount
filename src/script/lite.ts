// dist/hitcount.min.js: the default plugins only.
import { channels } from '../plugins/channels';
import { clicks } from '../plugins/clicks';
import { device } from '../plugins/device';
import { engagement } from '../plugins/engagement';
import { fingerprint } from '../plugins/fingerprint';
import { forms } from '../plugins/forms';
import { pageviews } from '../plugins/pageviews';
import { traffic } from '../plugins/traffic';
import { boot } from './boot';

boot({ pageviews, engagement, clicks, forms, traffic, device, channels, fingerprint });
