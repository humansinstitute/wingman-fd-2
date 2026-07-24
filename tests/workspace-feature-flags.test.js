import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  WORKROOMS_FEATURE_FLAG,
  isWorkspaceFeatureEnabled,
  withWorkspaceFeatureFlag,
} from '../src/workspace-feature-flags.js';
import { workroomCreationMixin } from '../src/workroom-creation-manager.js';
import { workroomDetailMixin } from '../src/workroom-detail-manager.js';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('workspace workrooms feature flag', () => {
  it('defaults workrooms off unless the workspace explicitly enables them', () => {
    expect(isWorkspaceFeatureEnabled({}, WORKROOMS_FEATURE_FLAG)).toBe(false);
    expect(isWorkspaceFeatureEnabled({ feature_flags: { workrooms: false } }, WORKROOMS_FEATURE_FLAG)).toBe(false);
    expect(isWorkspaceFeatureEnabled({ feature_flags: { workrooms: true } }, WORKROOMS_FEATURE_FLAG)).toBe(true);
  });

  it('updates the workrooms flag without discarding other workspace metadata or flags', () => {
    expect(withWorkspaceFeatureFlag({
      wingman_harness_url: 'https://wingman.example',
      feature_flags: { another_feature: true },
    }, WORKROOMS_FEATURE_FLAG, true)).toEqual({
      wingman_harness_url: 'https://wingman.example',
      feature_flags: {
        another_feature: true,
        workrooms: true,
      },
    });
  });

  it('gates workroom Deck and create UI while retaining workroom chat announcements', () => {
    expect(html).toContain('data-testid="workspace-workrooms-enabled"');
    expect(html).toContain('x-show="$store.chat.isTowerPgMode && $store.chat.workroomsEnabled"');
    expect(html.match(/role="menuitem" x-show="\$store\.chat\.workroomsEnabled"[^>]*>Start Workroom<\/button>/g)?.length).toBe(3);
    expect(html).toContain('<template x-if="$store.chat.isWorkroomAnnouncement(msg)">');
    expect(html).toContain('x-show="$store.chat.workroomsEnabled && card.roomId"');
  });

  it('blocks programmatic workroom create and detail entry while disabled', async () => {
    const creationStore = {
      workroomsEnabled: false,
      selectedChannel: { record_id: 'channel-1' },
      workroomCreationOpen: false,
    };
    await workroomCreationMixin.openWorkroomCreation.call(creationStore);
    expect(creationStore.workroomCreationOpen).toBe(false);

    const detailStore = {
      workroomsEnabled: false,
      activeWorkroomId: '',
      workroomDetailOpen: false,
    };
    await workroomDetailMixin.openWorkroomDetail.call(detailStore, 'room-1');
    expect(detailStore.activeWorkroomId).toBe('');
    expect(detailStore.workroomDetailOpen).toBe(false);
  });
});
