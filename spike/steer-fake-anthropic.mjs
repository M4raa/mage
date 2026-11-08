// El servidor falso vive ahora en scripts/ (T6, verify:gui y los spikes lo comparten); este alias mantiene steer-claude.mjs intacto.
export { startFakeAnthropic as startFake } from '../scripts/fake-anthropic-messages.mjs';
